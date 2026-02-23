import { Plugin, WorkspaceLeaf } from "obsidian";
import { AbacusData, AbacusSettings, DailyRecord, DEFAULT_DATA, DEFAULT_SETTINGS, localDateStr } from "./types";
import { AbacusSettingTab } from "./settings";
import { AbacusStatsView, VIEW_TYPE_ABACUS_STATS } from "./stats-view";
import { EditorView, ViewUpdate } from "@codemirror/view";

function getToday(): string {
	return localDateStr(new Date());
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
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

	async onload() {
		await this.loadAbacusData();
		this.compact();

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
				const today = getToday();
				this.data.increments = this.data.increments.filter((i) => i.date !== today);
				delete this.data.compacted[today];
				await this.saveAbacusData();
				this.updateStatusBar();
				this.refreshStatsView();
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
	}

	onunload() {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveAbacusData();
		}
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
		}
	}

	handleDocChange(update: ViewUpdate) {
		const wordsBefore = countWords(update.startState.doc.toString());
		const wordsAfter = countWords(update.state.doc.toString());
		const delta = wordsAfter - wordsBefore;

		if (delta === 0) return;

		const added = delta > 0 ? delta : 0;
		const deleted = delta < 0 ? -delta : 0;

		this.data.increments.push({
			ts: Date.now(),
			date: getToday(),
			added,
			deleted,
		});

		this.debounceSave();
		this.updateStatusBar();
		this.debounceRefreshStatsView();
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

		// Layer increments on top
		for (const inc of this.data.increments) {
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
		return (
			this.getDailyRecords()[today] ?? {
				date: today,
				wordsAdded: 0,
				wordsDeleted: 0,
				netWords: 0,
			}
		);
	}

	/**
	 * Compact increments older than compactAfterDays into daily summaries.
	 * Runs automatically on plugin load.
	 */
	compact() {
		const cutoff = daysAgo(this.data.settings.compactAfterDays);
		const toCompact = this.data.increments.filter((i) => i.date < cutoff);

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

		// Remove compacted increments
		this.data.increments = this.data.increments.filter((i) => i.date >= cutoff);
		this.saveAbacusData();
	}

	updateStatusBar() {
		const record = this.getTodayRecord();
		const goal = this.data.settings.dailyGoal;
		const net = record.netWords;

		if (goal > 0) {
			const pct = Math.min(100, Math.round((net / goal) * 100));
			const icon = net >= goal ? "\u2713" : "\u270f\ufe0f";
			this.statusBarEl.setText(`${icon} ${net} / ${goal} words (${pct}%)`);
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

	async loadAbacusData() {
		const saved = await this.loadData();
		this.data = Object.assign({}, DEFAULT_DATA, saved);
		this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
		if (!this.data.increments) this.data.increments = [];
		if (!this.data.compacted) this.data.compacted = {};

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
			this.saveAbacusData();
		}, 2000);
	}

	async saveAbacusData() {
		await this.saveData(this.data);
	}
}
