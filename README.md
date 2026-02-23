# Abacus

An Obsidian plugin that tracks your daily word count with goals, streaks, and historical stats.

## Features

### Real-time word tracking
Abacus listens to editor changes as you type and computes the net words written per day (words added minus words deleted). Counts are tracked across all files in the vault. Changes are batched efficiently — individual keystrokes are accumulated in memory and flushed as a single entry every 2 seconds.

### Status bar
Displays today's progress in the bottom status bar:
- With a goal set: `✏️ 347 / 500 words (69%)`
- With a streak: `✏️ 347 / 500 words (69%) | 3d streak`
- Goal complete: `✓ 512 / 500 words (100%) | 3d streak`
- Without a goal: `✏️ 347 words today`

### Sidebar stats view
Open the stats panel from the ribbon icon (bar chart) or the command palette ("Abacus: View daily word stats") to see:
- **Today's summary** — net words, words added, and words deleted
- **Goal progress bar** — visual indicator of daily goal completion
- **Streak counter** — consecutive days meeting the daily goal
- **Weekly & monthly totals** — net words and daily average for the current week and month
- **History table** — all recorded days with net, added, deleted, and goal percentage
- **Bar chart** — last 30 days of word counts at a glance

### Daily word goal
Set a target number of words per day (default: 500) in Settings > Abacus. The status bar and sidebar view show your progress toward the goal. Set to 0 to disable goal tracking.

### Streak tracking
Tracks consecutive days where you met your daily word goal. The streak counts backwards from yesterday — today is always in progress. Displayed in both the status bar and sidebar.

### Sync-safe data model
Data is stored as append-only increments, making it safe to sync between devices with Obsidian Sync. Older increments are automatically compacted into daily summaries after 30 days (configurable). A manual "Compact now" button is available in settings.

## Commands

| Command | Description |
|---------|-------------|
| **View daily word stats** | Opens the sidebar stats panel |
| **Reset today's word count** | Clears today's tally back to zero |

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Daily word goal** | Target net words per day. Set to 0 to disable. | 500 |
| **Compaction threshold** | Days of granular data to keep before auto-compacting | 30 |
| **Compact now** | Manually compact all increments before today | — |
| **Reset today** | Clear today's word count | — |

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
