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

# Run unit tests
npm test

# Build production bundle
npm run build
```

---

## Documentation & AI Guidelines

- [`CHANGELOG.md`](./CHANGELOG.md): Version history, stable releases, and change log.
- [`AGENTS.md`](./AGENTS.md): Architecture breakdown, drawing system conventions, and pair-programming instructions for AI models.
