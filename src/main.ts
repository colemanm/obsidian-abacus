import { Plugin, WorkspaceLeaf } from "obsidian";
import { AbacusData, AbacusSettings, COMPACT_INTERVAL_MS, DailyRecord, DEFAULT_DATA, DEFAULT_SETTINGS, DeviceEntry, DeviceIncrementFile, Increment, localDateStr } from "./types";
import { AbacusSettingTab } from "./settings";
import { AbacusStatsView, VIEW_TYPE_ABACUS_STATS } from "./stats-view";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { Text } from "@codemirror/state";

function getToday(): string {
	return localDateStr(new Date());
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
}

/** Count words in a range of lines in a CodeMirror Doc, without allocating the full document string. */
function countWordsInLineRange(doc: Text, fromPos: number, toPos: number): number {
	const firstLine = doc.lineAt(fromPos).number;
	const lastLine = doc.lineAt(toPos).number;
	let count = 0;
	for (let i = firstLine; i <= lastLine; i++) {
		count += countWords(doc.line(i).text);
	}
	return count;
}

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return localDateStr(d);
}

export default class AbacusPlugin extends Plugin {
	data: AbacusData;
	statusBarEl: HTMLElement;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
	private pendingAdded = 0;
	private pendingDeleted = 0;
	private deviceId: string;
	private myIncrements: Increment[] = [];
	private lastCompactedTs = 0;

	async onload() {
		await this.loadAbacusData();
		await this.compact();

		this.registerView(VIEW_TYPE_ABACUS_STATS, (leaf) => new AbacusStatsView(leaf, this));

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();

		this.addRibbonIcon("bar-chart-2", "Abacus: View Stats", () => {
			this.activateStatsView();
		});

		this.addCommand({
			id: "open-stats",
			name: "View daily word stats",
			callback: () => {
				this.activateStatsView();
			},
		});

		this.addSettingTab(new AbacusSettingTab(this.app, this));

		this.registerEditorExtension(
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (!update.docChanged) return;
				this.handleDocChange(update);
			})
		);

		this.registerInterval(
			window.setInterval(() => this.updateStatusBar(), 60 * 1000)
		);

		// Periodically compact increments into data.json
		this.registerInterval(
			window.setInterval(() => this.compact(), COMPACT_INTERVAL_MS)
		);
	}

	onunload() {
		this.flushPending();
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveMyIncrements();
		}
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
		}
	}

	handleDocChange(update: ViewUpdate) {
		let delta = 0;

		update.changes.iterChanges((fromA, toA, fromB, toB) => {
			const oldWords = countWordsInLineRange(update.startState.doc, fromA, Math.max(fromA, toA - 1));
			const newWords = countWordsInLineRange(update.state.doc, fromB, Math.max(fromB, toB - 1));
			delta += newWords - oldWords;
		});

		if (delta === 0) return;

		if (delta > 0) {
			this.pendingAdded += delta;
		} else {
			this.pendingDeleted += -delta;
		}

		this.debounceSave();
		this.updateStatusBar();
		this.debounceRefreshStatsView();
	}

	/** Flush accumulated pending words into a single increment. */
	private flushPending() {
		if (this.pendingAdded === 0 && this.pendingDeleted === 0) return;

		const inc: Increment = {
			ts: Date.now(),
			date: getToday(),
			added: this.pendingAdded,
			deleted: this.pendingDeleted,
		};

		this.myIncrements.push(inc);

		this.pendingAdded = 0;
		this.pendingDeleted = 0;
	}

	/**
	 * Aggregate increments + compacted summaries into DailyRecords.
	 */
	getDailyRecords(): Record<string, DailyRecord> {
		const records: Record<string, DailyRecord> = {};

		// Start with compacted data — sum across all device keys per date
		for (const [date, devices] of Object.entries(this.data.compacted)) {
			let wordsAdded = 0;
			let wordsDeleted = 0;
			for (const entry of Object.values(devices)) {
				wordsAdded += entry.wordsAdded;
				wordsDeleted += entry.wordsDeleted;
			}
			records[date] = {
				date,
				wordsAdded,
				wordsDeleted,
				netWords: wordsAdded - wordsDeleted,
			};
		}

		// Layer un-compacted increments (those newer than lastCompactedTs) on top
		for (const inc of this.myIncrements) {
			if (inc.ts <= this.lastCompactedTs) continue;
			const existing = records[inc.date];
			if (existing) {
				existing.wordsAdded += inc.added;
				existing.wordsDeleted += inc.deleted;
				existing.netWords = existing.wordsAdded - existing.wordsDeleted;
			} else {
				records[inc.date] = {
					date: inc.date,
					wordsAdded: inc.added,
					wordsDeleted: inc.deleted,
					netWords: inc.added - inc.deleted,
				};
			}
		}

		return records;
	}

	getTodayRecord(): DailyRecord {
		const today = getToday();
		const record = this.getDailyRecords()[today] ?? {
			date: today,
			wordsAdded: 0,
			wordsDeleted: 0,
			netWords: 0,
		};

		// Include unflushed pending words
		if (this.pendingAdded > 0 || this.pendingDeleted > 0) {
			record.wordsAdded += this.pendingAdded;
			record.wordsDeleted += this.pendingDeleted;
			record.netWords = record.wordsAdded - record.wordsDeleted;
		}

		return record;
	}

	/**
	 * Compact this device's un-compacted increments into data.json under this device's key.
	 */
	async compact() {
		const toCompact = this.myIncrements.filter((i) => i.ts > this.lastCompactedTs);
		if (toCompact.length === 0) return;

		// Re-read data.json from disk to pick up any sync changes before writing
		const fresh = await this.loadData();
		if (fresh?.compacted) {
			for (const [date, incomingDevices] of Object.entries(fresh.compacted)) {
				if (incomingDevices && "date" in (incomingDevices as Record<string, unknown>)) continue;
				if (!this.data.compacted[date]) {
					this.data.compacted[date] = {};
				}
				const localDevices = this.data.compacted[date]!;
				const devices = incomingDevices as Record<string, DeviceEntry>;
				for (const [deviceId, entry] of Object.entries(devices)) {
					const local = localDevices[deviceId];
					if (local) {
						local.wordsAdded = Math.max(local.wordsAdded, entry.wordsAdded);
						local.wordsDeleted = Math.max(local.wordsDeleted, entry.wordsDeleted);
					} else {
						localDevices[deviceId] = { ...entry };
					}
				}
			}
		}

		// Aggregate into compacted under this device's key
		for (const inc of toCompact) {
			if (!this.data.compacted[inc.date]) {
				this.data.compacted[inc.date] = {};
			}
			const devices = this.data.compacted[inc.date]!;
			const existing = devices[this.deviceId];
			if (existing) {
				existing.wordsAdded += inc.added;
				existing.wordsDeleted += inc.deleted;
			} else {
				devices[this.deviceId] = {
					wordsAdded: inc.added,
					wordsDeleted: inc.deleted,
				};
			}
		}

		// Update lastCompactedTs to the max ts we just compacted
		const maxTs = Math.max(...toCompact.map((i) => i.ts));

		// Write data.json first (synced), then update local buffer
		await this.saveSharedData();

		this.lastCompactedTs = maxTs;
		// Clear fully-compacted increments from the buffer
		this.myIncrements = this.myIncrements.filter((i) => i.ts > maxTs);
		await this.writeMyIncrements();
	}

	/**
	 * Count consecutive days (before today) where the daily goal was met.
	 */
	getStreak(): number {
		const goal = this.data.settings.dailyGoal;
		if (goal <= 0) return 0;

		const records = this.getDailyRecords();
		let streak = 0;
		let day = 1; // start from yesterday

		while (true) {
			const date = daysAgo(day);
			const record = records[date];
			if (record && record.netWords >= goal) {
				streak++;
				day++;
			} else {
				break;
			}
		}

		return streak;
	}

	updateStatusBar() {
		const record = this.getTodayRecord();
		const goal = this.data.settings.dailyGoal;
		const net = record.netWords;

		if (goal > 0) {
			const pct = Math.min(100, Math.round((net / goal) * 100));
			const streak = this.getStreak();
			const icon = net >= goal ? "\u2713" : "\u270f\ufe0f";
			let text = `${icon} ${net} total words | ${net} / ${goal} (${pct}%)`;
			if (streak > 0) {
				text += ` | ${streak}d streak`;
			}
			this.statusBarEl.setText(text);
		} else {
			this.statusBarEl.setText(`\u270f\ufe0f ${net} words today`);
		}
	}

	async activateStatsView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABACUS_STATS);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0] as WorkspaceLeaf);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ABACUS_STATS,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	refreshStatsView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABACUS_STATS);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof AbacusStatsView) {
				view.refresh();
			}
		}
	}

	get settings(): AbacusSettings {
		return this.data.settings;
	}

	get myIncrementsCount(): number {
		return this.myIncrements.length;
	}

	// --- Device ID ---

	private initDeviceId() {
		const key = "abacus-device-id";
		let id = window.localStorage.getItem(key);
		if (!id) {
			id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
			window.localStorage.setItem(key, id);
		}
		this.deviceId = id;
	}

	getDeviceName(): string {
		return window.localStorage.getItem("abacus-device-name") ?? "";
	}

	async setDeviceName(name: string) {
		const oldPath = this.incrementFilePath;
		window.localStorage.setItem("abacus-device-name", name);
		const newPath = this.incrementFilePath;
		if (oldPath !== newPath) {
			const adapter = this.app.vault.adapter;
			try {
				if (await adapter.exists(oldPath)) {
					// Read, write to new path, remove old
					const raw = await adapter.read(oldPath);
					await adapter.write(newPath, raw);
					await adapter.remove(oldPath);
				}
			} catch {
				// If rename fails, the next save will write to the new path
			}
		}
	}

	// --- Per-device file I/O ---

	private get pluginDir(): string {
		return this.manifest.dir!;
	}

	private get incrementFileStem(): string {
		const name = this.getDeviceName();
		if (name) {
			const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
			if (slug) return slug;
		}
		return this.deviceId;
	}

	private get incrementFilePath(): string {
		return `${this.pluginDir}/increments-${this.incrementFileStem}.json`;
	}

	private async readIncrementFile(path: string): Promise<DeviceIncrementFile | null> {
		const adapter = this.app.vault.adapter;
		try {
			const raw = await adapter.read(path);
			return JSON.parse(raw) as DeviceIncrementFile;
		} catch {
			return null;
		}
	}

	private async writeMyIncrements() {
		const adapter = this.app.vault.adapter;
		const file: DeviceIncrementFile = {
			deviceId: this.deviceId,
			deviceName: this.getDeviceName() || undefined,
			increments: this.myIncrements,
			lastCompactedTs: this.lastCompactedTs,
		};
		await adapter.write(this.incrementFilePath, JSON.stringify(file, null, "\t"));
	}

	/** Load this device's increment file, returning increments and lastCompactedTs. */
	private async loadMyIncrementFile(): Promise<{ increments: Increment[]; lastCompactedTs: number }> {
		// Try the current path first (name-based or id-based)
		const myFile = await this.readIncrementFile(this.incrementFilePath);
		if (myFile) return { increments: myFile.increments, lastCompactedTs: myFile.lastCompactedTs ?? 0 };

		// Fall back: scan all increment files for one matching our deviceId
		// (handles case where device name was set/changed since the file was written)
		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(this.pluginDir);
		const files = listing.files.filter((f) => /\/increments-.+\.json$/.test(f));
		for (const path of files) {
			const file = await this.readIncrementFile(path);
			if (file && file.deviceId === this.deviceId) {
				// Rename to current expected path
				const newPath = this.incrementFilePath;
				if (path !== newPath) {
					await adapter.write(newPath, JSON.stringify(file, null, "\t"));
					await adapter.remove(path);
				}
				return { increments: file.increments, lastCompactedTs: file.lastCompactedTs ?? 0 };
			}
		}

		return { increments: [], lastCompactedTs: 0 };
	}

	// --- Load / Save ---

	async loadAbacusData() {
		const saved = await this.loadData();
		this.data = Object.assign({}, DEFAULT_DATA, saved);
		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
		if (!this.data.compacted) this.data.compacted = {};

		// Clean up stale settings fields
		delete (this.data.settings as unknown as Record<string, unknown>)["compactAfterDays"];

		this.initDeviceId();

		let needsSave = false;

		// Migrate from old dailyRecords format → per-device compacted with "legacy" key
		if (saved && "dailyRecords" in saved) {
			const old = saved as { dailyRecords?: Record<string, { wordsAdded: number; wordsDeleted: number }> };
			if (old.dailyRecords) {
				for (const [date, record] of Object.entries(old.dailyRecords)) {
					if (!this.data.compacted[date]) {
						this.data.compacted[date] = {};
					}
					if (!this.data.compacted[date]!["legacy"]) {
						this.data.compacted[date]!["legacy"] = {
							wordsAdded: record.wordsAdded,
							wordsDeleted: record.wordsDeleted,
						};
					}
				}
			}
			delete (this.data as unknown as Record<string, unknown>)["dailyRecords"];
			needsSave = true;
		}

		// Migrate old flat compacted format (entries have a "date" field → old DailyRecord shape)
		// to per-device format with "legacy" key
		if (this.data.compacted) {
			for (const [date, value] of Object.entries(this.data.compacted)) {
				if (value && "date" in value && typeof (value as Record<string, unknown>)["date"] === "string") {
					// This is an old-style flat DailyRecord
					const oldRecord = value as unknown as { wordsAdded: number; wordsDeleted: number };
					this.data.compacted[date] = {
						legacy: {
							wordsAdded: oldRecord.wordsAdded,
							wordsDeleted: oldRecord.wordsDeleted,
						},
					};
					needsSave = true;
				}
			}
		}

		// Migrate increments from data.json to per-device file
		if (saved && "increments" in saved && Array.isArray(saved.increments) && saved.increments.length > 0) {
			this.myIncrements = saved.increments as Increment[];
			delete (this.data as unknown as Record<string, unknown>)["increments"];
			await this.writeMyIncrements();
			needsSave = true;
		} else {
			delete (this.data as unknown as Record<string, unknown>)["increments"];
		}

		// Clean up stale fields
		delete (this.data as unknown as Record<string, unknown>)["migratedToPerDevice"];

		if (needsSave) {
			await this.saveSharedData();
		}

		// Load this device's increment file
		const loaded = await this.loadMyIncrementFile();
		this.myIncrements = loaded.increments;
		this.lastCompactedTs = loaded.lastCompactedTs;
	}

	private async saveSharedData() {
		await this.saveData(this.data);
	}

	private async saveMyIncrements() {
		await this.writeMyIncrements();
	}

	async saveAbacusData() {
		await this.saveSharedData();
		await this.saveMyIncrements();
	}

	/** Called by Obsidian when data.json is modified externally (e.g., by Sync). */
	async onExternalSettingsChange() {
		const saved = await this.loadData();
		if (!saved) return;

		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
		delete (this.data.settings as unknown as Record<string, unknown>)["compactAfterDays"];

		const incoming = saved.compacted ?? {};

		// Merge incoming compacted data using MAX per device per date
		for (const [date, incomingDevices] of Object.entries(incoming)) {
			// Skip old-format entries that snuck through
			if (incomingDevices && "date" in (incomingDevices as Record<string, unknown>)) continue;

			if (!this.data.compacted[date]) {
				this.data.compacted[date] = {};
			}
			const localDevices = this.data.compacted[date]!;
			const devices = incomingDevices as Record<string, DeviceEntry>;

			for (const [deviceId, incomingEntry] of Object.entries(devices)) {
				const localEntry = localDevices[deviceId];
				if (localEntry) {
					localEntry.wordsAdded = Math.max(localEntry.wordsAdded, incomingEntry.wordsAdded);
					localEntry.wordsDeleted = Math.max(localEntry.wordsDeleted, incomingEntry.wordsDeleted);
				} else {
					localDevices[deviceId] = { ...incomingEntry };
				}
			}
		}

		// Persist merged state so it survives a restart before the next compact
		await this.saveSharedData();

		this.updateStatusBar();
		this.refreshStatsView();
	}

	private debounceRefreshStatsView() {
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		this.refreshTimeout = setTimeout(() => {
			this.refreshTimeout = null;
			this.refreshStatsView();
		}, 2000);
	}

	private debounceSave() {
		if (this.saveTimeout) clearTimeout(this.saveTimeout);
		this.saveTimeout = setTimeout(() => {
			this.saveTimeout = null;
			this.flushPending();
			this.saveMyIncrements();
		}, 2000);
	}
}
