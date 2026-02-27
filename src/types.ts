export interface Increment {
	ts: number;       // Date.now() timestamp
	date: string;     // YYYY-MM-DD
	added: number;
	deleted: number;
}

export interface DailyRecord {
	date: string;     // YYYY-MM-DD
	wordsAdded: number;
	wordsDeleted: number;
	netWords: number;
}

export interface AbacusSettings {
	dailyGoal: number;
	compactAfterDays: number;
}

export interface AbacusData {
	settings: AbacusSettings;
	// Compacted daily summaries for older data
	compacted: Record<string, DailyRecord>;
	migratedToPerDevice?: boolean;
}

export interface DeviceIncrementFile {
	deviceId: string;
	deviceName?: string;
	increments: Increment[];
}

export const DEFAULT_SETTINGS: AbacusSettings = {
	dailyGoal: 500,
	compactAfterDays: 30,
};

export const DEFAULT_DATA: AbacusData = {
	settings: { ...DEFAULT_SETTINGS },
	compacted: {},
};

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
