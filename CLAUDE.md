# Abacus — Claude Code Guidelines

## Project
Obsidian plugin (TypeScript, esbuild). Build: `npm run build` (tsc + esbuild).

## Versioning Convention
- **Semver**: patch for bug fixes, minor for new features/enhancements, major for breaking changes
- **Three files to bump together**: `package.json`, `manifest.json`, `versions.json`
- **CHANGELOG.md**: update with each meaningful change using [Keep a Changelog](https://keepachangelog.com/) format (Added/Changed/Fixed/Removed sections)
- After meaningful commits, suggest appropriate semver bump level

### Files to Update on Version Bump
1. `package.json` — `version` field
2. `manifest.json` — `version` field
3. `versions.json` — add `"<version>": "<minAppVersion>"` entry (currently `"0.15.0"`)
