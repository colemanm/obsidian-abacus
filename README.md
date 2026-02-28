# Abacus

An Obsidian plugin that tracks your daily word count with goals, streaks, and historical stats.

- **See your progress as you write** — a live word count in the status bar shows today's net words, goal progress, and current streak
- **Set daily goals and build streaks** — choose a daily word target and watch your streak grow as you hit it day after day
- **Review your writing history** — a sidebar panel shows today's stats, weekly and monthly totals, a full history table, and a 30-day bar chart
- **Works across devices** — write on your laptop, pick up on your iPad, and see combined totals everywhere. Each device tracks its own counts in a separate file, so nothing gets lost when Obsidian Sync runs
- **Stays out of your way** — no configuration required to get started. Counts update in the background as you type with no manual logging

## How it works

### Word tracking
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

### Multi-device support & Obsidian Sync
Abacus stores each device's word counts in its own file, so devices never overwrite each other's data. Stats from all devices are merged automatically — write 200 words on your laptop and 300 on your phone, and the sidebar shows 500 for the day.

Each device is identified automatically on first run. You can optionally give each device a friendly name in settings (e.g., "MacBook", "iPad") which is used in the filename for easy identification.

Older data is automatically compacted into daily summaries after 30 days (configurable) to keep storage efficient. A manual "Compact now" button is available in settings.

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
| **Device name** | Friendly name for this device (stored locally, not synced) | — |
| **Reset today** | Clear today's word count | — |

## Installation

### Manual
1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder `abacus` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Enable the plugin in Settings > Community plugins

### From source
1. Clone this repository
2. `npm install && npm run build`
3. Symlink the repo into your vault: `ln -s /path/to/obsidian-abacus VaultFolder/.obsidian/plugins/abacus`
4. Enable the plugin in Settings > Community plugins

### Updating
```bash
git pull
npm run build
```
Then reload the plugin or restart Obsidian.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # eslint check
```
