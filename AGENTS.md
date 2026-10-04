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
└── src/
    ├── app/                     # React application UI layer
    │   ├── App.tsx              # Main application root & UI layout
    │   ├── Icons.tsx            # SVG icon components
    │   ├── alerts.ts            # Price alert models and evaluation
    │   ├── auth.ts              # Local auth & session state
    │   └── workspace.ts         # Multi-tab workspace persistence
    ├── chart/                   # Charting engine & controller
    │   ├── CryptoChartSurface.tsx # React wrapper for klinecharts
    │   ├── KLineChartController.ts # Bridge between chart engine & React/Store
    │   ├── intervals.ts         # Timeframe intervals and mappings
    │   ├── markets.ts           # Cryptocurrency market definitions
    │   ├── model.ts             # Chart adapter data conversions
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
   - `KLineChartController` registers and creates overlays in `klinecharts`.
   - When a drawing is finished (`onDrawEnd`) or modified (`onPressedMoveEnd`), `KLineChartController` converts the overlay to a domain `Drawing` via `drawingFromOverlay()` and commits it to `DrawingStore`.
   - `DrawingStore` notifies listeners, triggering `#syncDrawings()` to sync overlays across tabs/charts.

### B. Adding or Modifying Drawing Tools
When adding a new drawing tool (or modifying an existing one), follow these steps:
1. **Domain Model** ([`src/drawings/model.ts`](./src/drawings/model.ts)):
   - Add tool name to `DRAWING_TYPES` array.
   - Update `isValidAnchorCount(type, count)` to enforce the expected number of anchors.
   - If backward compatibility / anchor expansion is needed, update `expand...Anchors()`.
2. **Chart Overlay Registration** ([`src/chart/overlays.ts`](./src/chart/overlays.ts)):
   - Define and export the overlay constant name (e.g. `MY_TOOL_OVERLAY_NAME`).
   - Register the overlay using `registerOverlay({ name, totalStep, createPointFigures, performEventPressedMove, ... })`.
   - Ensure `createPointFigures` returns clean figure descriptors (`rect`, `line`, `text`, etc.).
3. **Chart Model Adapter** ([`src/chart/model.ts`](./src/chart/model.ts)):
   - Update `drawingFromOverlay()` to parse anchors for the new type.
   - Specify default styles (colors, stroke width, opacity, line style).
4. **Chart Controller** ([`src/chart/KLineChartController.ts`](./src/chart/KLineChartController.ts)):
   - Add public activation method (e.g. `public startMyTool(): boolean { return this.#startDrawing('myTool') }`).
   - Update `#startDrawing`, `#overlayConfiguration`, `#drawingOverlayConfiguration`, and `#syncDrawings` filter.
5. **UI & Icons** ([`src/app/Icons.tsx`](./src/app/Icons.tsx), [`src/app/App.tsx`](./src/app/App.tsx)):
   - Add SVG icon in `Icons.tsx`.
   - Update `activeTool` state type in `App.tsx`.
   - Add sidebar tool button, drawing hint overlay, floating property toolbar controls, and Object Tree label.
6. **Tests** ([`src/drawings/model.test.ts`](./src/drawings/model.test.ts), [`src/chart/overlays.test.ts`](./src/chart/overlays.test.ts)):
   - Write unit tests for anchor validation and overlay conversion.

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
