# Abacus

An Obsidian plugin that tracks your daily word count with goals and historical stats.

## Features

### Real-time word tracking
Abacus listens to editor changes as you type and computes the net words written per day (words added minus words deleted). Counts are tracked across all files in the vault.

### Status bar
Displays today's progress in the bottom status bar:
- With a goal set: `✏️ 347 / 500 words (69%)`
- Without a goal: `✏️ 347 words today`
- Goal complete: `✓ 512 / 500 words (100%)`

### Sidebar stats view
Open the stats panel from the ribbon icon (bar chart) or the command palette ("Abacus: View daily word stats") to see:
- **Today's summary** — net words, words added, and words deleted
- **Goal progress bar** — visual indicator of daily goal completion
- **History table** — all recorded days with net, added, deleted, and goal percentage
- **Bar chart** — last 30 days of word counts at a glance

### Daily word goal
Set a target number of words per day (default: 500) in Settings > Abacus. The status bar and sidebar view show your progress toward the goal. Set to 0 to disable goal tracking.

## Commands

| Command | Description |
|---------|-------------|
| **View daily word stats** | Opens the sidebar stats panel |
| **Reset today's word count** | Clears today's tally back to zero |

## Installation

### Manual
1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder `abacus` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Enable the plugin in Settings > Community plugins

### From source
1. Clone this repository
2. Run `npm install`
3. Run `npm run build`
4. Copy `main.js`, `styles.css`, and `manifest.json` to `VaultFolder/.obsidian/plugins/abacus/`

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # eslint check
```
