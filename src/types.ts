export interface Increment {
	ts: number;       // Date.now() timestamp
	date: string;     // YYYY-MM-DD
	added: number;
	deleted: number;
}

export interface DeviceEntry {
	wordsAdded: number;
	wordsDeleted: number;
}

export interface DailyRecord {
	date: string;     // YYYY-MM-DD
	wordsAdded: number;
	wordsDeleted: number;
	netWords: number;
}

export interface AbacusSettings {
	dailyGoal: number;
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
}

export const COMPACT_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_SETTINGS: AbacusSettings = {
	dailyGoal: 500,
};

export const DEFAULT_DATA: AbacusData = {
	settings: { ...DEFAULT_SETTINGS },
	compacted: {},
};

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
