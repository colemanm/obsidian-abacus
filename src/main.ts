import { Plugin } from "obsidian";
import { AbacusData, AbacusSettings, COMPACT_INTERVAL_MS, DailyRecord, DEFAULT_DATA, DEFAULT_SETTINGS, DeviceIncrementFile, Increment, localDateStr } from "./types";
import { AbacusSettingTab } from "./settings";
import { AbacusStatsView, VIEW_TYPE_ABACUS_STATS } from "./stats-view";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { WritingTimer } from "./writing-timer";
import { TimerControls } from "./timer-controls";

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

function stableStringify(value: unknown): string | undefined {
	return JSON.stringify(value, (_key, nestedValue: unknown) => {
		if (nestedValue === null || typeof nestedValue !== "object" || Array.isArray(nestedValue)) {
			return nestedValue;
		}

		const record = nestedValue as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			sorted[key] = record[key];
		}
		return sorted;
	});
}

export default class AbacusPlugin extends Plugin {
	data: AbacusData;
	statusBarEl: HTMLElement;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
	private pendingAdded = 0;
	private pendingDeleted = 0;
	private deviceId: string;
	private incrementFilePath: string;
	private myIncrements: Increment[] = [];
	private lastCompactedTs = 0;
	private deviceWrite = Promise.resolve();
	private sharedWrite = Promise.resolve();
	readonly timer = new WritingTimer((date, focusedMs) => {
		this.myIncrements.push({ ts: this.nextIncrementTs(), date, added: 0, deleted: 0, focusedMs });
	});
	timerControls: TimerControls;

	async onload() {
		await this.loadAbacusData();
		if (this.timer.expire(Date.now())) await this.saveDeviceData();
		await this.compact();

		this.registerView(VIEW_TYPE_ABACUS_STATS, (leaf) => new AbacusStatsView(leaf, this));

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
		this.timerControls = new TimerControls(this);

		this.addRibbonIcon("bar-chart-2", "View writing stats", () => {
			void this.activateStatsView();
		});

		this.addCommand({
			id: "open-stats",
			name: "View daily word stats",
			callback: () => this.activateStatsView(),
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
			window.setInterval(() => { void this.compact(); }, COMPACT_INTERVAL_MS)
		);
	}

	onunload() {
		this.flushPending();
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			void this.saveDeviceData();
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
			ts: this.nextIncrementTs(),
			date: getToday(),
			added: this.pendingAdded,
			deleted: this.pendingDeleted,
		};

		this.myIncrements.push(inc);

		this.pendingAdded = 0;
		this.pendingDeleted = 0;
	}

	private nextIncrementTs(): number {
		const last = this.myIncrements[this.myIncrements.length - 1];
		return Math.max(Date.now(), this.lastCompactedTs + 1, (last?.ts ?? 0) + 1);
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
			let focusedMs = 0;
			for (const entry of Object.values(devices)) {
				wordsAdded += entry.wordsAdded;
				wordsDeleted += entry.wordsDeleted;
				focusedMs += entry.focusedMs ?? 0;
			}
			records[date] = {
				date,
				wordsAdded,
				wordsDeleted,
				netWords: wordsAdded - wordsDeleted,
				focusedMs,
			};
		}

		// Layer un-compacted increments (those newer than lastCompactedTs) on top
		for (const inc of this.myIncrements) {
			if (inc.ts <= this.lastCompactedTs) continue;
			if (inc.ts <= (this.data.compacted[inc.date]?.[this.deviceId]?.throughTs ?? 0)) continue;
			const existing = records[inc.date];
			if (existing) {
				existing.wordsAdded += inc.added;
				existing.wordsDeleted += inc.deleted;
				existing.focusedMs += inc.focusedMs ?? 0;
				existing.netWords = existing.wordsAdded - existing.wordsDeleted;
			} else {
				records[inc.date] = {
					date: inc.date,
					wordsAdded: inc.added,
					wordsDeleted: inc.deleted,
					netWords: inc.added - inc.deleted,
					focusedMs: inc.focusedMs ?? 0,
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
			focusedMs: 0,
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
		// Persist the timer transition and its credits together before publishing totals.
		await this.saveDeviceData();

		// Re-read data.json from disk to pick up any sync changes before writing
		const fresh = await this.loadData() as Partial<AbacusData> | null;
		this.mergeCompacted(fresh?.compacted ?? {});

		// Aggregate into compacted under this device's key
		const previousCutoffs = new Map<string, number>();
		for (const inc of toCompact) {
			if (!this.data.compacted[inc.date]) {
				this.data.compacted[inc.date] = {};
			}
			const devices = this.data.compacted[inc.date]!;
			const entry = devices[this.deviceId] ??= { wordsAdded: 0, wordsDeleted: 0 };
			// Legacy buffers can contain several increments with the same timestamp.
			if (!previousCutoffs.has(inc.date)) previousCutoffs.set(inc.date, entry.throughTs ?? 0);
			if (inc.ts <= previousCutoffs.get(inc.date)!) continue;
			entry.wordsAdded += inc.added;
			entry.wordsDeleted += inc.deleted;
			if (inc.focusedMs) entry.focusedMs = (entry.focusedMs ?? 0) + inc.focusedMs;
			entry.throughTs = Math.max(entry.throughTs ?? 0, inc.ts);
		}

		// Update lastCompactedTs to the max ts we just compacted
		const maxTs = Math.max(...toCompact.map((i) => i.ts));

		// Write data.json first (synced), then update local buffer
		await this.saveSharedData();

		this.lastCompactedTs = Math.max(this.lastCompactedTs, maxTs);
		// Clear fully-compacted increments from the buffer
		this.myIncrements = this.myIncrements.filter((i) => i.ts > maxTs);
		await this.saveDeviceData();
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
		const [existing] = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABACUS_STATS);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ABACUS_STATS,
				active: true,
			});
			await this.app.workspace.revealLeaf(leaf);
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

	refreshTimerDisplays(now: number) {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ABACUS_STATS)) {
			if (leaf.view instanceof AbacusStatsView) leaf.view.updateTimerDisplay(now);
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
		const rename = this.deviceWrite.then(async () => {
			const newPath = await this.resolveIncrementPath(name);
			const adapter = this.app.vault.adapter;
			if (this.incrementFilePath !== newPath && await adapter.exists(this.incrementFilePath)) {
				await adapter.rename(this.incrementFilePath, newPath);
			}
			this.incrementFilePath = newPath;
			window.localStorage.setItem("abacus-device-name", name);
		});
		this.deviceWrite = rename.catch(() => {});
		await rename;
	}

	// --- Per-device file I/O ---

	private get pluginDir(): string {
		return this.manifest.dir!;
	}

	private async resolveIncrementPath(name: string): Promise<string> {
		const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const path = `${this.pluginDir}/increments-${slug || this.deviceId}.json`;
		if (!slug) return path;
		const file = await this.readIncrementFile(path);
		// Two devices may share a friendly name, but a running timer has one owner.
		return file && file.deviceId !== this.deviceId
			? `${this.pluginDir}/increments-${slug}-${this.deviceId}.json` : path;
	}

	// Adapter API is used intentionally: increment files live in the plugin
	// directory (.obsidian/plugins/abacus/), not in the vault, so the Vault
	// API (which operates on vault content) is not appropriate here.
	private async readIncrementFile(path: string): Promise<DeviceIncrementFile | null> {
		const adapter = this.app.vault.adapter;
		try {
			const raw = await adapter.read(path);
			return JSON.parse(raw) as DeviceIncrementFile;
		} catch {
			return null;
		}
	}

	saveDeviceData(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const file: DeviceIncrementFile = {
			deviceId: this.deviceId,
			deviceName: this.getDeviceName() || undefined,
			increments: this.myIncrements,
			lastCompactedTs: this.lastCompactedTs,
			writingSession: this.timer.session ?? undefined,
		};
		const snapshot = JSON.stringify(file, null, "\t");
		const write = this.deviceWrite.then(() => adapter.write(this.incrementFilePath, snapshot));
		this.deviceWrite = write.catch(() => {});
		return write;
	}

	/** Load this device's increment file, returning increments and lastCompactedTs. */
	private async loadMyIncrementFile(): Promise<DeviceIncrementFile> {
		// Try the current path first (name-based or id-based)
		const myFile = await this.readIncrementFile(this.incrementFilePath);
		if (myFile && myFile.deviceId === this.deviceId) return myFile;

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
				return file;
			}
		}

		return { deviceId: this.deviceId, increments: [] };
	}

	// --- Load / Save ---

	async loadAbacusData() {
		const saved = await this.loadData() as (Partial<AbacusData> & {
			dailyRecords?: Record<string, { wordsAdded: number; wordsDeleted: number }>;
			increments?: Increment[];
		}) | null;
		this.data = Object.assign({}, DEFAULT_DATA, saved);
		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
		if (!this.data.compacted) this.data.compacted = {};

		// Clean up stale settings fields
		delete (this.data.settings as unknown as Record<string, unknown>)["compactAfterDays"];

		this.initDeviceId();
		this.incrementFilePath = await this.resolveIncrementPath(this.getDeviceName());

		let needsSave = false;

		// Migrate from old dailyRecords format → per-device compacted with "legacy" key
		if (saved && "dailyRecords" in saved) {
			for (const [date, record] of Object.entries(saved.dailyRecords ?? {})) {
				const devices = this.data.compacted[date] ??= {};
				devices.legacy ??= {
					wordsAdded: record.wordsAdded,
					wordsDeleted: record.wordsDeleted,
				};
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
			this.myIncrements = saved.increments;
			delete (this.data as unknown as Record<string, unknown>)["increments"];
			await this.saveDeviceData();
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
		this.lastCompactedTs = loaded.lastCompactedTs ?? 0;
		this.timer.session = loaded.writingSession ?? null;
	}

	private saveSharedData(): Promise<void> {
		const write = this.sharedWrite.then(() => this.saveData(this.data));
		this.sharedWrite = write.catch(() => {});
		return write;
	}

	async saveAbacusData() {
		await this.saveSharedData();
		await this.saveDeviceData();
	}

	/** Called by Obsidian when data.json is modified externally (e.g., by Sync). */
	async onExternalSettingsChange() {
		const saved = await this.loadData() as Partial<AbacusData> | null;
		if (!saved) return;

		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
		delete (this.data.settings as unknown as Record<string, unknown>)["compactAfterDays"];

		this.mergeCompacted(saved.compacted ?? {});

		// Missing settings from older versions already have their default values.
		const normalized = { ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
		if (stableStringify(this.data) !== stableStringify(normalized)) {
			await this.saveSharedData();
		}

		this.updateStatusBar();
		this.refreshStatsView();
	}

	private mergeCompacted(incoming: AbacusData["compacted"]) {
		for (const [date, incomingDevices] of Object.entries(incoming)) {
			// Skip old-format entries that snuck through
			if (incomingDevices && "date" in (incomingDevices as Record<string, unknown>)) continue;

			if (!this.data.compacted[date]) {
				this.data.compacted[date] = {};
			}
			const localDevices = this.data.compacted[date];

			for (const [deviceId, incomingEntry] of Object.entries(incomingDevices)) {
				const localEntry = localDevices[deviceId];
				if (localEntry) {
					localEntry.wordsAdded = Math.max(localEntry.wordsAdded, incomingEntry.wordsAdded);
					localEntry.wordsDeleted = Math.max(localEntry.wordsDeleted, incomingEntry.wordsDeleted);
					if (incomingEntry.focusedMs) {
						localEntry.focusedMs = Math.max(localEntry.focusedMs ?? 0, incomingEntry.focusedMs);
					}
					if (incomingEntry.throughTs) {
						localEntry.throughTs = Math.max(localEntry.throughTs ?? 0, incomingEntry.throughTs);
					}
				} else {
					localDevices[deviceId] = { ...incomingEntry };
				}
			}
		}
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
			void this.saveDeviceData();
		}, 2000);
	}
}
