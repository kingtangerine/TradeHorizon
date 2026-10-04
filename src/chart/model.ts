import type { KLineData, Overlay } from 'klinecharts'
import {
  DRAWING_SCHEMA_VERSION,
  expandRectangleAnchors,
  type Anchor,
  type Drawing,
  type DrawingType,
} from '../drawings'
import type { Candle } from '../market'
import type { MarketId } from '../market'

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

function decimalString(value: number): string {
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

export function overlayAnchors(overlay: Overlay, count = 2): readonly Anchor[] | null {
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
  marketId: MarketId,
  existing?: Drawing,
  type: DrawingType = existing?.type ?? 'trendLine',
): Drawing | null {
  let anchors: readonly Anchor[] | null = null

  if (type === 'rectangle') {
    if (overlay.points.length >= 8) {
      anchors = overlayAnchors(overlay, 8)
    } else if (overlay.points.length >= 2) {
      const parsed = overlayAnchors(overlay, overlay.points.length >= 6 ? 6 : 2)
      if (parsed) {
        anchors = expandRectangleAnchors(parsed)
      }
    }
  } else if (type === 'longPosition' || type === 'shortPosition') {
    anchors = overlayAnchors(overlay, 3)
  } else if (type === 'horizontalLine') {
    anchors = overlayAnchors(overlay, 1)
  } else {
    anchors = overlayAnchors(overlay, 2)
  }

  if (!anchors) return null

  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    id: overlay.id,
    marketId,
    type,
    anchors,
    style: existing?.style ?? (
      type === 'rectangle'
        ? { color: '#3aa9ff', fillColor: '#3aa9ff', fillOpacity: 14, lineWidth: 2, lineStyle: 'solid' }
        : type === 'priceRange'
          ? { color: '#3aa9ff', upColor: '#10b981', downColor: '#ef4444', fillOpacity: 18, lineWidth: 1.5, lineStyle: 'solid' }
          : type === 'horizontalLine'
            ? { color: '#f4b860', lineWidth: 2, lineStyle: 'solid' }
            : type === 'longPosition'
              ? {
                  targetColor: '#16a085',
                  stopColor: '#f0445e',
                  textColor: '#ffffff',
                  lineColor: '#c7d0db',
                  lineWidth: 1,
                  fillOpacity: 22,
                  accountSize: 10000,
                  riskPercent: 1,
                }
              : { color: '#f4b860', lineWidth: 2, lineStyle: 'solid' }
    ),
    revision: existing?.revision ?? 0,
  }
}

export function drawingPoints(drawing: Drawing): Array<{ timestamp: number; value: number }> {
  return drawing.anchors.map((anchor) => ({
    timestamp: anchor.timeMs,
    value: Number(anchor.price),
  }))
}
