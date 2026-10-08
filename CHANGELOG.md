# Changelog

All notable changes to the **TradeHorizon** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.6.0] - 2026-10-08

### Added
- **More coins.** Symbol search was missing coins Binance does not list (ZETA, KAS, MNT, POPCAT and about 150 others). Those USDT pairs now come from Bybit spot, with history, live updates, and 8h/3d candles built from Bybit's 4h/1d. The catalog still uses Binance first; if Bybit is unreachable, search keeps working with Binance alone.
- **Account window.** The profile button opens a window with account details, change password (other devices are signed out), a Dark/Light theme switch, and Export/Import of your data.
- **Light theme.** The whole interface and the chart follow the choice, and it is saved with your account.
- **Export / import data.** One JSON file holds tabs, saved layouts, drawings, groups, alerts and theme. Importing asks for confirmation first and restores into the signed-in account.
- **Text tool** (Alt+X): click to place text, type it in the toolbar, with color, size and bold.
- **Rectangle middle line:** a toolbar toggle draws a horizontal line through the middle of a rectangle.
- **Object tree folders:** select objects, then create a named group or move them into an existing one. Groups can be renamed, collapsed, hidden or shown together, and deleted without deleting the objects. Saved and synced with your account.

### Changed
- The object tree and alerts panels are closed by default.
- All interface colors are theme variables in `styles.css` (dark and light values side by side).

## [0.5.1] - 2026-10-08

### Fixed
- **Layouts, drawings, alerts and workspace now sync across computers.** Only the account was on the server, so a second computer showed empty layouts. The app now mirrors each user's saved data to the server (`/api/data`, one file per user in `server/data/userdata/`) and loads it before the workspace opens. Last write wins per item; local changes that never reached the server are kept and uploaded. If the server has a different copy than a browser that never synced, the server copy is used and the browser's old copy is kept under a `trade-horizon:backup:` key. Data saved locally before this update is uploaded the first time that user logs in there.

## [0.5.0] - 2026-10-08

### Added
- **Accounts on a server.** Sign up and log in now go through a small auth server (`server/index.mjs`, no extra dependencies), so an account created on one computer works on any other. Passwords are salted scrypt hashes and sessions are random tokens; accounts live in `server/data/users.json` (git-ignored). Run it with `npm run dev` (server + Vite) or `npm run build && npm start` (serves the app and API on one port).
- Accounts that only existed in a browser's old local storage are moved to the server automatically the first time their owner logs in on that browser, keeping their charts and drawings.
- **Alert "+" button.** Hovering the chart shows a + beside the price axis at the crosshair level; clicking it creates a price alert at that price (above or below depending on the last price) and opens the alerts panel.
- **Color palette.** Every drawing color control now opens a TradingView-style palette of preset greys and hues, with a Custom option for any other color.

### Changed
- Long/Short position labels (Target, Entry, Stop, P&L, quantity) show only while the position is being placed or is selected. Clicking elsewhere on the chart or pressing Esc leaves just the clean lines.

### Fixed
- Esc and clicking empty chart space now actually deselect a drawing; klinecharts only deselected when another drawing was clicked.

---

## [0.4.0] - 2026-10-07

### Added
- **Drag to draw**: every two-point tool (trend line, ray, rectangle, price range, Fib) can be drawn by press-drag-release as well as click-click. Hold Shift to keep a trend line or ray level or vertical. Esc or right-click cancels.
- **New tools**: Ray, Vertical line, Fibonacci retracement (levels 0 to 1.618 with prices), and Short position. Long and Short positions now place a default 2:1 box on a single click, or follow a drag from entry.
- **Magnet toggle** in the tool rail (off by default) that snaps points to a candle's open, high, low or close. Remembered per workspace.
- **Clone** a drawing from its toolbar or with Ctrl+D; **Hide/Show all** drawings from the Object tree; Alt+letter shortcuts for every tool.
- **Bar replay**: the Replay button rewinds the chart to a candle you click, then plays it forward with play/pause, forward one bar, four speeds (1x to 10x), "Jump to…" a different start, and Exit back to live. Shift+→ steps and Shift+↓ plays or pauses. Drawing tools and indicators keep working; live updates and price alerts are paused while replaying.
- **Candles / Line switch** in the toolbar, remembered per workspace.
- **Dominance as chart symbols**: BTC.D, USDT.D and ALT.D appear in symbol search under a new Indices category and open as candlestick charts at every timeframe, with history paging and 20-second updates.

### Changed
- **Dominance engine rewritten.** Today's market caps come from CoinGecko (two cached requests) and history is rebuilt from Binance prices, so dominance is available instantly at any timeframe instead of depending on CoinGecko's rate-limited history endpoints. The indicator panes use the same engine and now match the chart's candles one for one.
- Zoom-out range widened from 2px to 0.4px per candle (about 540 to about 2,600 candles on a typical screen); older candles load automatically as you zoom out.
- Switching timeframe while looking at history now loads enough older candles (up to 10,000) to keep that moment on screen, and falls back to the live edge only if it is out of reach. Drawings are hidden while the new timeframe loads instead of collapsing into one spot.
- Drawing tools are described once in a tool table that drives the rail, hints, toolbar, object tree and chart adapter.

### Fixed
- **Moving a drawing on a different timeframe no longer distorts it.** Every anchor used to be re-snapped to the current timeframe's bars, so a box drawn on 15m and nudged on 4h changed width, and shapes narrower than one bar collapsed to a line for good. Moves are now a pure time/price offset.
- Right-clicking a drawing deleted it without warning; it now selects it.
- A plain click on a drawing recorded an undo step and bumped its revision.
- A fast second click when placing a shape was swallowed by the chart's double-click window.
- The always-on weak magnet forced any point placed inside a candle's range onto its open, high, low or close.
- Rectangle handles could drift out of order after flipping a corner; the eight handles are now always rebuilt from the box.
- Line width, line style and fill opacity changes had no effect on Price range drawings.

### Tested
- 97 unit tests, plus scripted Chrome sessions against live Binance and CoinGecko data covering drawing, editing, timeframe switching, zoom, the new tools, and the dominance charts.

## [0.3.1] - 2026-10-07

### Added
- **Symbol search dialog** opened from the toolbar symbol button: search by ticker or name, category pills, keyboard navigation (Up/Down/Enter/Esc), TradingView-style rows. Exchange names intentionally omitted for now.

- **Supercharts "New tab" page** replacing the launcher modal and "My layouts" dialog: card grid of saved layouts with Create new layout, star/favorite, inline rename, make a copy, delete (with confirm), search, and sort (recently modified / created / name). A "New chart" button still adds a chart tab to the current layout. Favorites persist on saved layouts.

- **Full Binance market list**: symbol search now covers every trading USDT spot pair (about 500) loaded from Binance `exchangeInfo`, with price/volume precision derived from the exchange filters, cached for 12 hours. Results rank exact ticker, then prefix, then substring matches.

- **Moving average indicators** on the price chart: Simple Moving Average and Exponential Moving Average, each with up to 5 user-chosen lengths (1-500), colored per length, with show/hide in the Indicators menu and chart legend. Settings persist per workspace and per saved layout.
- **Market dominance indicators** (BTC.D, USDT.D, ALT.D) imported from CoinGecko into their own panes aligned to the chart. History is estimated from the largest coins' market caps scaled to today's exact global total (CoinGecko's global history is paid), ALT.D is 100 minus BTC.D and USDT.D, and results are cached (30 min hourly, 6 h daily). Requests are paced and retried because CoinGecko's rate limiter returns CORS-less 429s.

### Changed
- Opening a saved layout from the Superchart page now adds it as new chart tab(s) instead of replacing the current workspace. Each chart tab remembers its layout, and the layout control, Save, and Save as follow the active tab.
- Collapsed the three stacked header rows into TradingView's two: a slim chart-tab strip and a single top toolbar (symbol button, timeframes, Indicators, Alert, Go live, connection status, layout control).
- Removed the duplicate quote/OHLC header; the in-chart legend now shows a TradingView-style title line (`Bitcoin · 15 · Binance`) above the OHLC row.
- Re-skinned chrome and chart with TradingView's dark palette (`#131722` surfaces, `#2962ff` active accents, `#089981` / `#f23645` candles).

## [0.3.0] - 2026-10-04

### Added
- **TradingView-inspired workspace chrome** with a top chart-tab strip, compact market controls, upper-right user profile panel, and responsive desktop/tablet behavior.
- **Native Volume indicator pane** powered by Binance base-asset volume from both REST history and live WebSocket candles, with show/hide controls in the Indicators menu and chart legend.
- **Expanded timeframe picker** covering every Binance-supported interval plus persistent user-selected custom shortcuts.
- **Saved layouts** with editable names, Save, Save As, restore, list, and delete workflows stored per user on the device.
- Workspace persistence tests covering legacy migration, chart preferences, custom intervals, and saved-layout validation.

### Changed
- Reordered the main workspace shell so active chart tabs sit above market, timeframe, indicator, and live-feed controls.
- Moved the user profile entry from the bottom status bar to the upper-right application chrome.
- Extended workspace persistence with backward-compatible defaults for layout name, Volume visibility, and custom timeframe shortcuts.

## [0.2.0] - 2026-10-04

### Added
- **8-Point Rectangle Control Geometry**:
  - Upgraded rectangle drawing overlay from 2 diagonal corners to 8 full-perimeter handles (4 corners + 4 edge centers: Top-Left, Top-Center, Top-Right, Right-Center, Bottom-Right, Bottom-Center, Bottom-Left, Left-Center).
  - Added dedicated vertical edge height adjustment (`Top-Center`, `Bottom-Center`) preserving horizontal time boundaries.
  - Added dedicated horizontal edge span adjustment (`Left-Center`, `Right-Center`) preserving vertical price boundaries.
  - Added multi-directional corner resizing (`Top-Left`, `Top-Right`, `Bottom-Left`, `Bottom-Right`).
  - Implemented automatic backward-compatibility expansion in `expandRectangleAnchors` for existing 2-point or 6-point stored drawings.
- **Horizontal Line Tool**:
  - One-click instant placement of infinite horizontal price levels across the entire chart.
  - Real-time drag-and-drop vertical adjustment with Y-axis price snapping.
  - Added custom `HorizontalLineIcon` and integration into sidebar tools, floating toolbar, and object tree.
- **Price Range Measurement Tool**:
  - Two-point measurement overlay calculating absolute price change and percentage move in real time.
  - Dynamic visual badge with directional coloring (emerald for gains, rose for losses), shaded range fill, and dashed center measurement guide.
  - Added custom `PriceRangeIcon` and integration into sidebar tools, floating toolbar, and object tree.
- **Developer & AI Agent Instructions**:
  - Created `AGENTS.md` and `README.md` containing architectural standards, drawing overlay lifecycles, and guidelines for future AI sessions.

### Changed
- Updated `DrawingType` definition to include `"priceRange"` alongside `"trendLine"`, `"horizontalLine"`, `"rectangle"`, `"longPosition"`, and `"shortPosition"`.
- Updated `drawingFromOverlay` to extract canonical anchor sets for all tool types.
- Updated `DrawingStore` and `KLineChartController` to synchronize and persist all tool types.

### Tested
- Expanded Vitest test suite to 47 passing tests covering 8-point rectangle conversions, anchor validation, horizontal lines, price range calculations, and overlay mappings.

---

## [0.1.0] - 2026-10-04

### Added
- Initial release of **TradeHorizon** cryptocurrency technical analysis platform.
- **Real-Time Market Data Feed**:
  - Integrated Binance REST historical k-lines API and WebSocket real-time ticker stream with automatic reconnect and backfill.
  - Support for multi-timeframe candle intervals (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`).
- **Klinecharts v10 Chart Engine**:
  - Interactive candlestick charting, multi-pane technical indicators, viewport navigation, and zoom controls.
- **Core Drawing System**:
  - Trend line overlay (`segment`) and initial 2-point Rectangle overlay.
  - Long Position risk/reward sizing tool with automated position sizing and P&L projections.
  - `DrawingStore` external store with immutable command execution, undo/redo history, and `localStorage` persistence.
- **Workspace & Multi-Tab Management**:
  - Tabbed chart sessions with persisted workspace state.
  - Client-side Price Alerts engine with ticker threshold monitoring.
  - Authentication and user session simulation with local storage.
