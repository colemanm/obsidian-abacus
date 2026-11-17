import { AbacusSettings, localDateStr } from "./types";

export type WritingSession = {
	durationMs: number;
	remainingMs: number;
	round: number;
	rounds: number;
} & ({ phase: "running"; startedAt: number } | { phase: "paused" | "ready" });

export const timerActions = {
	start: "Start writing session",
	next: "Start next writing round",
	pause: "Pause writing timer",
	resume: "Resume writing timer",
	finish: "Finish writing round",
	end: "End writing session",
};
export type TimerAction = keyof typeof timerActions;
type PrimaryAction = "start" | "next" | "pause" | "resume";

export class WritingTimer {
	session: WritingSession | null = null;

	constructor(private readonly credit: (date: string, milliseconds: number) => void) {}

	actions(): [PrimaryAction, ...TimerAction[]] {
		const session = this.session;
		if (!session) return ["start"];
		if (session.phase === "ready") return ["next", "end"];
		const actions: [PrimaryAction, ...TimerAction[]] = [session.phase === "paused" ? "resume" : "pause"];
		if (session.round < session.rounds) actions.push("finish");
		actions.push("end");
		return actions;
	}

	remaining(now: number): number {
		const session = this.session;
		if (!session) return 0;
		if (session.phase !== "running") return session.remainingMs;
		return Math.max(0, session.remainingMs - Math.max(0, now - session.startedAt));
	}

	/** Split only the running segment at local midnights, capped at its deadline. */
	liveTime(now: number): Record<string, number> {
		const result: Record<string, number> = {};
		const session = this.session;
		if (session?.phase !== "running") return result;
		const end = Math.min(now, session.startedAt + session.remainingMs);
		let cursor = session.startedAt;
		while (cursor < end) {
			const midnight = new Date(cursor);
			midnight.setHours(24, 0, 0, 0);
			const until = Math.min(end, midnight.getTime());
			result[localDateStr(new Date(cursor))] = until - cursor;
			cursor = until;
		}
		return result;
	}

	expire(now: number): boolean {
		if (this.session?.phase !== "running" || this.remaining(now) > 0) return false;
		this.settle("finish", now);
		return true;
	}

	apply(action: TimerAction, settings: AbacusSettings, now: number): boolean {
		if (!this.actions().includes(action)) return false;
		if (action === "start") {
			const durationMs = settings.sessionMinutes * 60_000;
			this.session = {
				phase: "running",
				startedAt: now,
				durationMs,
				remainingMs: durationMs,
				round: 1,
				rounds: settings.sessionRounds,
			};
		} else if (action === "resume" || action === "next") {
			this.session = { ...this.session!, phase: "running", startedAt: now };
		} else {
			this.settle(action, now);
		}
		return true;
	}

	private settle(action: "finish" | "end" | "pause", now: number) {
		const session = this.session!;
		for (const [date, milliseconds] of Object.entries(this.liveTime(now))) {
			this.credit(date, milliseconds);
		}
		const { durationMs, rounds, round } = session;
		const remainingMs = this.remaining(now);
		if (action === "pause" && remainingMs > 0) {
			this.session = { phase: "paused", remainingMs, durationMs, round, rounds };
		} else if (action !== "end" && round < rounds) {
			this.session = { phase: "ready", remainingMs: durationMs, durationMs, round: round + 1, rounds };
		} else {
			this.session = null;
		}
	}

	countdown(now: number): string {
		const seconds = Math.ceil(this.remaining(now) / 1000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	}

	label(now: number): string {
		const session = this.session;
		if (!session) return "Start timer";
		if (session.phase === "ready") return `Start round ${session.round}/${session.rounds}`;
		return `${session.phase === "paused" ? "Paused " : ""}${this.countdown(now)} · ${session.round}/${session.rounds}`;
	}
}

export function formatFocusedTime(ms: number): string {
	if (ms <= 0) return "0 min";
	if (ms < 60_000) return "<1 min";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const hours = `${Math.floor(minutes / 60)}h`;
	return minutes % 60 ? `${hours} ${minutes % 60}m` : hours;
}
