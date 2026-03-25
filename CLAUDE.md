# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Abacus is an Obsidian community plugin that tracks daily word counts with goals and historical statistics. It uses an append-only increment model with automatic compaction of older data.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Watch mode (rebuilds on save)
npm run build        # TypeScript check + production esbuild bundle
npm run lint         # ESLint (uses flat config with obsidianmd plugin)
```

## Testing with Obsidian CLI

After making changes, build and reload the plugin using the Obsidian CLI:

```bash
npm run build
obsidian plugin:reload id=abacus
```

Useful CLI commands:
- `obsidian help` — list available commands
- `obsidian restart` — restart the Obsidian app
- `obsidian plugin:reload id=abacus` — reload the plugin after changes
- `dev:screenshot` — take a screenshot of the current state
- `dev:debug` / `dev:console` — view console messages for debugging

## Architecture

**Build pipeline:** TypeScript (`src/`) → esbuild → `main.js` (CommonJS). Obsidian and CodeMirror modules are kept external (not bundled).

**Source files (`src/`):**

- **main.ts** — Plugin lifecycle, CodeMirror `updateListener` for editor change detection, word counting, increment recording, data persistence (2s debounced saves), status bar updates, and auto-compaction on startup.
- **settings.ts** — Settings tab UI (daily goal, compaction threshold, reset button).
- **stats-view.ts** — Sidebar panel: today's summary cards, goal progress bar, history table, and 30-day bar chart.
- **types.ts** — Shared interfaces (`Increment`, `DailyRecord`, `AbacusSettings`, `AbacusData`) and default constants.

**Data model:** Each editor change appends an `Increment` (timestamp, date, added, deleted). On startup, increments older than `compactAfterDays` (default 30) are aggregated into `compacted` daily records. The plugin merges both sources when computing stats.

**Key patterns:**
- Word counting splits on `/\s+/` after trimming
- Status bar refreshes every minute via `registerInterval`
- All listeners/intervals use `this.register*` helpers for safe cleanup
- Data stored via Obsidian's `loadData()`/`saveData()` (writes to `data.json` in the plugin folder)

## Versioning Convention

- **Semver**: patch for bug fixes, minor for new features/enhancements, major for breaking changes
- **Three files to bump together**: `package.json`, `manifest.json`, `versions.json`
- **CHANGELOG.md**: update with each meaningful change using [Keep a Changelog](https://keepachangelog.com/) format (Added/Changed/Fixed/Removed sections)
- After meaningful commits, suggest appropriate semver bump level

### Files to Update on Version Bump

1. `package.json` — `version` field
2. `manifest.json` — `version` field
3. `versions.json` — add `"<version>": "<minAppVersion>"` entry (currently `"0.15.0"`)

## Conventions

- TypeScript strict mode enabled
- Keep `main.ts` focused on plugin lifecycle; delegate features to separate modules
- Styles use Obsidian CSS variables (e.g., `--text-normal`, `--background-secondary`) to match the native theme
- `isDesktopOnly: false` — avoid Node/Electron-only APIs for mobile compatibility
- Command IDs are stable; never rename after release
- Version bumping: `npm run version` updates `manifest.json` and `versions.json`
