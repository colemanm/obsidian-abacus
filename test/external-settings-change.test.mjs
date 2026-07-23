import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { build } from "esbuild";

const obsidianStub = `
	export class Plugin {}
	export class PluginSettingTab {}
	export class Setting {}
	export class ItemView {}
	export class Notice {}
`;

const codeMirrorViewStub = `
	export const EditorView = { updateListener: { of: (listener) => listener } };
`;

async function loadPluginClass() {
	const result = await build({
		absWorkingDir: process.cwd(),
		bundle: true,
		entryPoints: ["src/main.ts"],
		format: "esm",
		platform: "node",
		plugins: [{
			name: "obsidian-test-stubs",
			setup(builder) {
				builder.onResolve(
					{ filter: /^(obsidian|@codemirror\/view)$/ },
					({ path }) => ({ path, namespace: "test-stub" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "test-stub" }, ({ path }) => ({
					contents: path === "obsidian" ? obsidianStub : codeMirrorViewStub,
					loader: "js",
				}));
			},
		}],
		write: false,
	});
	const bundledSource = Buffer.from(result.outputFiles[0].contents).toString("base64");
	return (await import(`data:text/javascript;base64,${bundledSource}`)).default;
}

const AbacusPlugin = await loadPluginClass();

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
