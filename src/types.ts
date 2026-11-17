import type { WritingSession } from "./writing-timer";

export interface Increment {
	ts: number;       // Date.now() timestamp
	date: string;     // YYYY-MM-DD
	added: number;
	deleted: number;
	focusedMs?: number;
}

export interface DeviceEntry {
	wordsAdded: number;
	wordsDeleted: number;
	focusedMs?: number;
	// Highest increment already included for this device and date.
	throughTs?: number;
}

export interface DailyRecord {
	date: string;     // YYYY-MM-DD
	wordsAdded: number;
	wordsDeleted: number;
	netWords: number;
	focusedMs: number;
}

export interface AbacusSettings {
	dailyGoal: number;
	sessionMinutes: number;
	sessionRounds: number;
}

export interface AbacusData {
	settings: AbacusSettings;
	// Compacted daily summaries keyed by date, then by deviceId
	compacted: Record<string, Record<string, DeviceEntry>>;
}

export interface DeviceIncrementFile {
	deviceId: string;
	deviceName?: string;
	increments: Increment[];
	lastCompactedTs?: number;
	writingSession?: WritingSession;
}

export const COMPACT_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_SETTINGS: AbacusSettings = {
	dailyGoal: 500,
	sessionMinutes: 25,
	sessionRounds: 1,
};

export const DEFAULT_DATA: AbacusData = {
	settings: { ...DEFAULT_SETTINGS },
	compacted: {},
};

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
