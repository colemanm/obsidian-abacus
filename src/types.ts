export interface DailyRecord {
	date: string; // YYYY-MM-DD
	wordsAdded: number;
	wordsDeleted: number;
	netWords: number;
}

export interface AbacusSettings {
	dailyGoal: number;
}

export interface AbacusData {
	settings: AbacusSettings;
	dailyRecords: Record<string, DailyRecord>; // keyed by YYYY-MM-DD
}

export const DEFAULT_SETTINGS: AbacusSettings = {
	dailyGoal: 500,
};

export const DEFAULT_DATA: AbacusData = {
	settings: { ...DEFAULT_SETTINGS },
	dailyRecords: {},
};
