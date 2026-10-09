import type { KLineData, Overlay } from 'klinecharts'
import {
  DRAWING_SCHEMA_VERSION,
  expandRectangleAnchors,
  type Anchor,
  type Drawing,
  type DrawingType,
} from '../drawings'
import type { Candle } from '../market'
import { DRAWING_TOOLS, anchorCountFor } from './tools'

export const DRAWING_GROUP_ID = 'trade-horizon:drawings'

export function candleToKLineData(candle: Candle): KLineData {
  return {
    timestamp: candle.openTimeMs,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
    turnover: Number(candle.quoteVolume),
  }
}

export function decimalString(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const direct = String(value)
  if (!/[eE]/.test(direct)) return direct

  return value
    .toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: 20,
    })
    .replace(/\.0+$/, '')
}

export function overlayAnchors(overlay: Pick<Overlay, 'points'>, count = 2): readonly Anchor[] | null {
  if (overlay.points.length < count) return null

  const anchors: Anchor[] = []
  for (const point of overlay.points.slice(0, count)) {
    if (
      !Number.isSafeInteger(point.timestamp) ||
      point.timestamp === undefined ||
      point.timestamp < 0 ||
      point.value === undefined ||
      !Number.isFinite(point.value)
    ) {
      return null
    }

    anchors.push({
      timeMs: point.timestamp,
      price: decimalString(point.value),
    })
  }

  return anchors
}

export function drawingFromOverlay(
  overlay: Overlay,
  marketId: string,
  existing?: Drawing,
  type: DrawingType = existing?.type ?? 'trendLine',
): Drawing | null {
  let anchors: readonly Anchor[] | null

  if (type === 'rectangle') {
    // Any two or more corners define the box; the eight handles are always rebuilt from it.
    const parsed = overlay.points.length >= 2 ? overlayAnchors(overlay, Math.min(overlay.points.length, 8)) : null
    anchors = parsed ? expandRectangleAnchors(parsed) : null
  } else {
    anchors = overlayAnchors(overlay, anchorCountFor(type))
  }

  if (!anchors) return null

  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    id: overlay.id,
    marketId,
    type,
    anchors,
    style: existing?.style ?? DRAWING_TOOLS[type].defaultStyle,
    revision: existing?.revision ?? 0,
  }
}

export function drawingPoints(drawing: Drawing): Array<{ timestamp: number; value: number }> {
  return drawing.anchors.map((anchor) => ({
    timestamp: anchor.timeMs,
    value: Number(anchor.price),
  }))
}
