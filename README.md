# TradeHorizon

**TradeHorizon** is a modern, web-based technical analysis and charting platform for cryptocurrency traders, built with **React 19**, **TypeScript**, and the **Klinecharts v10** financial charting engine.

---

## Features

- **Live Market Feeds**: Real-time ticker and historical candlestick feeds directly from Binance Spot via REST API & WebSockets.
- **Interactive Charting**: Multi-pane technical indicator overlays, smooth zoom, pan, and real-time candle updates.
- **Drawing Tools**:
  - **Trend Line**: Multi-angle directional trend channels.
  - **Horizontal Line**: Infinite single-click horizontal support/resistance levels.
  - **8-Point Rectangle**: Full perimeter control with 4 corner handles and 4 edge midpoint handles for precise order block & zone adjustment.
  - **Price Range Measurement**: Measure price change ($ and %) with auto-adjusting directional color indicators.
  - **Long Position Calculator**: Automatic risk/reward ratio, position sizing, and stop-loss/take-profit calculation.
- **Object Tree & Layers**: Layer manager to focus, lock, hide, or delete annotations.
- **Candle countdown** under the last price (switch it off in the account window).
- **Indicators**: SMA, EMA, VWAP (day/week/month/quarter/year), QVWAP and market dominance panes.
- **Multi-Tab Workspaces**: Open multiple crypto pairs across various timeframes with saved layout state.
- **Client-Side Price Alerts**: Trigger visual alerts when live prices cross predefined thresholds.
- **Undo / Redo & Local Storage**: Full state tracking and persistence for drawings.

---

## Quick Start

### Prerequisites
- Node.js 22.18 or newer (it runs the TypeScript server and scripts directly in development)
- npm

### Installation & Run
```bash
# Install dependencies
npm install

# Start the auth server + Vite dev server together (accounts need the server)
npm run dev

# Or separately: `npm run server` (port 8787) and `npm run dev:client`

# Production: build, then serve app + API from one port (PORT, HOST, TH_DATA_DIR are configurable)
npm run build && npm start

# Lint, type-check and run the tests (what CI runs on every push)
npm run check

# Build production bundle
npm run build
```

### Running in production

`npm run build` also compiles the TypeScript server to plain JavaScript in `build/`, and `npm start` (`node build/server/index.js`) serves the built app and the API from one Node process. On Plesk, set the Node.js **Application Startup File** to `build/server/index.js`. Settings come from environment variables, or from a `.env` file in the app folder (one `KEY=value` per line, git-ignored; environment variables win). On Plesk use the `.env` file: its Node.js panel does not always pass variables to the app.

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Where to listen (default `0.0.0.0:8787`). |
| `TH_DATA_DIR` | Where accounts, user data, push keys and the market cache live (default `server/data`). **Back this folder up.** |
| `TH_TRUST_PROXY=1` | Set when running behind nginx/Cloudflare so login limits use the real visitor IP and HTTPS is detected. |
| `TH_ALLOWED_ORIGINS` | Other origins whose pages may call the API (CORS), comma-separated. Default: the Android app's own origin (`https://localhost,capacitor://localhost`); set it empty to allow none. The API uses Bearer tokens, never cookies, so this gives those pages no ambient login. |
| `TH_TELEGRAM_TOKEN` | Bot token from @BotFather. Turns on Telegram alerts (see below). Leave unset to keep the feature off. |
| `TH_ADMIN_EMAILS` | Comma-separated emails of the accounts that may open the admin page (users, storage, server health). |
| `TH_BACKUP_KEEP` | How many daily database backups to keep (default 14). |
| `TH_PUBLIC_URL` | The site's address (e.g. `https://example.com`) for the keep-alive ping that stops hosts like Plesk from shutting the idle app down. Optional: otherwise learned from the first visit after a start. |
| `TH_VAPID_SUBJECT` | Contact URL or `mailto:` sent to browser push services (optional). |

- **HTTPS is required** for the service worker, installing the app, and background alert notifications (browsers only allow them on HTTPS; `localhost` is exempt). Terminate TLS in nginx/Cloudflare and forward `X-Forwarded-For` and `X-Forwarded-Proto`.
- `GET /healthz` returns `{"ok":true,...}` for uptime monitors.
- The server caches Binance/Bybit coin lists and CoinGecko market caps for all users, and watches prices for **price alerts**, sending a web-push notification when one triggers (indices such as BTC.D are only evaluated while the app is open).
- `server/data/` holds `tradehorizon.db` (SQLite: accounts, sessions and every user's synced data), `backups/` (daily copies of the database), `vapid.json` (push keys; losing it silently disconnects every device's notifications), `push.json`, `telegram.json` and `catalog.json`. Node.js 22.18 or newer is required (built-in SQLite, TypeScript scripts).

### Updating the live server

1. On your computer: commit and `git push`.
2. On the server (Plesk: *Git* to pull, or SSH into the app folder): `git pull`, then **NPM install** (`npm ci`) and the build (`npm run build`).
3. First time after the move to TypeScript only: set the Application Startup File to `build/server/index.js` (it was `server/index.mjs`).
4. **Restart App** (Plesk Node.js page), open the site once, then check `/healthz`: `version` is the new one and `database` shows your accounts.

`server/data/` and `.env` are not in git, so pulling never touches them.

### Load testing

Simulate many users against a **test** copy of the server (never the live data folder):

```bash
TH_DATA_DIR=/tmp/th-load PORT=8899 node server/index.ts        # test server, its own empty data folder
node scripts/loadtest.ts --data-dir /tmp/th-load --base http://127.0.0.1:8899 --users 1000 --minutes 3
```

Each simulated user downloads its data once, checks for changes every 15 s, saves a 5 KB layouts item about every 45 s and a 60 KB drawings item about every 3 minutes. The report lists response times per kind of request (typical, 95%, 99%, worst) and errors. On the live server watch *Responsiveness* on the admin page (or `eventLoopDelayMs` in `/healthz`): a few ms is healthy, hundreds of ms mean it is not keeping up. Running the test on the live machine takes CPU from real users: do it at a quiet time.

### Accounts and forgotten passwords

Passwords are stored only as hashes, so nobody can look one up; a forgotten password is replaced with a temporary one, and the user chooses a new one after signing in.

- **Admin page** → Users → the user → **Set temporary password**.
- **On the server** (when no admin can sign in), in the app folder (Plesk: *Run Node.js commands*, or SSH):
  - `npm run user:list`: every account with its email, so you can see which one is the admin.
  - `npm run user:password -- someone@example.com`: prints a new temporary password for that account.
- Admins are the emails in `TH_ADMIN_EMAILS` (`.env`); restart the app after changing it.

### Backups and restoring

- **Automatic**: the server copies the whole database to `server/data/backups/tradehorizon-YYYYMMDD-HHMMSS.db` once a day and keeps the newest 14 (`TH_BACKUP_KEEP`). The admin page shows the last backup and has **Back up now** (do this before every update).
- **Off the server**: download the newest file from `server/data/backups/` now and then (Plesk File Manager), or include `server/data` in Plesk *Backup Manager*. A backup on the same disk does not survive the disk.
- **Restore**: stop the app (Plesk: *Disable Node.js*), copy a backup over `server/data/tradehorizon.db`, delete `tradehorizon.db-wal` and `tradehorizon.db-shm` if present, then enable / restart the app.
- **From the JSON era**: the first start of v0.19.0 moved `users.json` and `userdata/` into the database and kept them as `*.migrated-<date>`. To go back to an older app version, stop the app, rename them back (drop the `.migrated-…` part) and deploy the older version; changes made since the move are then missing.

### Telegram alerts

1. In Telegram open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`, and copy the token it gives you.
2. Set it on the server: `TH_TELEGRAM_TOKEN=<token>` (systemd `Environment=`, pm2 `--env`/ecosystem file, or your host's settings), then restart the Node process. Use the token on **one** server only; two servers polling the same bot fight each other.
3. Check `/healthz`: it should show `"telegramReady": true`. The server must be able to reach `api.telegram.org` (outbound HTTPS).
4. In TradeHorizon open **Alerts**; a **Telegram alerts** section appears. Press **Connect Telegram**, press **Start** in the chat that opens, and the panel shows Connected. **Send test** confirms delivery.
5. Create alerts as usual. When one triggers the server sends the message even if no browser is open. `/stop` in the chat or **Disconnect** in the app unlinks it.

Links are stored in `server/data/telegram.json` (back it up with the rest of the data folder).

---

## Documentation

- [`CHANGELOG.md`](./CHANGELOG.md): Version history, stable releases, and change log.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): Setup, branch, commit and pull request rules.
- [`.env.example`](./.env.example): Every server setting with placeholder values.
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and [`ASSETS.md`](./ASSETS.md): Dependencies and assets, with their licences.
- [`LICENSE`](./LICENSE): Proprietary licence.
