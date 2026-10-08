# TradeHorizon — AI Agent & Developer Guidelines

This document provides context, architectural principles, code conventions, and workflows for developers and AI agents (e.g. GPT, Claude, Gemini) working on the **TradeHorizon** codebase.

---

## 1. Project Overview & Tech Stack

**TradeHorizon** is a high-performance web-based technical analysis and charting platform for cryptocurrency trading.

- **Frontend Core**: React 19 (`react`, `react-dom`) + TypeScript
- **Bundler & Dev Server**: Vite 7
- **Charting Engine**: `klinecharts` v10 (Canvas-based financial charting engine)
- **Styling**: Modern Vanilla CSS with dark theme variables (`src/styles.css`)
- **State Management**: React 19 `useSyncExternalStore` + Command Pattern `DrawingStore`
- **Testing**: Vitest (`npm test`)
- **Data Source**: Binance Spot REST API + WebSockets

---

## 2. Directory Structure

```
TradeHorizon/
├── index.html                   # HTML entry point
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript compiler config
├── vite.config.ts               # Vite configuration
├── CHANGELOG.md                 # Version history & change logs
├── AGENTS.md                    # Instructions for AI assistants
├── README.md                    # User-facing overview & quickstart
├── server/index.mjs             # Auth server (accounts + sessions, JSON file store)
└── src/
    ├── app/                     # React application UI layer
    │   ├── App.tsx              # Main application root & UI layout
    │   ├── Icons.tsx            # SVG icon components
    │   ├── alerts.ts            # Price alert models and evaluation
    │   ├── auth.ts              # Auth client (talks to server/index.mjs)
    │   ├── ColorPicker.tsx      # Preset-palette color popover
    │   └── workspace.ts         # Multi-tab workspace persistence
    ├── chart/                   # Charting engine & controller
    │   ├── CryptoChartSurface.tsx # React wrapper for klinecharts
    │   ├── KLineChartController.ts # Bridge between chart engine & React/Store
    │   ├── intervals.ts         # Timeframe intervals and mappings
    │   ├── markets.ts           # Cryptocurrency market definitions
    │   ├── model.ts             # Chart adapter data conversions
    │   ├── geometry.ts          # Pure drawing maths (market space)
    │   ├── tools.ts             # Drawing tool table (labels, placement, defaults)
    │   ├── indicators.ts        # Indicator settings (SMA, EMA, dominance)
    │   ├── dominance.ts         # Dominance data loading for charts and panes
    │   ├── overlayNames.ts      # Overlay name constants (no klinecharts import)
    │   ├── overlays.ts          # Custom klinecharts overlay registrations
    │   ├── position.ts          # Risk-reward metric calculations
    │   └── types.ts             # Chart runtime state types
    ├── drawings/                # Pure domain drawing model & store
    │   ├── model.ts             # Domain drawing entity types & validators
    │   ├── persistence.ts       # LocalStorage repository adapter
    │   └── store.ts             # DrawingStore with undo/redo commands
    └── market/                  # Market data ingestion (Binance)
        ├── binance/             # REST & WebSocket client implementation
        ├── intervals.ts         # Market interval definitions
        └── types.ts             # Candle and quote data contracts
```

---

## 3. Core Architectural Rules

### A. Strict Separation of Concerns
1. **Market Coordinate Space vs. Screen Space**:
   - The drawing domain model (`src/drawings/model.ts`) stores coordinates **only** as market coordinates:
     - `timeMs: number` (Timestamp in milliseconds)
     - `price: DecimalPrice` (Canonical string representation of price)
   - Screen coordinates (`x, y`), candle indexes (`dataIndex`), or DOM dimensions must **never** be saved into `DrawingStore` or `localStorage`.
2. **Drawing Lifecycle**:
   - **Creation is owned by `KLineChartController`, not by klinecharts' step-by-step drawing mode.** `startTool(type)` arms a tool; capture-phase pointer listeners on the chart host then place a *draft* overlay (already complete, with all its points) and update it as the pointer moves. Two-point tools accept click-click or press-drag-release; one-point tools place on a single click; position tools place a default 2:1 box on click or follow a drag. Releasing commits the draft through `drawingFromOverlay()` to `DrawingStore`.
   - **Editing**: handle drags use each overlay's `performEventPressedMove`. Body drags are intercepted (`onPressedMoveStart` / `onPressedMoving`) and applied as a pure time/price offset with `translatePoints()`. Do not let klinecharts translate overlays itself: it re-snaps every anchor to the current timeframe's bars, which distorts or collapses shapes drawn on a finer timeframe.
   - Commits that do not change anchors are skipped so a plain click never creates an undo step. `onRightClick` must call `preventDefault()` or klinecharts deletes the overlay.
   - `DrawingStore` notifies listeners, triggering `#syncDrawings()` to sync overlays across tabs/charts.

### B. Adding or Modifying Drawing Tools
When adding a new drawing tool (or modifying an existing one), follow these steps:
1. **Domain Model** ([`src/drawings/model.ts`](./src/drawings/model.ts)):
   - Add tool name to `DRAWING_TYPES` array.
   - Update `isValidAnchorCount(type, count)` to enforce the expected number of anchors.
2. **Overlay** ([`src/chart/overlayNames.ts`](./src/chart/overlayNames.ts), [`src/chart/overlays.ts`](./src/chart/overlays.ts)):
   - Add the overlay name constant to `overlayNames.ts` (kept free of klinecharts imports so pure code and tests can use it), or reuse a klinecharts built-in such as `segment` or `rayLine`.
   - Register custom overlays with `registerOverlay({ name, totalStep, createPointFigures, performEventPressedMove, ... })`.
3. **Tool Table** ([`src/chart/tools.ts`](./src/chart/tools.ts)):
   - Add an entry to `DRAWING_TOOLS` (label, overlay name, placement kind, hint, Alt-shortcut letter, default style) and to `TOOL_ORDER`. The controller, adapter, tool rail, hints, toolbar and object tree all read this table, so no per-tool branches are needed there.
   - A new placement kind (beyond `onePoint`, `twoPoint`, `position`) needs handling in `#draftPoints` in the controller.
4. **Geometry** ([`src/chart/geometry.ts`](./src/chart/geometry.ts)):
   - Put any new point maths here as pure functions (market space only) and unit-test them.
5. **Icon** ([`src/app/Icons.tsx`](./src/app/Icons.tsx), [`src/app/App.tsx`](./src/app/App.tsx)):
   - Add an SVG icon and map it in `TOOL_ICONS` in `App.tsx`.
6. **Tests** ([`src/chart/geometry.test.ts`](./src/chart/geometry.test.ts), [`src/drawings/model.test.ts`](./src/drawings/model.test.ts)):
   - The tool-table test fails until every drawing type has a table entry with a unique shortcut.

### C. Market Dominance (BTC.D, USDT.D, ALT.D)
- Free APIs do not serve historical global market cap and CoinGecko's public tier allows only a few requests per minute (its 429 responses carry no CORS header, so browsers report them as network errors).
- `src/market/dominance.ts` therefore takes **today's** market caps from CoinGecko (two cached requests) and rebuilds history from **Binance prices**, holding supply constant. Values are exact now and are estimates further back. Keep the request count per timeframe change at zero CoinGecko calls.
- The same engine feeds the dominance chart symbols (`kind: 'dominance'` markets) and the dominance indicator panes.

---

## 4. Development & Validation Workflow

Always validate your changes before declaring a task complete:

```bash
# 1. Run all unit tests
npm test

# 2. Verify TypeScript type-checking and production build
npm run build

# 3. Start local development server
npm run dev
```

---

## 5. Changelog & Version Tracking Protocol

Whenever you make significant architectural updates, add features, or fix bugs:
1. **Update `CHANGELOG.md`**:
   - Record additions under `### Added`
   - Record modifications under `### Changed`
   - Record fixes under `### Fixed`
   - Increment semantic versioning when appropriate (e.g. `0.2.0` -> `0.2.1` for patches, `0.3.0` for new features).
2. **Update `package.json`** version field if cutting a new release.
3. **Commit cleanly**:
   - Use descriptive conventional commit messages (e.g. `feat: add price range measurement tool`).
