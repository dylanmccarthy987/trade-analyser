# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A vanilla-JS browser SPA (PWA, no build step) for analysing futures trading fills. Opens a CSV export from a broker, reconstructs completed trades, and provides dashboards with KPIs, analytics, charts, and a detailed trade log. All data lives in **IndexedDB** and **localStorage** — no backend.

Open `index.html` directly in Chrome/Edge (`file://` works). Refresh after JS/CSS changes.

## Module Pattern

Every module is an IIFE exposing a public API:

```js
const ModuleName = (() => {
  let _private = {};
  function _helper() {}
  return { publicMethod() {} };
})();
```

Script load order in `index.html` matters — dependencies must be loaded before their consumers. `app.js` is last (it calls everything else). New modules go in `js/`, with a `<script>` tag before `app.js`.

## Data Flow

```
CSV file
  → Parser.parse()           completedTrades[], openTrades[]
  → Tags.applyToTrades()     enrich with strategy/substrategy/notes
  → App.state.trades         single source of truth
  → App.getMergedTrades()    substitute spread/attempt synthetics for raw legs
  → Tab.render()             Overview | Analytics | TradeLog | TopOpp | Settings
```

`App.renderActiveTab()` is the single re-render entry point — call it after any state change.

## Key Globals

| Module | Role |
|---|---|
| `App` | State, tab routing, date filtering, CSV load, IDB helpers |
| `Parser` | Fills CSV → trade objects |
| `Config` / `config.js` | Contract specs (multiplier, currency, asset class) for 400+ products; `stripContractMonth()` |
| `Tags` | Multi-layer tag persistence; `Tags.applyToTrades()`, `Tags.exportAll()` |
| `Spreads` / `Attempts` | Group trades into synthetics; `buildSpreadTrade()`, `buildAttemptTrade()` |
| `Metrics` | All KPI maths; `groupBy(trades, field)` returns `{ key, pnl, winRate, wins, losses, avgWin, avgLoss, profitFactor }[]` |
| `Charts` | Chart.js wrappers |
| `RMode` | EUR ↔ R-multiple toggle; `toR(pnlEUR, openDate)`, `sumR(trades)`, `fmtR(val)` |
| `FX` | EUR conversion; `toEUR(amount, currency)` |
| `fmtEUR(val)` | Global helper in `metrics.js` — always whole numbers, `+€1,234` / `-€567` |

## Storage Layout

**IndexedDB** `trade-analyser` v3 — three object stores, all using the `store` store unless noted:
- `ta_csv_text` / `ta_csv_name` — last loaded CSV (auto-loads on startup)
- `ta_backup_handle` — `FileSystemDirectoryHandle` for script backup folder
- `tags` store, key `__tags__` — full tag cache `{ [tradeId]: { strategy, substrategy, notes, topOpp, _ts } }`

**localStorage** keys:
- `ta_spreads` / `ta_attempts` — groupings `{ [id]: { tradeIds[], createdAt } }`
- `ta_product_config` / `ta_asset_classes` — user overrides to contract specs
- `ta_tags_0..2` + `ta_tags_slot` — 3-slot round-robin tag backup (fault tolerance)
- `ta_r_log` / `ta_r_mode` — R-mode downside log and EUR/R toggle
- `ta_fx_rates` — cached FX rates (4-hour TTL)
- `ta_backup_name` / `ta_backup_written` — script backup UI state

**Tags persistence:** every `Tags.set()` writes to IDB async + next localStorage slot sync. On init, merges IDB + all 3 LS slots using `_ts` timestamp; newest wins per tradeId.

## Trade Object Shape

```js
{
  tradeId,           // "${product}__${openTime.valueOf()}" — includes contract month
  baseProduct,       // month stripped: "ICE Brent" not "ICE Brent AUG26"
  product,           // full name with contract month
  direction,         // 'long' | 'short' | 'spread'
  totalContracts,    // lot size
  avgEntry, avgExit, // weighted average prices
  openTime,          // dayjs object
  closeTime,         // dayjs object (null if isOpen)
  pnlEUR,            // converted P&L (null if open)
  pnlNative,         // P&L in contract currency
  currency, assetClass, spec,
  isOpen,            // true = excluded from most analytics
  // Tags (merged by Tags.applyToTrades):
  strategy, substrategy, notes,
  topOpp,            // '' | 'week' | 'month'
  // Synthetics only:
  isSpread, spreadId, spreadTradeIds,
  isAttempt, attemptId,
}
```

P&L formula: `(exit − entry) × contracts × multiplier` for longs; negated for shorts.

## Spreads & Attempts

Both are synthetic trade objects built from underlying legs and substituted in `App.getMergedTrades()`. **All-or-nothing**: if any leg ID is missing from the loaded CSV, the entire group is skipped and legs appear individually.

- **Spread** — any 2+ trades merged (typically calendar spread or inter-product spread); direction = `'spread'`
- **Attempt** — 2+ trades, same `baseProduct` + same `direction` (multiple entries on one idea)

Underlying leg IDs are stored in `ta_spreads` / `ta_attempts`. Legs are excluded from display only when all legs resolve.

## CSS Conventions

Dark GitHub-palette theme. Key variables: `--bg`, `--card`, `--border`, `--text`, `--muted`, `--accent` (blue), `--green`, `--red`, `--font-mono`. No framework — all hand-written flex/grid. Tab panels toggled via `.active` class. Sidebar fixed at `--sidebar-w: 180px`.

Notable classes: `.kpi-card`, `.analytics-card`, `.stats-table`, `.tag-btn`, `.btn-apply`, `.btn-secondary`, `.spread-badge`, `.attempt-badge`.

## IDB Version

Always open at version **3** with the full idempotent upgrade handler (create all three stores if not present). Any file that opens IDB must do this — `tags.js` and `settings.js` have their own `_openDB()` / `_openIDB()` copies that mirror `app.js`'s `openIDB()`.

## Script Backup

Settings tab has a "Script Backup" section. User picks a folder (stored as `FileSystemDirectoryHandle` in IDB). "Write backup now" writes `trade-analyser-backup.json` (fixed, for the PS script) and `trade-analyser-backup_YYYY-MM-DD_HH-mm-ss.json` (dated rolling copy, 30 kept) into that folder. `send-backup.ps1` (gitignored — contains Gmail app password) emails the fixed file + CSV fills.

## Git / GitHub

Remote: `https://github.com/dylanmccarthy987/trade-analyser.git` (public).  
Gitignored: `trade-analyser-backup.json`, `trade-analyser-settings.json`, `trade-analyser-tags.json`, `Tag Backups/`, `send-backup.ps1`.  
Commit and push after every session where source files change.
