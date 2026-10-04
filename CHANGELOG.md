# Changelog

All notable changes to the **TradeHorizon** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
