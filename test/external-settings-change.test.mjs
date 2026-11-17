import assert from "node:assert/strict";
import test from "node:test";
import { AbacusPlugin } from "./plugin-fixture.mjs";

function createPlugin(localData, initialDiskData) {
	const plugin = new AbacusPlugin();
	let diskData = structuredClone(initialDiskData);
	let saveCount = 0;

	plugin.data = structuredClone(localData);
	plugin.loadData = async () => structuredClone(diskData);
	plugin.saveData = async (data) => {
		diskData = structuredClone(data);
		saveCount += 1;
	};
	plugin.updateStatusBar = () => {};
	plugin.refreshStatsView = () => {};

	return {
		plugin,
		getDiskData: () => diskData,
		getSaveCount: () => saveCount,
	};
}

test("does not rewrite external data when the merged state is unchanged", async () => {
	const data = {
		settings: { dailyGoal: 500 },
		compacted: {
			"2026-07-23": {
				straylight: { wordsAdded: 24, wordsDeleted: 2 },
			},
		},
	};
	const { plugin, getSaveCount } = createPlugin(data, data);

	await plugin.onExternalSettingsChange();

	assert.equal(getSaveCount(), 0);
});

test("does not rewrite semantically equal data with reordered keys", async () => {
	const diskData = {
		settings: { dailyGoal: 500 },
		compacted: {
			"2026-07-23": {
				phone: { wordsAdded: 301, wordsDeleted: 33 },
				straylight: { wordsAdded: 24, wordsDeleted: 2 },
			},
		},
	};
	const localData = {
		settings: { dailyGoal: 500 },
		compacted: {
			"2026-07-23": {
				straylight: { wordsAdded: 24, wordsDeleted: 2 },
				phone: { wordsAdded: 301, wordsDeleted: 33 },
			},
		},
	};
	const { plugin, getSaveCount } = createPlugin(localData, diskData);

	await plugin.onExternalSettingsChange();

	assert.equal(getSaveCount(), 0);
});

test("persists newer local counters once, then converges", async () => {
	const diskData = {
		settings: { dailyGoal: 500 },
		compacted: {
			"2026-07-23": {
				straylight: { wordsAdded: 24, wordsDeleted: 2 },
				phone: { wordsAdded: 301, wordsDeleted: 33 },
			},
		},
	};
	const localData = structuredClone(diskData);
	localData.compacted["2026-07-23"].straylight.wordsAdded = 30;
	const { plugin, getDiskData, getSaveCount } = createPlugin(localData, diskData);

	await plugin.onExternalSettingsChange();
	await plugin.onExternalSettingsChange();

	assert.equal(getSaveCount(), 1);
	assert.deepEqual(getDiskData().compacted["2026-07-23"], {
		straylight: { wordsAdded: 30, wordsDeleted: 2 },
		phone: { wordsAdded: 301, wordsDeleted: 33 },
	});
});
