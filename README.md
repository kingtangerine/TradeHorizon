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
- Node.js (v18+)
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

`npm start` serves the built app and the API from one Node process. Settings come from environment variables, or from a `.env` file in the app folder (one `KEY=value` per line, git-ignored; environment variables win). On Plesk use the `.env` file: its Node.js panel does not always pass variables to the app.

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Where to listen (default `0.0.0.0:8787`). |
| `TH_DATA_DIR` | Where accounts, user data, push keys and the market cache live (default `server/data`). **Back this folder up.** |
| `TH_TRUST_PROXY=1` | Set when running behind nginx/Cloudflare so login limits use the real visitor IP and HTTPS is detected. |
| `TH_TELEGRAM_TOKEN` | Bot token from @BotFather. Turns on Telegram alerts (see below). Leave unset to keep the feature off. |
| `TH_PUBLIC_URL` | The site's address (e.g. `https://example.com`) for the keep-alive ping that stops hosts like Plesk from shutting the idle app down. Optional: otherwise learned from the first visit after a start. |
| `TH_VAPID_SUBJECT` | Contact URL or `mailto:` sent to browser push services (optional). |

- **HTTPS is required** for the service worker, installing the app, and background alert notifications (browsers only allow them on HTTPS; `localhost` is exempt). Terminate TLS in nginx/Cloudflare and forward `X-Forwarded-For` and `X-Forwarded-Proto`.
- `GET /healthz` returns `{"ok":true,...}` for uptime monitors.
- The server caches Binance/Bybit coin lists and CoinGecko market caps for all users, and watches prices for **price alerts**, sending a web-push notification when one triggers (indices such as BTC.D are only evaluated while the app is open).
- `server/data/` holds `users.json`, `userdata/`, `vapid.json` (push keys; losing it silently disconnects every device's notifications), `push.json` and `catalog.json`.

### Telegram alerts

1. In Telegram open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`, and copy the token it gives you.
2. Set it on the server: `TH_TELEGRAM_TOKEN=<token>` (systemd `Environment=`, pm2 `--env`/ecosystem file, or your host's settings), then restart the Node process. Use the token on **one** server only; two servers polling the same bot fight each other.
3. Check `/healthz`: it should show `"telegramReady": true`. The server must be able to reach `api.telegram.org` (outbound HTTPS).
4. In TradeHorizon open **Alerts**; a **Telegram alerts** section appears. Press **Connect Telegram**, press **Start** in the chat that opens, and the panel shows Connected. **Send test** confirms delivery.
5. Create alerts as usual. When one triggers the server sends the message even if no browser is open. `/stop` in the chat or **Disconnect** in the app unlinks it.

Links are stored in `server/data/telegram.json` (back it up with the rest of the data folder).

---

## Documentation & AI Guidelines

- [`CHANGELOG.md`](./CHANGELOG.md): Version history, stable releases, and change log.
- [`AGENTS.md`](./AGENTS.md): Architecture breakdown, drawing system conventions, and pair-programming instructions for AI models.
