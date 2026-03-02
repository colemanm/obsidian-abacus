import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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
			.setName("Compact now")
			.setDesc("Merge buffered increments into synced data immediately.")
			.addButton((button) =>
				button.setButtonText("Compact now").onClick(async () => {
					const before = this.plugin.myIncrementsCount;
					await this.plugin.compact();
					const after = this.plugin.myIncrementsCount;
					const compacted = before - after;
					new Notice(`Abacus: compacted ${compacted} increment${compacted === 1 ? "" : "s"}`);
				})
			);

		new Setting(containerEl)
			.setName("Device name")
			.setDesc("Optional friendly name for this device (stored locally, not synced).")
			.addText((text) =>
				text
					.setPlaceholder("e.g. MacBook, iPad")
					.setValue(this.plugin.getDeviceName())
					.onChange(async (value) => {
						await this.plugin.setDeviceName(value.trim());
						// Update the name in the increment file
						await this.plugin.saveAbacusData();
					})
			);
	}
}
