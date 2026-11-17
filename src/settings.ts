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
			.setName("Writing round length")
			.setDesc("Minutes per round in a new writing session (1–1440).")
			.addText((text) => this.timerSetting(text.inputEl, "sessionMinutes", 1440));

		new Setting(containerEl)
			.setName("Writing rounds")
			.setDesc("Rounds per session (1–99). Start each round when you're ready.")
			.addText((text) => this.timerSetting(text.inputEl, "sessionRounds", 99));

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
					.setPlaceholder("Writing laptop")
					.setValue(this.plugin.getDeviceName())
					.onChange(async (value) => {
						await this.plugin.setDeviceName(value.trim());
						// Update the name in the increment file
						await this.plugin.saveAbacusData();
					})
			);
	}

	private timerSetting(input: HTMLInputElement, key: "sessionMinutes" | "sessionRounds", max: number) {
		input.type = "number";
		input.min = "1";
		input.max = String(max);
		input.step = "1";
		input.value = String(this.plugin.settings[key]);
		input.onchange = () => {
			const value = input.valueAsNumber;
			if (Number.isInteger(value) && value >= 1 && value <= max) {
				this.plugin.settings[key] = value;
				void this.plugin.saveAbacusData();
			} else {
				new Notice(`Enter a whole number between 1 and ${max}.`);
				input.value = String(this.plugin.settings[key]);
			}
		};
	}
}
