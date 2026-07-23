# Changelog

All notable changes to Abacus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Prevent external settings merges from repeatedly rewriting unchanged data and blocking Obsidian Sync

## [1.2.1] - 2026-04-20

### Changed
- Removed redundant "Abacus Settings" heading from settings tab per Obsidian plugin guidelines

## [1.2.0] - 2026-03-25

### Changed
- Redesigned today's stats: "Words Added" is now the primary metric with added/deleted as secondary
- Responsive sidebar layout using CSS container queries
- History table hides added/deleted columns at narrow widths
- Period summary cards stack vertically when sidebar is very narrow
- Bar chart day labels replaced with instant hover tooltips

## [1.1.0] - 2026-03-09

### Added
- Streak counter for consecutive days meeting goal
- Weekly and monthly summary totals in sidebar
- Manual compact button in settings
- Per-device increment files for Obsidian Sync compatibility
- Status bar total words display

### Changed
- Append-only increments with auto-compaction storage model
- Per-device compacted keys with frequent merge for reliable sync
- History table limited to 7 most recent days
- Left-justified history entries with bottom border styling
- History table styled to match native Obsidian properties look
- Clean up stale dailyRecords key and show year on old dates

### Fixed
- UTC date bug: use local time for all date strings
- Word counting: compare document totals instead of fragments
- Goal line position in history bar chart
- Debounced stats view refresh to avoid DOM rebuilds on every keystroke
- Performance: count words only in changed lines instead of full document

## [1.0.0] - 2025-01-01

### Added
- Initial release of Abacus word counting plugin
- Daily word count tracking with configurable goals
- History bar chart visualization
- Settings for goal configuration
