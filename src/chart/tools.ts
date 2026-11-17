import type { DrawingStyle, DrawingType } from '../drawings'
import {
  FIB_RETRACEMENT_OVERLAY_NAME,
  HORIZONTAL_LINE_OVERLAY_NAME,
  LONG_POSITION_OVERLAY_NAME,
  PRICE_RANGE_OVERLAY_NAME,
  RECTANGLE_OVERLAY_NAME,
  SHORT_POSITION_OVERLAY_NAME,
  TEXT_OVERLAY_NAME,
  VERTICAL_LINE_OVERLAY_NAME,
  ARROW_OVERLAY_NAME,
  BRUSH_OVERLAY_NAME,
  DATE_PRICE_RANGE_OVERLAY_NAME,
  DATE_RANGE_OVERLAY_NAME,
  ELLIPSE_OVERLAY_NAME,
  FIB_EXTENSION_OVERLAY_NAME,
  HORIZONTAL_RAY_OVERLAY_NAME,
  PARALLEL_CHANNEL_OVERLAY_NAME,
  PITCHFORK_OVERLAY_NAME,
  PRICE_LABEL_OVERLAY_NAME,
} from './overlayNames'
import { TV_FIB_ROWS } from './drawingVisibility'

/**
 * How a tool is placed: one click, two points (click-click or drag), three points (click three times, or drag the
 * first two and click the third), a freehand stroke (press and draw), or a position box.
 */
export type ToolPlacement = 'onePoint' | 'twoPoint' | 'threePoint' | 'freehand' | 'position'

export interface DrawingToolSpec {
  readonly label: string
  readonly overlayName: string
  readonly placement: ToolPlacement
  readonly hint: string
  /** Letter used with Alt as a keyboard shortcut. */
  readonly shortcut: string
  readonly defaultStyle: DrawingStyle
}

// TradingView's default drawing colour; drawings store their colour, so existing ones keep theirs.
const LINE_STYLE: DrawingStyle = { color: '#2962ff', lineWidth: 2, lineStyle: 'solid' }
const POSITION_STYLE: DrawingStyle = {
  targetColor: '#16a085',
  stopColor: '#f0445e',
  textColor: '#ffffff',
  lineColor: '#c7d0db',
  lineWidth: 1,
  fillOpacity: 22,
  accountSize: 10000,
  riskPercent: 1,
}

export const DRAWING_TOOLS: Readonly<Record<DrawingType, DrawingToolSpec>> = {
  trendLine: {
    label: 'Trend line',
    overlayName: 'segment',
    placement: 'twoPoint',
    hint: 'Click two points or drag. Hold Shift to keep it level or vertical.',
    shortcut: 'T',
    defaultStyle: LINE_STYLE,
  },
  ray: {
    label: 'Ray',
    overlayName: 'rayLine',
    placement: 'twoPoint',
    hint: 'Click two points or drag. The line extends past the second point.',
    // Alt+R is TradingView's "reset chart view", so the ray takes Alt+Y.
    shortcut: 'Y',
    defaultStyle: LINE_STYLE,
  },
  horizontalLine: {
    label: 'Horizontal line',
    overlayName: HORIZONTAL_LINE_OVERLAY_NAME,
    placement: 'onePoint',
    hint: 'Click a price level.',
    shortcut: 'H',
    defaultStyle: LINE_STYLE,
  },
  verticalLine: {
    label: 'Vertical line',
    overlayName: VERTICAL_LINE_OVERLAY_NAME,
    placement: 'onePoint',
    hint: 'Click a point in time.',
    shortcut: 'V',
    defaultStyle: LINE_STYLE,
  },
  rectangle: {
    label: 'Rectangle',
    overlayName: RECTANGLE_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag a box, or click two opposite corners.',
    shortcut: 'B',
    defaultStyle: { color: '#3aa9ff', fillColor: '#3aa9ff', fillOpacity: 14, lineWidth: 2, lineStyle: 'solid' },
  },
  priceRange: {
    label: 'Price range',
    overlayName: PRICE_RANGE_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag from start to end, or click both points, to measure.',
    shortcut: 'M',
    defaultStyle: { color: '#3aa9ff', upColor: '#10b981', downColor: '#ef4444', fillOpacity: 18, lineWidth: 1.5, lineStyle: 'solid' },
  },
  fibRetracement: {
    label: 'Fib retracement',
    overlayName: FIB_RETRACEMENT_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag from the swing start to the swing end, or click both.',
    shortcut: 'F',
    // New retracements get TradingView's level list (older ones keep theirs: see fibSettings).
    defaultStyle: { color: '#787b86', lineWidth: 1, lineStyle: 'solid', fillOpacity: 8, fibRows: TV_FIB_ROWS.map((row) => ({ ...row })) },
  },
  longPosition: {
    label: 'Long position',
    overlayName: LONG_POSITION_OVERLAY_NAME,
    placement: 'position',
    hint: 'Click the entry price, or drag from entry to your target.',
    shortcut: 'L',
    defaultStyle: POSITION_STYLE,
  },
  shortPosition: {
    label: 'Short position',
    overlayName: SHORT_POSITION_OVERLAY_NAME,
    placement: 'position',
    hint: 'Click the entry price, or drag from entry to your target.',
    shortcut: 'S',
    defaultStyle: POSITION_STYLE,
  },
  text: {
    label: 'Text',
    overlayName: TEXT_OVERLAY_NAME,
    placement: 'onePoint',
    hint: 'Click anywhere on the chart to place text, then type it in the toolbar.',
    shortcut: 'X',
    defaultStyle: { text: 'Text', color: '#2962ff', fontSize: 14, bold: false },
  },
  extendedLine: {
    label: 'Extended line',
    overlayName: 'straightLine',
    placement: 'twoPoint',
    hint: 'Click two points or drag. The line runs across the whole chart.',
    shortcut: 'Z',
    defaultStyle: LINE_STYLE,
  },
  horizontalRay: {
    label: 'Horizontal ray',
    overlayName: HORIZONTAL_RAY_OVERLAY_NAME,
    placement: 'onePoint',
    hint: 'Click a price: the line starts there and runs to the right.',
    shortcut: 'J',
    defaultStyle: LINE_STYLE,
  },
  parallelChannel: {
    label: 'Parallel channel',
    overlayName: PARALLEL_CHANNEL_OVERLAY_NAME,
    placement: 'threePoint',
    hint: 'Click the start and end of the first line, then click to set the channel width.',
    shortcut: 'C',
    defaultStyle: { ...LINE_STYLE, fillColor: '#2962ff', fillOpacity: 12 },
  },
  arrow: {
    label: 'Arrow',
    overlayName: ARROW_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Click where the arrow starts and where it points, or drag.',
    shortcut: 'W',
    defaultStyle: LINE_STYLE,
  },
  brush: {
    label: 'Brush',
    overlayName: BRUSH_OVERLAY_NAME,
    placement: 'freehand',
    hint: 'Press and draw. Release to finish the stroke.',
    shortcut: 'U',
    defaultStyle: { color: '#ff9800', lineWidth: 2, lineStyle: 'solid' },
  },
  fibExtension: {
    label: 'Trend-based fib extension',
    overlayName: FIB_EXTENSION_OVERLAY_NAME,
    placement: 'threePoint',
    hint: 'Click the swing start, the swing end, then the retracement point to project from.',
    shortcut: 'G',
    defaultStyle: { color: '#787b86', lineWidth: 1, lineStyle: 'solid' },
  },
  pitchfork: {
    label: 'Pitchfork',
    overlayName: PITCHFORK_OVERLAY_NAME,
    placement: 'threePoint',
    hint: 'Click the pivot, then the high and the low of the swing.',
    shortcut: 'P',
    defaultStyle: { ...LINE_STYLE, fillColor: '#2962ff', fillOpacity: 10 },
  },
  ellipse: {
    label: 'Ellipse',
    overlayName: ELLIPSE_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag the box the ellipse fits in, or click two opposite corners.',
    shortcut: 'O',
    defaultStyle: { color: '#9c27b0', fillColor: '#9c27b0', fillOpacity: 14, lineWidth: 2, lineStyle: 'solid' },
  },
  dateRange: {
    label: 'Date range',
    overlayName: DATE_RANGE_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag from one moment to another, or click both, to count bars and time.',
    shortcut: 'K',
    defaultStyle: { color: '#2962ff', fillColor: '#2962ff', fillOpacity: 14, lineWidth: 1, lineStyle: 'solid' },
  },
  datePriceRange: {
    label: 'Date and price range',
    overlayName: DATE_PRICE_RANGE_OVERLAY_NAME,
    placement: 'twoPoint',
    hint: 'Drag from start to end, or click both: price change, percent, bars and time.',
    shortcut: 'Q',
    defaultStyle: { color: '#2962ff', lineWidth: 1, lineStyle: 'solid' },
  },
  priceLabel: {
    label: 'Price label',
    overlayName: PRICE_LABEL_OVERLAY_NAME,
    placement: 'onePoint',
    hint: 'Click a candle to pin its price (or your own note) to it.',
    shortcut: 'N',
    defaultStyle: { color: '#2962ff', text: 'Text' },
  },
}

/** The tool rail's groups (TradingView's fly-out menus); each shows the last tool used from it. */
export const TOOL_GROUPS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly tools: readonly DrawingType[] }> = [
  {
    id: 'lines',
    label: 'Lines',
    tools: ['trendLine', 'ray', 'extendedLine', 'horizontalLine', 'horizontalRay', 'verticalLine', 'parallelChannel', 'arrow'],
  },
  { id: 'fib', label: 'Fibonacci and pitchfork', tools: ['fibRetracement', 'fibExtension', 'pitchfork'] },
  { id: 'shapes', label: 'Shapes', tools: ['rectangle', 'ellipse', 'brush'] },
  {
    id: 'measure',
    label: 'Forecasting and measuring',
    tools: ['longPosition', 'shortPosition', 'priceRange', 'dateRange', 'datePriceRange'],
  },
  { id: 'text', label: 'Text and notes', tools: ['text', 'priceLabel'] },
]

/** Tools in the order they appear in the left rail. */
export const TOOL_ORDER: readonly DrawingType[] = [
  'trendLine',
  'ray',
  'horizontalLine',
  'verticalLine',
  'rectangle',
  'fibRetracement',
  'priceRange',
  'longPosition',
  'shortPosition',
  'text',
  'extendedLine',
  'horizontalRay',
  'parallelChannel',
  'arrow',
  'brush',
  'fibExtension',
  'pitchfork',
  'ellipse',
  'dateRange',
  'datePriceRange',
  'priceLabel',
]

export function anchorCountFor(type: DrawingType): number {
  if (type === 'rectangle') return 8
  const placement = DRAWING_TOOLS[type].placement
  return placement === 'onePoint' ? 1 : placement === 'position' || placement === 'threePoint' ? 3 : 2
}
