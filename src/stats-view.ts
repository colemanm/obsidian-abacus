import { ItemView, WorkspaceLeaf } from "obsidian";
import AbacusPlugin from "./main";
import { DailyRecord, localDateStr } from "./types";

export const VIEW_TYPE_ABACUS_STATS = "abacus-stats-view";

export class AbacusStatsView extends ItemView {
	plugin: AbacusPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AbacusPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_ABACUS_STATS;
	}

	getDisplayText(): string {
		return "Abacus Stats";
	}

	getIcon(): string {
		return "bar-chart-2";
	}

	async onOpen() {
		this.refresh();
	}

	async onClose() {}

	refresh() {
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();

		const wrapper = container.createDiv({ cls: "abacus-stats" });
		const records = this.getDailyRecords();
		const goal = this.plugin.data.settings.dailyGoal;

		// Today summary
		const today = localDateStr(new Date());
		const todayRecord = records[today];
		const net = todayRecord?.netWords ?? 0;
		const added = todayRecord?.wordsAdded ?? 0;
		const deleted = todayRecord?.wordsDeleted ?? 0;

		const summaryEl = wrapper.createDiv({ cls: "abacus-today-summary" });
		summaryEl.createEl("h3", { text: "Today" });

		const statsGrid = summaryEl.createDiv({ cls: "abacus-today-grid" });
		this.createStatCard(statsGrid, "Net Words", String(net));
		this.createStatCard(statsGrid, "Added", `+${added}`);
		this.createStatCard(statsGrid, "Deleted", `-${deleted}`);

		if (goal > 0) {
			const pct = Math.min(100, Math.round((net / goal) * 100));
			const progressEl = summaryEl.createDiv({ cls: "abacus-progress-container" });
			progressEl.createEl("div", { cls: "abacus-progress-label", text: `Goal: ${net} / ${goal} (${pct}%)` });
			const barOuter = progressEl.createDiv({ cls: "abacus-progress-bar" });
			const barInner = barOuter.createDiv({ cls: "abacus-progress-fill" });
			barInner.style.width = `${pct}%`;
			if (pct >= 100) {
				barInner.addClass("abacus-progress-complete");
			}

			const streak = this.plugin.getStreak();
			const streakText = streak > 0 ? `${streak}-day streak` : "No active streak";
			progressEl.createEl("div", { cls: "abacus-streak-label", text: streakText });
		}

		// Weekly & monthly summaries
		this.renderPeriodSummaries(wrapper, records);

		// History table
		const historyEl = wrapper.createDiv({ cls: "abacus-history" });
		historyEl.createEl("h3", { text: "History" });

		const sorted = this.getSortedRecords(records);

		if (sorted.length === 0) {
			historyEl.createEl("p", { text: "No word count data yet. Start typing!", cls: "abacus-empty" });
			return;
		}

		const table = historyEl.createEl("table", { cls: "abacus-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Date" });
		headerRow.createEl("th", { text: "Net" });
		headerRow.createEl("th", { text: "Added" });
		headerRow.createEl("th", { text: "Deleted" });
		if (goal > 0) {
			headerRow.createEl("th", { text: "Goal %" });
		}

		const tbody = table.createEl("tbody");
		for (const record of sorted) {
			const row = tbody.createEl("tr");
			row.createEl("td", { text: this.formatDate(record.date) });
			row.createEl("td", { text: String(record.netWords), cls: record.netWords >= 0 ? "abacus-positive" : "abacus-negative" });
			row.createEl("td", { text: `+${record.wordsAdded}` });
			row.createEl("td", { text: `-${record.wordsDeleted}` });
			if (goal > 0) {
				const pct = Math.round((record.netWords / goal) * 100);
				const cell = row.createEl("td", { text: `${pct}%` });
				if (pct >= 100) cell.addClass("abacus-goal-met");
			}
		}

		// Bar chart visualization
		if (sorted.length > 1) {
			const chartEl = wrapper.createDiv({ cls: "abacus-chart" });
			chartEl.createEl("h3", { text: "Last 30 Days" });
			this.renderBarChart(chartEl, sorted.slice(0, 30));
		}
	}

	private renderPeriodSummaries(wrapper: HTMLElement, records: Record<string, DailyRecord>) {
		const now = new Date();

		// This week: Monday through today
		const dayOfWeek = now.getDay();
		const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
		const monday = new Date(now);
		monday.setDate(now.getDate() - mondayOffset);
		const weekDays = mondayOffset + 1;

		// This month: 1st through today
		const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const monthDays = now.getDate();

		const weekStats = this.sumPeriod(records, monday, now);
		const monthStats = this.sumPeriod(records, firstOfMonth, now);

		const section = wrapper.createDiv({ cls: "abacus-period-summary" });

		const row = section.createDiv({ cls: "abacus-period-row" });

		const weekCard = row.createDiv({ cls: "abacus-period-card" });
		weekCard.createEl("div", { cls: "abacus-period-label", text: "This week" });
		weekCard.createEl("div", { cls: "abacus-period-value", text: String(weekStats.net) });
		weekCard.createEl("div", { cls: "abacus-period-avg", text: `${Math.round(weekStats.net / weekDays)} avg/day` });

		const monthCard = row.createDiv({ cls: "abacus-period-card" });
		monthCard.createEl("div", { cls: "abacus-period-label", text: "This month" });
		monthCard.createEl("div", { cls: "abacus-period-value", text: String(monthStats.net) });
		monthCard.createEl("div", { cls: "abacus-period-avg", text: `${Math.round(monthStats.net / monthDays)} avg/day` });
	}

	private sumPeriod(records: Record<string, DailyRecord>, from: Date, to: Date): { net: number; added: number; deleted: number } {
		let net = 0, added = 0, deleted = 0;
		const cursor = new Date(from);
		while (cursor <= to) {
			const key = localDateStr(cursor);
			const record = records[key];
			if (record) {
				net += record.netWords;
				added += record.wordsAdded;
				deleted += record.wordsDeleted;
			}
			cursor.setDate(cursor.getDate() + 1);
		}
		return { net, added, deleted };
	}

	private getDailyRecords(): Record<string, DailyRecord> {
		return this.plugin.getDailyRecords();
	}

	private createStatCard(parent: HTMLElement, label: string, value: string) {
		const card = parent.createDiv({ cls: "abacus-stat-card" });
		card.createDiv({ cls: "abacus-stat-value", text: value });
		card.createDiv({ cls: "abacus-stat-label", text: label });
	}

	private getSortedRecords(records: Record<string, DailyRecord>): DailyRecord[] {
		const list = Object.values(records);
		list.sort((a, b) => b.date.localeCompare(a.date));
		return list;
	}

	private formatDate(dateStr: string): string {
		const [year, month, day] = dateStr.split("-");
		const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const currentYear = String(new Date().getFullYear());
		const base = `${months[parseInt(month!, 10) - 1]} ${parseInt(day!, 10)}`;
		return year === currentYear ? base : `${base}, ${year}`;
	}

	private renderBarChart(container: HTMLElement, records: DailyRecord[]) {
		const reversed = [...records].reverse();
		const maxVal = Math.max(...reversed.map((r) => Math.abs(r.netWords)), 1);
		const goal = this.plugin.data.settings.dailyGoal;

		const chartWrapper = container.createDiv({ cls: "abacus-bar-chart" });

		for (const record of reversed) {
			const col = chartWrapper.createDiv({ cls: "abacus-bar-col" });
			const barArea = col.createDiv({ cls: "abacus-bar-area" });
			const bar = barArea.createDiv({ cls: "abacus-bar" });
			const heightPct = Math.round((Math.abs(record.netWords) / maxVal) * 100);
			bar.style.height = `${heightPct}%`;

			if (record.netWords < 0) {
				bar.addClass("abacus-bar-negative");
			} else if (goal > 0 && record.netWords >= goal) {
				bar.addClass("abacus-bar-goal-met");
			}

			bar.setAttribute("aria-label", `${record.date}: ${record.netWords} words`);

			const label = col.createDiv({ cls: "abacus-bar-label" });
			const day = record.date.slice(8);
			label.setText(day);
		}

		// Goal line
		if (goal > 0 && goal <= maxVal) {
			const goalPct = Math.round((goal / maxVal) * 100);
			const goalLine = chartWrapper.createDiv({ cls: "abacus-goal-line" });
			goalLine.style.bottom = `${goalPct}%`;
		}
	}
}
