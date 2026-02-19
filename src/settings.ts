import { App, PluginSettingTab, Setting } from "obsidian";
import AbacusPlugin from "./main";

export class AbacusSettingTab extends PluginSettingTab {
	plugin: AbacusPlugin;

	constructor(app: App, plugin: AbacusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Abacus Settings" });

		new Setting(containerEl)
			.setName("Daily word goal")
			.setDesc("Target number of net words per day. Set to 0 to disable goal tracking.")
			.addText((text) =>
				text
					.setPlaceholder("500")
					.setValue(String(this.plugin.data.settings.dailyGoal))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0) {
							this.plugin.data.settings.dailyGoal = num;
							await this.plugin.saveAbacusData();
							this.plugin.updateStatusBar();
						}
					})
			);

		new Setting(containerEl)
			.setName("Reset today's count")
			.setDesc("Clear today's word count back to zero.")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					const today = new Date().toISOString().slice(0, 10);
					delete this.plugin.data.dailyRecords[today];
					await this.plugin.saveAbacusData();
					this.plugin.updateStatusBar();
					this.plugin.refreshStatsView();
				})
			);
	}
}
