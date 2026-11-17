import { Menu, Notice, setIcon } from "obsidian";
import type AbacusPlugin from "./main";
import { TimerAction, timerActions } from "./writing-timer";

function showTimerMenu(plugin: AbacusPlugin, actions: TimerAction[], event: MouseEvent) {
	const menu = new Menu();
	for (const action of actions) {
		menu.addItem((item) => item.setTitle(timerActions[action]).onClick(() => plugin.timerControls.run(action)));
	}
	menu.showAtMouseEvent(event);
}

function createTimerButton(parent: HTMLElement, plugin: AbacusPlugin): HTMLButtonElement {
	const button = parent.createEl("button", { cls: "abacus-timer-button" });
	button.type = "button";
	button.onclick = (event) => {
		const phase = plugin.timer.session?.phase;
		if (!phase || phase === "ready") {
			plugin.timerControls.run(phase ? "next" : "start");
			return;
		}
		showTimerMenu(plugin, plugin.timer.actions(), event);
	};
	return button;
}

/** Rebuild controls on phase changes. Only the countdown text changes on a tick. */
export function renderTimerPanel(parent: HTMLElement, plugin: AbacusPlugin): HTMLElement | null {
	const session = plugin.timer.session;
	const panel = parent.createDiv({ cls: "abacus-timer-panel", attr: { "data-phase": session?.phase ?? "idle" } });
	const heading = panel.createEl("h3", { cls: "abacus-timer-heading" });
	setIcon(heading.createSpan({ attr: { "aria-hidden": "true" } }), "timer");
	heading.createSpan({ text: "Writing timer" });

	const [primary, ...more] = plugin.timer.actions();
	if (more.length) {
		const menu = panel.createEl("button", { cls: "clickable-icon abacus-timer-menu",
			attr: { type: "button", "aria-label": "More timer actions", "aria-haspopup": "menu" } });
		setIcon(menu, "more-horizontal");
		menu.onclick = (event) => showTimerMenu(plugin, more, event);
	}

	let clock: HTMLElement | null = null;
	if (session) {
		const readout = panel.createDiv({ cls: "abacus-timer-readout" });
		if (session.phase !== "ready") {
			clock = readout.createDiv({ cls: "abacus-countdown", attr: { role: "timer", "aria-label": "Time remaining" } });
		}
		const round = `Round ${session.round} of ${session.rounds}`;
		readout.createDiv({ cls: "abacus-timer-round", text: session.phase === "paused" ? `Paused · ${round}` : round });
	}
	const button = panel.createEl("button", { cls: "abacus-timer-action", attr: { type: "button" } });
	setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), primary === "pause" ? "pause" : "play");
	const labels = { start: "Start", next: "Start round", pause: "Pause", resume: "Resume" };
	button.createSpan({ text: labels[primary] });
	button.setAttribute("aria-label", timerActions[primary]);
	button.onclick = () => plugin.timerControls.run(primary);
	return clock;
}

export class TimerControls {
	private button: HTMLButtonElement;
	private interval: number | null = null;

	constructor(private readonly plugin: AbacusPlugin) {
		this.button = createTimerButton(plugin.addStatusBarItem(), plugin);
		for (const action of Object.keys(timerActions) as TimerAction[]) {
			plugin.addCommand({
				id: `writing-timer-${action}`,
				name: timerActions[action],
				checkCallback: (checking) => {
					if (!plugin.timer.actions().includes(action)) return false;
					if (!checking) this.run(action);
					return true;
				},
			});
		}
		plugin.register(() => this.stopTicking());
		this.update();
	}

	run(action: TimerAction) {
		const now = Date.now();
		if (this.expire(now)) return;
		if (this.plugin.timer.apply(action, this.plugin.settings, now)) this.changed();
	}

	private expire(now: number) {
		if (!this.plugin.timer.expire(now)) return false;
		new Notice(this.plugin.timer.session ? "Writing round complete. Start the next round when you're ready." : "Writing session complete.");
		this.changed();
		return true;
	}

	private changed() {
		void this.plugin.saveDeviceData().catch(() => new Notice("Could not save the writing timer. Check your vault storage."));
		this.update();
		this.plugin.refreshStatsView();
	}

	private update() {
		this.button.setText(this.plugin.timer.label(Date.now()));
		this.button.title = this.plugin.timer.session ? "Writing timer controls" : timerActions.start;
		if (this.plugin.timer.session?.phase !== "running") {
			this.stopTicking();
		} else if (this.interval === null) {
			this.interval = window.setInterval(() => {
				const now = Date.now();
				if (this.expire(now)) return;
				this.button.setText(this.plugin.timer.label(now));
				this.plugin.refreshTimerDisplays(now);
			}, 1000);
		}
	}

	private stopTicking() {
		if (this.interval !== null) window.clearInterval(this.interval);
		this.interval = null;
	}
}
