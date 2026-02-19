import { Plugin, WorkspaceLeaf } from "obsidian";
import { AbacusData, AbacusSettings, DailyRecord, DEFAULT_DATA, DEFAULT_SETTINGS } from "./types";
import { AbacusSettingTab } from "./settings";
import { AbacusStatsView, VIEW_TYPE_ABACUS_STATS } from "./stats-view";
import { EditorView, ViewUpdate } from "@codemirror/view";

function getToday(): string {
	const d = new Date();
	return d.toISOString().slice(0, 10);
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
}

export default class AbacusPlugin extends Plugin {
	data: AbacusData;
	statusBarEl: HTMLElement;

	async onload() {
		await this.loadAbacusData();

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
				delete this.data.dailyRecords[today];
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

		// Refresh status bar every minute to handle day rollover
		this.registerInterval(
			window.setInterval(() => this.updateStatusBar(), 60 * 1000)
		);
	}

	onunload() {}

	handleDocChange(update: ViewUpdate) {
		let added = 0;
		let deleted = 0;

		update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
			const removedText = update.startState.sliceDoc(fromA, toA);
			const insertedText = inserted.toString();
			deleted += countWords(removedText);
			added += countWords(insertedText);
		});

		if (added === 0 && deleted === 0) return;

		const today = getToday();
		const record = this.getTodayRecord(today);
		record.wordsAdded += added;
		record.wordsDeleted += deleted;
		record.netWords = record.wordsAdded - record.wordsDeleted;

		this.data.dailyRecords[today] = record;
		this.saveAbacusData();
		this.updateStatusBar();
		this.refreshStatsView();
	}

	getTodayRecord(today: string): DailyRecord {
		return (
			this.data.dailyRecords[today] ?? {
				date: today,
				wordsAdded: 0,
				wordsDeleted: 0,
				netWords: 0,
			}
		);
	}

	updateStatusBar() {
		const today = getToday();
		const record = this.getTodayRecord(today);
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
		if (!this.data.dailyRecords) {
			this.data.dailyRecords = {};
		}
	}

	async saveAbacusData() {
		await this.saveData(this.data);
	}
}
