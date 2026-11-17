import { Buffer } from "node:buffer";
import process from "node:process";
import { build } from "esbuild";

const obsidianStub = `
	export class Plugin {}
	export class PluginSettingTab {}
	export class Setting {}
	export class ItemView {}
	export class Notice {}
	export class Menu {}
	export function setIcon() {}
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

export const AbacusPlugin = await loadPluginClass();
