import { describe, expect, it } from 'vitest'
import { DRAWING_TYPES } from '../drawings'
import {
  clampPositionLevels,
  fibLevelPrice,
  lockToAxis,
  magnetPrice,
  positionPoints,
  rectanglePoints,
  translatePoints,
} from './geometry'
import { drawingFromOverlay } from './model'
import { DRAWING_TOOLS, TOOL_ORDER, anchorCountFor } from './tools'

const HOUR = 3_600_000

describe('rectanglePoints', () => {
  it('builds eight handles clockwise from the top-left whichever corners are given', () => {
    const expected = [
      { timestamp: 1000, value: 200 },
      { timestamp: 1500, value: 200 },
      { timestamp: 2000, value: 200 },
      { timestamp: 2000, value: 150 },
      { timestamp: 2000, value: 100 },
      { timestamp: 1500, value: 100 },
      { timestamp: 1000, value: 100 },
      { timestamp: 1000, value: 150 },
    ]
    expect(rectanglePoints({ timestamp: 1000, value: 200 }, { timestamp: 2000, value: 100 })).toEqual(expected)
    expect(rectanglePoints({ timestamp: 2000, value: 100 }, { timestamp: 1000, value: 200 })).toEqual(expected)
  })
})

describe('translatePoints', () => {
  it('keeps the exact shape, including widths narrower than the bar it is moved on', () => {
    // a 4.5-hour box drawn on 15m, moved three 4h bars on the 4h chart
    const box = rectanglePoints({ timestamp: 4.25 * HOUR, value: 85_741 }, { timestamp: 8.75 * HOUR, value: 84_475 })
    const moved = translatePoints(box, 3 * 4 * HOUR, -100)
    expect(moved[2].timestamp - moved[0].timestamp).toBe(4.5 * HOUR)
    expect(moved[0]).toEqual({ timestamp: 16.25 * HOUR, value: 85_641 })
    expect(moved[0].value - moved[4].value).toBeCloseTo(box[0].value - box[4].value)
  })

  it('never produces a negative time', () => {
    expect(translatePoints([{ timestamp: 10, value: 1 }], -50, 0)[0].timestamp).toBe(0)
  })
})

describe('lockToAxis', () => {
  const start = { timestamp: 1000, value: 50 }
  const current = { timestamp: 4000, value: 80 }

  it('flattens the price when the pointer moved mostly sideways, and the time when it moved mostly up', () => {
    expect(lockToAxis(start, current, { dx: 120, dy: -30 })).toEqual({ timestamp: 4000, value: 50 })
    expect(lockToAxis(start, current, { dx: 20, dy: -90 })).toEqual({ timestamp: 1000, value: 80 })
  })
})

describe('magnetPrice', () => {
  const candle = { open: 100, high: 110, low: 90, close: 105 }
  const toPixel = (price: number) => (200 - price) * 4 // 4px per unit

  it('snaps to the nearest OHLC level within tolerance and leaves farther prices alone', () => {
    expect(magnetPrice(109, candle, toPixel, 12)).toBe(110)
    expect(magnetPrice(103.5, candle, toPixel, 12)).toBe(105)
    expect(magnetPrice(96, candle, toPixel, 12)).toBe(96)
    expect(magnetPrice(96, null, toPixel, 12)).toBe(96)
  })
})

describe('positionPoints', () => {
  const entry = { timestamp: 10 * HOUR, value: 100 }
  const defaults = { priceSpan: 10, timeSpanMs: 5 * HOUR }

  it('gives a plain click a 2:1 box of default size on the correct side', () => {
    const [, longTarget, longStop] = positionPoints('long', entry, null, defaults)
    expect([longTarget.value, longStop.value]).toEqual([110, 95])
    expect(longTarget.timestamp).toBe(15 * HOUR)

    const [, shortTarget, shortStop] = positionPoints('short', entry, null, defaults)
    expect([shortTarget.value, shortStop.value]).toEqual([90, 105])
  })

  it('uses a drag toward profit as the target and derives the stop at 2:1', () => {
    const [, target, stop] = positionPoints('long', entry, { timestamp: 14 * HOUR, value: 120 }, defaults)
    expect([target.value, stop.value]).toEqual([120, 90])
    expect(target.timestamp).toBe(14 * HOUR)
  })

  it('uses a drag toward loss as the stop and derives the target at 2:1', () => {
    const [, target, stop] = positionPoints('long', entry, { timestamp: 14 * HOUR, value: 96 }, defaults)
    expect([target.value, stop.value]).toEqual([108, 96])

    const [, shortTarget, shortStop] = positionPoints('short', entry, { timestamp: 14 * HOUR, value: 80 }, defaults)
    expect([shortTarget.value, shortStop.value]).toEqual([80, 110])
  })
})

describe('clampPositionLevels', () => {
  it('keeps target and stop on their own sides of entry', () => {
    expect(clampPositionLevels('long', 100, 95, 105)).toEqual({ target: 100, stop: 100 })
    expect(clampPositionLevels('long', 100, 120, 90)).toEqual({ target: 120, stop: 90 })
    expect(clampPositionLevels('short', 100, 105, 95)).toEqual({ target: 100, stop: 100 })
    expect(clampPositionLevels('short', 100, 80, 110)).toEqual({ target: 80, stop: 110 })
  })
})

describe('fibLevelPrice', () => {
  it('puts 0 on the second point, 1 on the first, and extends past it', () => {
    expect(fibLevelPrice(200, 100, 0)).toBe(100)
    expect(fibLevelPrice(200, 100, 1)).toBe(200)
    expect(fibLevelPrice(200, 100, 0.618)).toBeCloseTo(161.8)
    expect(fibLevelPrice(200, 100, 1.618)).toBeCloseTo(261.8)
  })
})

describe('drawing tool table', () => {
  it('describes every drawing type exactly once and lists each in the rail', () => {
    expect(Object.keys(DRAWING_TOOLS).sort()).toEqual([...DRAWING_TYPES].sort())
    expect([...TOOL_ORDER].sort()).toEqual([...DRAWING_TYPES].sort())
    const shortcuts = TOOL_ORDER.map((type) => DRAWING_TOOLS[type].shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })

  it('converts overlays for each tool with the right number of anchors and its default style', () => {
    for (const type of TOOL_ORDER) {
      const count = anchorCountFor(type)
      const points = Array.from({ length: type === 'rectangle' ? 2 : count }, (_, index) => ({
        timestamp: 1000 + index * 1000,
        value: 100 + index * 10,
      }))
      const drawing = drawingFromOverlay({ id: `d-${type}`, points } as never, 'binance:spot:BTCUSDT', undefined, type)
      expect(drawing?.anchors).toHaveLength(count)
      expect(drawing?.style).toBe(DRAWING_TOOLS[type].defaultStyle)
    }
  })

  it('rebuilds a rectangle from its bounding box even when its handles were dragged out of order', () => {
    const flipped = [
      { timestamp: 2000, value: 100 }, { timestamp: 1500, value: 100 }, { timestamp: 1000, value: 100 },
      { timestamp: 1000, value: 150 }, { timestamp: 1000, value: 200 }, { timestamp: 1500, value: 200 },
      { timestamp: 2000, value: 200 }, { timestamp: 2000, value: 150 },
    ]
    const drawing = drawingFromOverlay({ id: 'r', points: flipped } as never, 'binance:spot:BTCUSDT', undefined, 'rectangle')
    expect(drawing?.anchors[0]).toEqual({ timeMs: 1000, price: '200' })
    expect(drawing?.anchors[4]).toEqual({ timeMs: 2000, price: '100' })
  })
})
