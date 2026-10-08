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
} from './overlayNames'

/** How a tool is placed: one click, two points (click-click or drag), or a position box. */
export type ToolPlacement = 'onePoint' | 'twoPoint' | 'position'

export interface DrawingToolSpec {
  readonly label: string
  readonly overlayName: string
  readonly placement: ToolPlacement
  readonly hint: string
  /** Letter used with Alt as a keyboard shortcut. */
  readonly shortcut: string
  readonly defaultStyle: DrawingStyle
}

const LINE_STYLE: DrawingStyle = { color: '#f4b860', lineWidth: 2, lineStyle: 'solid' }
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
    shortcut: 'R',
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
    defaultStyle: { color: '#787b86', lineWidth: 1, lineStyle: 'solid', fillOpacity: 8 },
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
}

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
]

export function anchorCountFor(type: DrawingType): number {
  if (type === 'rectangle') return 8
  const placement = DRAWING_TOOLS[type].placement
  return placement === 'onePoint' ? 1 : placement === 'position' ? 3 : 2
}
