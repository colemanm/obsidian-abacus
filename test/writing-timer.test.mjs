import assert from "node:assert/strict";
import test from "node:test";
import { AbacusPlugin } from "./plugin-fixture.mjs";

const settings = { dailyGoal: 500, sessionMinutes: 1, sessionRounds: 2 };
const start = new Date(2026, 10, 17, 12).getTime();
const today = "2026-11-17";

// Share the two persisted files across plugin instances to exercise reload and Sync.
function vault() {
	const files = new Map();
	let shared = { settings: { dailyGoal: 500 }, compacted: {} };
	async function open() {
		const plugin = new AbacusPlugin();
		plugin.manifest = { dir: "abacus" };
		plugin.app = { vault: { adapter: {
			list: async () => ({ files: [...files.keys()] }),
			read: async (path) => files.get(path),
			write: async (path, data) => { files.set(path, data); },
		} } };
		plugin.initDeviceId = () => { plugin.deviceId = "laptop"; };
		plugin.getDeviceName = () => "";
		plugin.loadData = async () => structuredClone(shared);
		plugin.saveData = async (data) => { shared = structuredClone(data); };
		plugin.refreshStatsView = plugin.updateStatusBar = () => {};
		await plugin.loadAbacusData();
		return plugin;
	}
	return { files, open, shared: () => shared };
}

test("counts partial rounds and excludes pauses and the wait between manual starts", async () => {
	const plugin = await vault().open();
	const timer = plugin.timer;
	assert.equal(plugin.settings.sessionMinutes, 25);
	assert.equal(plugin.settings.sessionRounds, 1);
	timer.apply("start", settings, start);
	timer.apply("pause", settings, start + 5000);
	timer.apply("resume", settings, start + 15000);
	timer.apply("finish", settings, start + 18000);
	assert.equal(timer.session.phase, "ready");
	assert.equal(timer.session.round, 2);
	assert.equal(timer.expire(start + 180000), false);
	assert.equal(plugin.getDailyRecords()[today].focusedMs, 8000);
	timer.apply("next", { ...settings, sessionMinutes: 25 }, start + 180000);
	assert.equal(timer.remaining(start + 180000), 60000);
	timer.apply("end", settings, start + 182100);
	assert.equal(timer.session, null);
	assert.deepEqual(plugin.getDailyRecords()[today], {
		date: today, netWords: 0, wordsAdded: 0, wordsDeleted: 0, focusedMs: 10100,
	});
});

test("recovers a running timer after its deadline and splits a single round at local midnight", async () => {
	const disk = vault();
	const plugin = await disk.open();
	const late = new Date(2026, 10, 17, 23, 59, 50).getTime();
	plugin.timer.apply("start", settings, late);
	await plugin.saveDeviceData();
	const restored = await disk.open();
	assert.equal(restored.timer.expire(late + 86400000), true);
	assert.equal(restored.timer.expire(late + 86400000), false);
	await restored.compact();
	const again = await disk.open();
	assert.equal(again.timer.session.phase, "ready");
	assert.equal(again.timer.session.round, 2);
	assert.equal(again.getDailyRecords()[today].focusedMs, 10000);
	assert.equal(again.getDailyRecords()["2026-11-18"].focusedMs, 50000);
});

test("retains paused state and converges after compaction with an old device buffer", async () => {
	const disk = vault();
	const plugin = await disk.open();
	plugin.timer.apply("start", settings, start);
	plugin.timer.apply("pause", settings, start + 15000);
	await plugin.saveDeviceData();
	const path = "abacus/increments-laptop.json";
	const beforeCompaction = disk.files.get(path);
	await Promise.all([plugin.compact(), plugin.compact()]);
	assert.equal(disk.shared().compacted[today].laptop.focusedMs, 15000);
	// Simulate a restart after data.json was written but before buffer cleanup.
	disk.files.set(path, beforeCompaction);
	const restored = await disk.open();
	assert.equal(restored.timer.session.phase, "paused");
	assert.equal(restored.timer.remaining(start + 90000), 45000);
	assert.equal(restored.getDailyRecords()[today].focusedMs, 15000);
	await restored.compact();
	// An older device can contribute words without a focused time field.
	disk.shared().compacted[today].phone = { wordsAdded: 25, wordsDeleted: 2 };
	await restored.onExternalSettingsChange();
	disk.shared().compacted[today].phone.focusedMs = 1200;
	await restored.onExternalSettingsChange();
	await restored.onExternalSettingsChange();
	assert.equal(restored.getDailyRecords()[today].netWords, 23);
	assert.equal(restored.getDailyRecords()[today].focusedMs, 16200);
});
