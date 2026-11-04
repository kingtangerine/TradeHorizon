# Changelog

All notable changes to the **TradeHorizon** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.28.0] - 2026-11-04

### Added
- **Indicators window, as in TradingView**: the Indicators button opens a window instead of a drop-down.
  - Sections: **Favorites**, **My scripts**, **Technicals**, **Trending** and **Market dominance**, with one search over all of them.
  - Star any row to keep it in Favorites. Rows show what is already on the chart. The window stays open while you add indicators.
- **My scripts**: write your own indicators in a small Pine-like language, in an editor with a reference panel.
  - Example: `plot(ema(close, input(12, "Length")))`.
  - What is available:
    - prices (open, high, low, close, volume, hl2, hlc3, ohlc4) and `close[1]` for earlier candles
    - sma, ema, rma, wma, vwma, rsi, atr, stdev, highest, lowest, change, roc, cum
    - crossover and crossunder; and, or, not; `cond ? a : b`
    - maths functions
    - `input()` for settings, `plot()` (up to 8 lines), `hline()` and `indicator("Name", overlay=true)` for scripts drawn on the candles
  - Mistakes are shown with their line before saving.
  - Scripts are saved with your account and sync to your other devices. Each script on a chart has its own input values, changed from its gear button in the legend.
  - Scripts run in TradeHorizon's own interpreter, never as page code, so a script cannot reach your account or the page.
- **Fibonacci retracement settings, as in TradingView** (double-click the drawing):
  - 24 levels (the usual 11 shown), each with on/off, value and colour, plus *Use one colour* and *TradingView defaults*.
  - Trend line on/off, extend lines left or right, and the background with its transparency.
  - Reverse, prices and levels labels, levels as values or percents, and labels on the left or right.

### Changed
- The Exponential Moving Average starts at length 12.
- New Fibonacci retracements use TradingView's level list. Existing ones keep their levels.
## [0.27.0] - 2026-11-04

### Added
- **More exchanges, as TradingView shows them**: symbol search lists a pair once per exchange: Binance, Bybit, OKX, Bitget and Gate, each with spot and USDT perpetuals.
  - The exchange is shown on every row. An **All sources** menu narrows the list to one exchange.
  - The coin list grew from about 770 coins to about 3,000 (7,700 pairs). For example, SWARMSUSDT is now there on Gate (spot and perpetual) as well as Binance (perpetual).
  - Charts, live prices, watchlist prices, compare and alerts work on every exchange; the server checks alerts there too.
  - Timeframes an exchange does not have are built from shorter candles (8h on OKX, weeks on Gate futures …).
- The toolbar, the watchlist and the alerts panel show which exchange a symbol is from when it is not Binance.

### Changed
- Bybit pairs that Binance also lists are now in the list too, as `BYBIT:…`. Bybit-only pairs keep their names, so existing charts, drawings and alerts are unaffected.
- The coin list is cached in a compact form, so the larger list fits in the browser's storage.
## [0.26.0] - 2026-11-03

Closer to TradingView, part 3.

### Added
- **Perpetual futures**: Binance USDT-M perpetuals are listed as `XXXUSDT.P` (as in TradingView), under **Futures** in symbol search.
  - They work for charts, watchlists, compare and alerts (the server checks them too).
  - The legend shows the funding rate with a countdown to the next funding, the mark price and open interest.
- **11 new drawing tools**: extended line, horizontal ray, parallel channel, arrow, brush, trend-based Fibonacci extension, pitchfork, ellipse, date range, date and price range, and price label.
  - The tool rail groups tools in fly-outs, as TradingView does: lines, Fibonacci and pitchfork, shapes, measuring, and text. Each group shows the last tool used from it, and the small arrow in its corner lists the rest.
  - Every tool has an Alt shortcut, shown in its fly-out.
- **Split-view sync**: in the split menu, choose what the charts of a tab share: symbol, timeframe, crosshair, or time. Time sync means scrolling or zooming one chart moves the others to the same moment and span, even on other timeframes.
- **Compare**: the **+** next to the symbol overlays up to 3 other symbols.
  - Each line starts at the first candle on screen, and the chart switches to the % scale, so every line reads as its own % change.
  - The legend shows each symbol's price and change, with a button to remove it.
- **Alert conditions**:
  - Crossing up or down, greater than, less than, entering a channel, exiting a channel, and moving up or down N% within 5 minutes to 24 hours.
  - **Alerts on trend lines**: right-click a trend line or ray, then *Add alert on this line*. The alert follows the line as it slopes.
  - **Every time** alerts fire on each new crossing, at most once a minute. Alerts can **expire** after a day, a week or a month, and can carry a **custom message** that appears in browser and Telegram notifications.
  - Channel alerts show both lines on the chart.

### Changed
- Notifications say what happened ("Crossing up 65000: price 65012.5", or your own message) instead of "Price reached …".
- The server and the app now use one set of alert rules (`server/alertRules.mjs`), so they always agree on when an alert fires.
## [0.25.0] - 2026-11-03

Closer to TradingView, part 2.

### Added
- **Indicator library**: search the Indicators menu and add any of these:
  - Relative Strength Index, MACD and Stochastic RSI, each in its own pane with guide levels and the values in the pane's legend.
  - Average True Range, also in its own pane.
  - Bollinger Bands, Ichimoku Cloud (with the cloud filled), Supertrend and Volume Profile (visible range), all drawn on the candles.
  - Up to 10 indicators at a time.
  - Each has eye, settings and remove buttons in the legend; its settings window changes inputs (lengths, factors) and line colours.
  - Indicators are saved with the chart and its layouts.
- **Chart types**: bars, candles, hollow candles, Heikin Ashi, line, area and baseline, from one menu in the toolbar.
- **Bar under the chart**, as in TradingView:
  - Date ranges (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, All). Each picks a fitting timeframe and fits that period on screen.
  - **Go to date**: jumps to a date and time, loading older candles first. If the date is further back than the timeframe can load, it says so.
  - **%** (percent) and **log** price scales, and **fullscreen**.
- **Chart settings window** (right-click → Settings):
  - Candle up and down colours (volume and Heikin Ashi follow them) and wicks.
  - Background colour, grid lines and the last-price line.
  - Price scale, countdown, high/low labels, alert lines and time zone.
- **Drawing editing**:
  - Double-click a drawing to open its settings window. **Style** covers colours, width, line style, fill and text. **Coordinates** lets you type exact prices and times. **Visibility** chooses which timeframes (minutes, hours, days, weeks, months) it shows on.
  - Fibonacci retracement levels can be edited: add, remove or reset to the defaults.
  - Right-click a drawing for its menu: Settings, Visibility, Clone, Lock, Hide, Remove.
  - **Multi-select** with Ctrl+click or Shift+click. The group moves together (one undo step), and can be cloned, locked, hidden or deleted together.
  - Tool rail: **Stay in drawing mode** (the tool stays selected after each drawing), **Lock all drawings** and **Hide all drawings**.

### Fixed
- After a timeframe change, or when jumping to a drawing from the object tree, the chart now centres that moment instead of putting it at the right edge.
## [0.24.0] - 2026-11-02

Closer to TradingView, part 1.

### Added
- **The legend follows the crosshair**: hovering a candle shows its open, high, low, close, change from the previous close, volume and the moving-average and VWAP values at that candle. Leaving the chart shows the live values again.
- **Time zone**: the time axis and the crosshair date use your computer's time zone. Pick another one from the status bar (bottom left) or the account window. Daily candles still open at 00:00 UTC, as on the exchange.
- **Typing on the chart**:
  - Typing a letter opens symbol search with that letter already typed.
  - Typing a number opens a *Change interval* box, applied with Enter (Esc closes it). For example: `15` is 15 minutes, `60` or `1h` is 1 hour, `240` is 4 hours, then `1d`, `1w`, and `1M` for 1 month.
- **Alt+R** resets the chart view (automatic price scale, default zoom, latest candles). **Alt+A** opens the alert form with the current price filled in.
- **Chart image**: a camera button at the right of the top toolbar.
  - *Download image* (Ctrl+Alt+S) saves a PNG; *Copy image* (Ctrl+Shift+S) copies it.
  - The image has a header with the symbol, timeframe, exchange, prices and time, and includes drawings but not the crosshair.
- **Layouts save themselves**: when a chart belongs to a saved layout, changes are saved to that layout about a second later. This covers symbol, timeframe, split view and indicators. The toolbar shows *Autosaved*, and just opening a layout does not count as a change.
- Account window: a *High and low price labels* option.

### Changed
- **Time axis labels look like TradingView's**: round times (00:00, 04:00 …), the day number at midnight, the month name when a month starts and the year when a year starts. Labels never crowd each other.
- **Volume is drawn at the bottom of the price pane**, like TradingView's default, instead of in its own pane with a moving average.
- **High and low price labels are off by default.**
- New drawings are blue (#2962FF), as in TradingView. Existing drawings keep their colour.
- The **ray** tool's shortcut is now **Alt+Y**, because Alt+R resets the chart as in TradingView.

### Fixed
- When the chart used a timeframe from the *More* list (such as 3m), no toolbar button showed it. The *More* button now shows it instead.

## [0.23.0] - 2026-11-01

### Added
- **Responsiveness monitor**: the server measures how long requests wait because it is busy (event-loop delay over the last minute). `/healthz` reports `eventLoopDelayMs` and `memoryMb`; the admin page shows it as *Responsiveness* (green under 50 ms, red over 200 ms).
- **Load test** (`scripts/loadtest.mjs`): simulates many users doing what the app does (download at start, a sync check every 15 s, saving layouts and drawings) against a test server on its own data folder; it creates test accounts directly in that test database and refuses to touch one that holds real accounts. Prints response times per kind of request and the server's busy-wait.
- Measured locally (Windows PC, load generator on the same machine): 1,000 users and 2,000 users with no errors; at 2,000 users (~150 requests a second) half of the requests took 2 ms, 99% under 65 ms, and the server was idle 87% of the time.

## [0.22.0] - 2026-11-01

### Added
- **Password reset by an admin**: in a user's details on the admin page, **Set temporary password** shows a new random password once (e.g. `k7Pq-Zm3x-Rt9d`) and signs that user out everywhere.
- **Server commands** for when no admin can sign in: `npm run user:list` lists every account (email, name, joined, last active, admin), `npm run user:password -- someone@example.com` sets and prints a temporary password. They use the same database and `.env` as the app and work while it runs (Plesk: Run Node.js commands, or SSH).
- After signing in with a temporary password the app shows a banner asking for a new password and opens the password form; the banner goes once the password is changed.
- The login screen explains what to do on a forgotten password.

### Changed
- Database schema 2: accounts record whether their password is temporary. Existing databases are upgraded automatically on start.

## [0.21.0] - 2026-11-01

### Added
- **Notification send queue** for Telegram and browser push. Messages go out at a pace the services accept (Telegram: 25 a second per bot and 1 a second per chat), a "too many requests" answer pauses the queue for as long as the service asks, network and server errors are retried with growing pauses (up to 5 attempts), and errors that cannot succeed later (a chat that blocked the bot, an expired browser subscription) are not retried and the chat or subscription is removed. In a test with 150 alerts for 60 users at the same moment against Telegram's limits, 30 were delivered before and all 150 now.
- The admin page shows notifications sent, waiting, retried and failed; `/healthz` reports `notificationQueues`.

### Changed
- "Send test" for Telegram now reports a failure if Telegram did not accept the message.

## [0.20.0] - 2026-11-01

### Changed
- **Price alerts are checked against live prices.** The server keeps one WebSocket connection to Binance and one to Bybit, subscribed only to the coins that have active alerts, and checks every price as it arrives (about once a second) instead of asking the exchanges every 10 seconds. Alerts fire within seconds, quick wicks are much less likely to be missed, and no request is made per coin, so Bybit rate limits are no longer a risk. Connections reconnect by themselves and a feed that goes silent for a minute is reopened.
- Coins without a live feed (Binance Futures such as BTCDOM) or whose live price has gone quiet for 20 seconds are still checked every 10 seconds, so a dropped connection delays alerts but never loses them.
- `/healthz` (`alerts`) and the admin page show how many coins are watched, how many have live prices and the state of each feed.

## [0.19.0] - 2026-11-01

### Added
- **Daily database backups**: a full copy of the database in `server/data/backups/` once a day, the newest 14 kept (`TH_BACKUP_KEEP`). The admin page shows the database (size, accounts, saved items, sessions) and the backups, with **Back up now**. `/healthz` reports the database and the last backup.
- README: how to update the live server, take backups off the server and restore one.

### Changed
- **Accounts, sessions and synced user data are stored in a SQLite database** (`server/data/tradehorizon.db`, Node's built-in SQLite, nothing to install) instead of JSON files. A save now writes one row instead of rewriting a whole file (and `users.json` on every login), sessions are looked up by index, crashes cannot leave half-written files, and the revision rules for sync are unchanged.
- **Existing data moves automatically**: the first start of this version imports `users.json` and `userdata/*.json` in one transaction, checks the counts, then renames the old files to `*.migrated-<date>` (kept, not deleted) and makes a first backup. Everyone stays signed in, and saved items keep their revisions so devices continue syncing where they left off. If the old files cannot be read the server stops with a clear message instead of starting empty.
- Requires Node.js 22.13 or newer (`engines` in package.json).

## [0.18.1] - 2026-10-18

### Added
- **Lock vertical move while dragging objects**: Holding `Shift` while dragging drawings now locks vertical movement, allowing objects to be moved purely horizontally across time without altering their price levels. Pressing or releasing `Shift` dynamically toggles the vertical lock in real time during the drag.

### Fixed
- **Bar replay persisted across timeframe switches**: Switching timeframe while bar replay is active or in picking mode no longer cancels the replay. The chart loads candles for the new timeframe up to the current replay timestamp, backfills historical candles as needed, preserves playback state (playing, paused, speed, or picking), and keeps replay active until manually exited.


## [0.18.0] - 2026-10-15

### Added
- **Rectangles without an outline.** The rectangle's line colour picker has a **No color** option at the top: the box is drawn with its fill only (the swatch shows a red slash). Picking any colour brings the outline back. A fill-only box is still selected and dragged by clicking its fill, and saved rectangle templates remember the choice.

## [0.17.1] - 2026-10-15

### Fixed
- **A drawing inside another (a small box in a big box) could not be selected or moved.** The chart library raises the drawing under the pointer to the top and keeps it there while the pointer stays inside it; a filled box counts as "under the pointer" across its whole area, so the big box caught every click meant for the small one. Drawings now keep a fixed stacking order instead: smaller areas above bigger ones (rectangles, positions, Fibonacci, price ranges), lines, rays and text above all areas, measured in time x price so zooming never changes it.

## [0.17.0] - 2026-10-15

### Added
- **Admin page** for the accounts listed in `TH_ADMIN_EMAILS` (in `.env`, comma-separated). Open it from the account window (Admin panel). Access is decided by the server: everyone else gets 403 and never sees the button.
  - **Overview**: users (registered, active today / this week, new sign-ups, signed-in sessions); server (version, Node, uptime, starts in the last 24 h, app and server memory, load); storage (TradeHorizon data size, free disk space, .env settings found); services (Telegram bot and connected users, browser-push devices, keep-alive, alerts being watched, market list). Warnings are colour-coded.
  - **Users**: every account with joined date, last active, devices, layouts, drawings, alerts, storage used and notification channels; search and sort (last active, newest, storage, name).
  - **User details**: joined, last login, last active, last sync, sessions, storage, Telegram and push, the devices that saved data, and every stored item with what it holds, its size, when and by which device it was saved. Sizes and counts only, never the content of layouts, drawings or alerts.
  - **Actions**: sign a user out everywhere; delete an account and all its data (type the email to confirm; admins cannot delete themselves here).
- The server now records each account's last login and last activity.

## [0.16.1] - 2026-10-15

### Added
- `/healthz` shows `startsLast24h` (how often the app was started in the last day) and `keepAlive` (the address it pings and whether the last ping worked).

### Changed
- The Notifications section of the alerts panel (browser notifications and Telegram) is open by default and says so in its title; it had been collapsed and looked missing.

### Fixed
- **Telegram alerts arriving only for a while after "Send test".** Plesk (Phusion Passenger) stops a Node app after about 5 minutes without web requests, and price alerts and the Telegram bot run inside it, so nothing was checked until the next request woke it (a test message, or a device that happened to see the price cross). The server now requests its own `/healthz` every 2 minutes through its public address (learned from the first visitor request, or `TH_PUBLIC_URL`), so the host never sees it as idle.

## [0.16.0] - 2026-10-15

### Added
- **Alert lines on the chart.** Every active alert of the chart's coin is drawn as an orange dashed line with its price, a tag on the price scale and a ✕ to delete it; paused alerts are grey. Drag a line to move the alert (it re-arms on the side of the price it now sits).
- **Show or hide alert lines** for all charts with the "On chart" switch in the alerts panel (saved with your settings).
- **Market cap in the chart legend**: a colour-coded tier with a 4-bar meter, the market cap and the CoinGecko rank, e.g. "Mega cap · MC $1.63T · #1". Tiers: Mega cap (over $50B, green), Large cap ($10B to $50B, blue), Mid cap ($1B to $10B, amber), Small cap (under $1B or outside the top 500, red). Hover for what the tier means and the 24h volume as a share of the market cap (a high share flags fast-moving coins). The server caches the top 500 coins from CoinGecko for 30 minutes (`/api/cg/caps`).

### Changed
- **Placing an alert no longer opens the alerts panel**: a short confirmation appears and the alert line shows where it is.
- **Alerts panel reorganised for many alerts**: a one-line create form, notifications (browser and Telegram) folded into one collapsible line with their status, Active / Triggered / All tabs with counts, search once there are more than 6 alerts, alerts grouped per coin (the chart's coin first, collapsible, with "Open chart" for the others), each row showing direction, price, status and the distance from the current price, and "Clear triggered".

## [0.15.0] - 2026-10-15

### Added
- **Right-click menu on the chart**: **Go live** (greyed out when already following the latest candles), **Add alert at <price>** at the exact price under the pointer (only on the price chart, not the volume pane), and **Settings…**, which opens the account window at the Chart section. Right-click on a drawing still selects it, right-click while a drawing tool is armed still cancels the tool, and Escape, a click elsewhere or scrolling closes the menu. In a split view the menu acts on the chart that was clicked.

## [0.14.4] - 2026-10-15

### Fixed
- **Telegram (and other devices) missed alerts that triggered while TradeHorizon was open.** The open chart usually sees the price cross before the server's 10-second check and marked the alert as triggered, so the server never sent a notification. The server now also notifies for alerts a device uploads as just triggered (within 30 minutes), and sends each trigger only once even when the server and a device both catch it. The app now records the trigger price too.

## [0.14.3] - 2026-10-15

### Added
- **Settings from a `.env` file.** The server reads `KEY=value` lines from `.env` in the app folder (next to package.json) at start-up, for hosts where environment variables do not reach the Node process (Plesk's Node.js panel). Real environment variables still win. `.env` is git-ignored, and `/healthz` lists the setting names it found (`envFile`), never the values.

## [0.14.2] - 2026-10-15

### Added
- `/healthz` explains the Telegram bot: `telegram.state` (off, starting, ready, error) and `telegram.problem` in plain words (token not set for the Node process, token malformed or rejected, Telegram unreachable from the server, two processes using the same bot). It also reports `pid`, which changes when the app was restarted or more than one copy runs.

## [0.14.1] - 2026-10-15

### Added
- **Sync check.** The account window has a "Sync between devices" section: the live sync state, a name for this device, and **Save & check sync**, which uploads everything waiting, downloads other devices' changes, and lists every saved item on this device next to the server's copy (what it contains, when it was saved and by which device, same or different, and which layouts exist on only one side). Problems are explained in plain words with the fix, e.g. a server that was updated but not restarted, a proxy refusing large uploads (HTTP 413) or an unreachable server. **Copy report** puts the whole check on the clipboard.
- A sync indicator in the status bar (Synced / Saving / Offline / Sync problem); click it for the details.
- The server records which device saved each item, and `GET /api/sync/status` describes what it holds; `/healthz` reports `syncProtocol`.

### Changed
- Sync no longer fails silently: download and upload problems (including talking to a server that runs an older TradeHorizon) are shown in the status bar instead of being ignored.

## [0.14.0] - 2026-10-15

### Added
- **Live sync between devices.** An open TradeHorizon picks up layouts, drawings, alerts, folders, watchlists, templates and settings saved on another device within about 15 seconds (and at once when you return to the tab), without reloading. Open chart tabs are taken over from the other device when the app starts, not while you work.

### Changed
- **Sync rebuilt so devices can no longer overwrite each other.** Every synced item has a revision on the server; an upload based on an older copy is refused, and the app merges the two copies item by item (layouts, drawings, alerts…) against the last version both devices shared. Additions on both devices are kept, a deletion on one device is applied on the other, and an item edited on both keeps both edits where they touch different fields. Edits made offline are uploaded and merged when the connection returns.
- Tabs still running the app from before this update can no longer upload: the server refuses them until they reload.

### Fixed
- **Layouts (and drawings) created on one device missing on another.** All layouts were stored as one list and the last upload replaced it whole, so a device with an older list (a tab left open, or one starting up) wiped out the other device's new layouts. On the first start after this update each device merges its copy with the server's, so layouts that still exist on any device come back.

## [0.13.0] - 2026-10-15

### Added
- **Telegram alerts.** Triggered price alerts can be sent to a Telegram chat (phone or desktop), with TradeHorizon closed. In the Alerts panel press Connect Telegram, press Start in the chat, and the account is linked; Send test and Disconnect are there too. The server runs one bot (token from @BotFather in `TH_TELEGRAM_TOKEN`) and reads its messages by long polling, so no webhook or extra HTTPS setup is needed. The section only appears when the server has a token. `/healthz` reports `telegramReady`.

### Changed
- Triggered alerts now go to every channel the user has set up (web push and Telegram); one failing channel does not block the other.

## [0.12.0] - 2026-10-15

### Added
- **Candle countdown.** The time left until the current candle closes is shown under the last price on the price axis (e.g. 14:08, or 2d 03:05:09 on daily and longer charts), like TradingView. It runs on the browser's clock, so it costs the server nothing. It can be switched off in the account window, under Chart; the choice is saved with the account.

### Changed
- **Long and short positions behave like TradingView's.** A newly placed position is selected at once, with its handles and axis price tags showing, instead of needing a second click. The labels sit centred on the box so they stay readable on narrow positions.

### Fixed
- **Resizing a position needs one drag, not two.** Target and stop share the right edge, so dragging either one sideways now moves both and resizes the box.

## [0.11.0] - 2026-10-12

### Added
- **Free vertical pan.** Dragging the chart now moves it up and down as well as sideways, so after switching to a lower timeframe you can pan to any price area. An "Auto" button appears once you have moved the price view; it (or a timeframe change) fits the candles again.
- **Drag to reorder tabs.** Press and drag an open tab to a new position (mouse or touch). Alt+Shift+Left/Right moves the focused tab.
- **DCA on positions.** Select a long or short position and press DCA in its toolbar to add a draggable second-buy line inside the buy region (between entry and stop). Tick Triggered once the order has filled to show the average entry; the quantity, risk, reward and R/R then use it. The DCA order size (a multiple of the entry order) is in the position settings.
- **VWAP and QVWAP indicators.** VWAP restarts every day, week, month, quarter or year (UTC, chosen in the Indicators menu); QVWAP is the quarterly VWAP. Both appear in the chart legend.
- **Folders for saved layouts.** The layouts page has a folder bar: create folders, move a layout into one from its menu, filter by folder or "No folder", rename or delete a folder (its layouts are kept). Folders sync with the account like other per-user data.
- **Version tracking.** The version, build hash and build time are shown next to the logo (full details in the account window). `npm run version:bump -- patch|minor|major` updates package.json, the lockfile and adds a changelog entry.
- `/healthz` reports `pushReady` so a deployment can be checked for background-alert support.

### Changed
- Turning on background alerts now explains why it failed (old server code, missing /api proxy, no HTTPS) instead of a generic "could not provide notification key".

### Fixed
- **Sync no longer lets a stale device overwrite newer data.** A device that reopened the app marked its own unchanged data as an unsynced edit and pushed it over what another computer had saved. Unchanged writes are now ignored, and a newer server copy beats a stale local one (the replaced copy is kept as a backup in browser storage).
- Vertical dragging no longer locks while the price axis is on auto-fit.

## [0.10.0] - 2026-10-10

### Added
- **Combine saved layouts into a split view.** On the layouts page, press Combine, tick 2 to 4 layouts (numbers show the order the charts will appear in), and press Open split view. Each layout contributes the chart it was saved with. A bar at the bottom lists the picks, names the result (a name is suggested), and has Keep for later, on by default.
- **Saved splits.** Keeping a split saves it as a normal layout card with a ▦ chart-count badge; clicking it opens the split again (or switches to it if it is already open). The toolbar's layout menu also has Save split to keep the split you are looking at.
- A short confirmation message appears when a split is opened or saved.

## [0.9.0] - 2026-10-10

### Added
- **Split view.** The new layout button in the toolbar shows 2, 3 or 4 charts in one tab. Each chart has its own symbol and timeframe (new ones start on the same symbol with longer timeframes). Click a chart to make it active: the toolbar, drawing tools, object tree, alerts and watchlist act on it, and it is outlined. Drawings are shared by symbol, the tab shows a ▦ badge, and the split is saved with the workspace and with saved layouts. On phones the charts stack.
- **Instant reopen.** The newest candles of every chart you view are kept in the browser, so reopening a chart (or the whole app) paints immediately and catches up in the background. On a reload this cut the time to a visible chart from about 1.7 s to 0.2 s.

### Fixed
- **Price-axis zoom jumped.** klinecharts scales the price axis by the ratio of absolute screen positions, so the same drag zoomed wildly near the top of the screen and barely at the bottom, and a drag toward the top collapsed the range (worst on phones). Dragging the price axis now zooms by drag distance (equal drags, equal zoom), with a bounded range, mouse-wheel zoom over the axis, and a double-click or double-tap to return to the automatic fit.
- **"Loading" and "Connecting" every time you came back to the app.** Connections that died in the background are now replaced immediately when you return (and on reconnecting to the network), brief drops are no longer shown, returning users open their workspace from the local copy instead of waiting on a loading screen (the server copy is checked in the background and the page reloads once only if another device saved newer data).
- Clicking a saved layout that is already open switches to it instead of opening it again. Middle-click on an open layout does nothing; "Open in new tab" in its menu still makes a copy.

## [0.8.0] - 2026-10-09

### Added
- **Mobile layout.** On phones the chart uses the full screen width; drawing tools and the watchlist / object tree / alerts buttons move to a swipeable bottom dock; panels open as bottom sheets; menus open as full-width sheets; buttons are touch-sized; safe areas (notches, home bar) and iOS input zoom are handled; drawing handles are larger on touch screens. The app can be installed to the home screen (web app manifest and icons).
- **Alerts that work with the app closed.** The server watches prices for every user's alerts and sends a web-push notification when one triggers. Turn it on per device in the alerts panel. Alerts the server triggered show up in the open app within 15 seconds. Index alerts (BTC.D etc.) still need the app open.
- **Server-side market data cache.** `/api/markets` serves one merged Binance + Bybit coin list (a few KB instead of a 145 KB download that took seconds), and `/api/cg/*` serves cached CoinGecko caps so the free-tier limit is no longer per visitor. The app falls back to the exchanges directly if the server cannot answer.
- **Production hardening:** gzip/Brotli compression (the 636 KB script is now 169 KB on the wire), long-lived caching for hashed assets, ETags, security headers (strict Content-Security-Policy listing only the data hosts the app uses, nosniff, frame protection, HSTS over HTTPS), `/healthz`, a browser error report endpoint, and `TH_TRUST_PROXY` support so login limits work behind a reverse proxy.
- **Developer tooling:** ESLint (`npm run lint`, `npm run check`), `.editorconfig`, `.gitattributes` (LF everywhere), and a GitHub Actions workflow that lints, type-checks, tests, builds and starts the server on every push and pull request.

### Fixed
- A long watchlist now scrolls inside its panel instead of running off it.
- The Indicators menu was hidden on small screens.

## [0.7.1] - 2026-10-09

### Added
- **Middle-click a saved layout** to open it in new tabs without switching to them. The layout card's menu also has "Open in new tab".

## [0.7.0] - 2026-10-09

### Added
- **Watchlist** (star button on the right rail). Named lists of symbols with live last price and 24h change, click a symbol to open it on the chart, add with +, remove, color flags, sort by symbol, price or change, and multiple lists you can create, rename and delete. Works for Binance, Bybit, futures and the dominance/market-cap indices. Saved and synced with your account.
- **Rectangle templates.** Save a rectangle's fill color, fill amount, line color, width, style and middle line under a name, apply it to any rectangle, and optionally make one the default look for new rectangles.
- **New charts for analysis:** OTHERS (market cap excluding the top 10), TOTAL, TOTAL2 (excluding Bitcoin), TOTAL3 (excluding Bitcoin and Ethereum), ETH.D, STABLE.D (all stablecoins), and Binance's BTCDOMUSDT.P Bitcoin-dominance index perpetual. Also the 38 Binance BTC-quoted pairs such as ETH/BTC.

### Fixed
- **Dominance candles had no wicks.** Dominance and market-cap candles now carry highs and lows, estimated from each coin's own high and low during the bar.

### Changed
- Dominance engine now computes all indices in one pass (ETH share, stablecoins, caps in billions of USD). Cached caps refresh once (`dominance-weights:v2`).
- Alerts and the watchlist share the right-hand overlay; opening one closes the other.

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
- **Developer documentation**:
  - Created `README.md` containing architectural standards and drawing overlay lifecycles.

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
