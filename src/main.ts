import { Plugin, WorkspaceLeaf } from "obsidian";
import { AbacusData, AbacusSettings, DailyRecord, DEFAULT_DATA, DEFAULT_SETTINGS, DeviceIncrementFile, Increment, localDateStr } from "./types";
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
	private allIncrements: Increment[] = [];

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

		this.addCommand({
			id: "reset-today",
			name: "Reset today's word count",
			callback: async () => {
				await this.resetToday();
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

		// Periodically re-read all increment files to pick up synced data
		this.registerInterval(
			window.setInterval(() => this.refreshAllIncrements(), 5 * 60 * 1000)
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
		this.allIncrements.push(inc);

		this.pendingAdded = 0;
		this.pendingDeleted = 0;
	}

	/**
	 * Aggregate increments + compacted summaries into DailyRecords.
	 */
	getDailyRecords(): Record<string, DailyRecord> {
		const records: Record<string, DailyRecord> = {};

		// Start with compacted data
		for (const [date, record] of Object.entries(this.data.compacted)) {
			records[date] = { ...record };
		}

		// Layer increments from all devices on top
		for (const inc of this.allIncrements) {
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
	 * Compact this device's increments before the cutoff date into daily summaries.
	 * Only compacts own device data — other devices compact their own.
	 */
	async compact(cutoff?: string) {
		if (!cutoff) cutoff = daysAgo(this.data.settings.compactAfterDays);
		const toCompact = this.myIncrements.filter((i) => i.date < cutoff);

		if (toCompact.length === 0) return;

		// Aggregate old increments into compacted summaries
		for (const inc of toCompact) {
			const existing = this.data.compacted[inc.date];
			if (existing) {
				existing.wordsAdded += inc.added;
				existing.wordsDeleted += inc.deleted;
				existing.netWords = existing.wordsAdded - existing.wordsDeleted;
			} else {
				this.data.compacted[inc.date] = {
					date: inc.date,
					wordsAdded: inc.added,
					wordsDeleted: inc.deleted,
					netWords: inc.added - inc.deleted,
				};
			}
		}

		// Remove compacted increments from own device
		this.myIncrements = this.myIncrements.filter((i) => i.date >= cutoff!);
		await this.saveAbacusData();
		// Reload merged view
		this.allIncrements = await this.readAllIncrements();
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

	private async listIncrementFiles(): Promise<string[]> {
		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(this.pluginDir);
		return listing.files.filter((f) => /\/increments-.+\.json$/.test(f));
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
		};
		await adapter.write(this.incrementFilePath, JSON.stringify(file, null, "\t"));
	}

	/** Load this device's increment file, searching by path or by deviceId inside JSON. */
	private async loadMyIncrementFile(): Promise<Increment[]> {
		// Try the current path first (name-based or id-based)
		const myFile = await this.readIncrementFile(this.incrementFilePath);
		if (myFile) return myFile.increments;

		// Fall back: scan all increment files for one matching our deviceId
		// (handles case where device name was set/changed since the file was written)
		const files = await this.listIncrementFiles();
		for (const path of files) {
			const file = await this.readIncrementFile(path);
			if (file && file.deviceId === this.deviceId) {
				// Rename to current expected path
				const adapter = this.app.vault.adapter;
				const newPath = this.incrementFilePath;
				if (path !== newPath) {
					await adapter.write(newPath, JSON.stringify(file, null, "\t"));
					await adapter.remove(path);
				}
				return file.increments;
			}
		}

		return [];
	}

	private async readAllIncrements(): Promise<Increment[]> {
		const files = await this.listIncrementFiles();
		const all: Increment[] = [];
		const seenTs = new Set<number>();

		for (const path of files) {
			const file = await this.readIncrementFile(path);
			if (!file) continue;
			for (const inc of file.increments) {
				// Deduplicate by timestamp to handle migration edge case
				if (!seenTs.has(inc.ts)) {
					seenTs.add(inc.ts);
					all.push(inc);
				}
			}
		}

		return all;
	}

	// --- Load / Save ---

	async loadAbacusData() {
		const saved = await this.loadData();
		this.data = Object.assign({}, DEFAULT_DATA, saved);
		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
		if (!this.data.compacted) this.data.compacted = {};

		this.initDeviceId();

		// Migrate from old dailyRecords format
		if (saved && "dailyRecords" in saved) {
			const old = saved as { dailyRecords?: Record<string, DailyRecord> };
			if (old.dailyRecords) {
				for (const [date, record] of Object.entries(old.dailyRecords)) {
					if (!this.data.compacted[date]) {
						this.data.compacted[date] = { ...record };
					}
				}
			}
			delete (this.data as unknown as Record<string, unknown>)["dailyRecords"];
		}

		// Migrate increments from data.json to per-device file
		if (saved && "increments" in saved && Array.isArray(saved.increments) && saved.increments.length > 0 && !this.data.migratedToPerDevice) {
			this.myIncrements = saved.increments as Increment[];
			this.data.migratedToPerDevice = true;
			// Remove increments from shared data
			delete (this.data as unknown as Record<string, unknown>)["increments"];
			await this.writeMyIncrements();
			await this.saveSharedData();
		} else {
			// Remove stale increments key if present
			delete (this.data as unknown as Record<string, unknown>)["increments"];
			if (!this.data.migratedToPerDevice) {
				this.data.migratedToPerDevice = true;
				await this.saveSharedData();
			}
			// Load this device's increment file
			this.myIncrements = await this.loadMyIncrementFile();
		}

		// Load merged view from all devices
		this.allIncrements = await this.readAllIncrements();
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

	async resetToday() {
		const today = getToday();
		this.myIncrements = this.myIncrements.filter((i) => i.date !== today);
		delete this.data.compacted[today];
		await this.saveAbacusData();
		this.allIncrements = await this.readAllIncrements();
		this.updateStatusBar();
		this.refreshStatsView();
	}

	/** Called by Obsidian when data.json is modified externally (e.g., by Sync). */
	async onExternalSettingsChange() {
		const saved = await this.loadData();
		if (saved) {
			this.data.settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
			this.data.compacted = saved.compacted ?? {};
			this.data.migratedToPerDevice = saved.migratedToPerDevice;
		}
		this.allIncrements = await this.readAllIncrements();
		this.updateStatusBar();
		this.refreshStatsView();
	}

	private async refreshAllIncrements() {
		this.allIncrements = await this.readAllIncrements();
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
