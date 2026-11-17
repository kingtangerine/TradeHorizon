import { describe, expect, it } from 'vitest'
import { clampDcaPrice } from '../../chart/geometry'
import { DEFAULT_INDICATORS } from '../../chart/indicators'
import { decimalString } from '../../chart/model'
import { DRAWING_SCHEMA_VERSION, type Drawing } from '../../drawings'
import type { PriceAlert } from '../alerts'
import type { UserWorkspace } from '../workspace'
import {
  closeTab,
  colorInputValue,
  connectionCopy,
  countActiveIndicators,
  dcaToggleChanges,
  formatReplayTime,
  isNewAlertEvent,
  isPositionTool,
  marketKindLabel,
  styleNumber,
  toggleAlertEnabled,
  trendLineAlert,
  withServerAlertEvents,
  withTriggeredAlerts,
} from './workspaceHelpers'

const alert = (overrides: Partial<PriceAlert> = {}): PriceAlert => ({
  id: 'a1',
  symbol: 'BTCUSDT',
  targetPrice: 100,
  direction: 'above',
  enabled: true,
  createdAtMs: 1,
  ...overrides,
})

const drawing = (overrides: Partial<Drawing> = {}): Drawing => ({
  schemaVersion: DRAWING_SCHEMA_VERSION,
  id: 'd1',
  marketId: 'binance:BTCUSDT',
  type: 'longPosition',
  anchors: [
    { timeMs: 1_000, price: '100' },
    { timeMs: 3_000, price: '120' },
    { timeMs: 1_000, price: '90' },
  ],
  style: {},
  revision: 1,
  ...overrides,
})

const tab = (id: string) => ({ id, symbol: 'BTCUSDT', interval: '15m' as const, createdAtMs: 1 })

const workspace = (ids: string[], activeTabId: string): UserWorkspace => ({
  tabs: ids.map(tab),
  activeTabId,
  layoutName: 'Main layout',
  volumeVisible: true,
  customIntervals: [],
})

describe('small display helpers', () => {
  it('formats the replay time in UTC, or a dash without one', () => {
    expect(formatReplayTime(null)).toBe('—')
    expect(formatReplayTime(Date.UTC(2024, 0, 2, 3, 4, 5))).toBe('2024-01-02 03:04 UTC')
  })

  it('names each connection state', () => {
    const state = (connection: 'live' | 'reconnecting' | 'connecting' | 'loading' | 'error') => ({
      interval: '15m' as const,
      connection,
      quote: null,
      error: null,
      followingLive: true,
    })
    expect(connectionCopy(state('live'))).toBe('Live')
    expect(connectionCopy(state('reconnecting'))).toBe('Reconnecting')
    expect(connectionCopy(state('connecting'))).toBe('Connecting')
    expect(connectionCopy(state('loading'))).toBe('Loading history')
    expect(connectionCopy(state('error'))).toBe('Data unavailable')
  })

  it('reads numeric styles with a fallback', () => {
    expect(styleNumber(3, 1)).toBe(3)
    expect(styleNumber('3', 1)).toBe(1)
    expect(styleNumber(Number.NaN, 1)).toBe(1)
    expect(styleNumber(undefined, 2)).toBe(2)
  })

  it('labels market kinds', () => {
    expect(marketKindLabel({ kind: 'spot' })).toBe('Spot')
    expect(marketKindLabel({ kind: 'futures' })).toBe('Perpetual')
    expect(marketKindLabel({ kind: 'dominance' })).toBe('Index')
  })

  it('turns drawing colors into #rrggbb for color pickers', () => {
    expect(colorInputValue('#A1b2C3', '#000000')).toBe('#A1b2C3')
    expect(colorInputValue('rgba(255, 0, 16, 0.5)', '#000000')).toBe('#ff0010')
    expect(colorInputValue('rgb(300,1,2)', '#000000')).toBe('#ff0102')
    expect(colorInputValue('red', '#123456')).toBe('#123456')
    expect(colorInputValue(42, '#123456')).toBe('#123456')
  })

  it('knows which tools are positions', () => {
    expect(isPositionTool('longPosition')).toBe(true)
    expect(isPositionTool('shortPosition')).toBe(true)
    expect(isPositionTool('trendLine')).toBe(false)
  })
})

describe('countActiveIndicators', () => {
  it('counts nothing for the defaults without volume', () => {
    expect(countActiveIndicators(false, DEFAULT_INDICATORS)).toBe(0)
  })

  it('counts volume, moving averages, VWAPs, dominance, studies and scripts', () => {
    const indicators = {
      ...DEFAULT_INDICATORS,
      sma: { visible: true, periods: [20] },
      vwap: { ...DEFAULT_INDICATORS.vwap, visible: true },
      qvwap: { visible: true },
      dominance: { btc: true, usdt: false, alt: true },
    }
    expect(countActiveIndicators(true, indicators)).toBe(1 + 1 + 1 + 1 + 2)
  })
})

describe('closeTab', () => {
  it('keeps the last tab open', () => {
    const current = workspace(['a'], 'a')
    expect(closeTab(current, 'a')).toBe(current)
  })

  it('keeps the active tab when another one closes', () => {
    const next = closeTab(workspace(['a', 'b', 'c'], 'a'), 'c')
    expect(next.tabs.map((item) => item.id)).toEqual(['a', 'b'])
    expect(next.activeTabId).toBe('a')
  })

  it('activates the tab before the closed active tab, or the first one', () => {
    expect(closeTab(workspace(['a', 'b', 'c'], 'b'), 'b').activeTabId).toBe('a')
    expect(closeTab(workspace(['a', 'b', 'c'], 'a'), 'a').activeTabId).toBe('b')
  })
})

describe('alert updates', () => {
  it('switches an alert off, and back on without its last trigger', () => {
    expect(toggleAlertEnabled(alert()).enabled).toBe(false)
    const rearmed = toggleAlertEnabled(alert({ enabled: false, triggeredAtMs: 5, triggeredPrice: 101 }))
    expect(rearmed).toEqual(alert())
  })

  it('records local triggers: once alerts switch off, every-time alerts count', () => {
    const once = alert({ id: 'once' })
    const every = alert({ id: 'every', frequency: 'everyTime', triggerCount: 2 })
    const other = alert({ id: 'other' })
    const [a, b, c] = withTriggeredAlerts([once, every, other], [once, every], 50, 101)
    expect(a).toEqual({ ...once, triggeredAtMs: 50, triggeredPrice: 101, enabled: false })
    expect(b).toEqual({ ...every, lastTriggeredAtMs: 50, lastTriggeredPrice: 101, triggerCount: 3 })
    expect(c).toBe(other)
  })

  it('tells which server events are new', () => {
    expect(isNewAlertEvent(alert(), { triggeredAtMs: 10 })).toBe(true)
    expect(isNewAlertEvent(alert({ triggeredAtMs: 5 }), { triggeredAtMs: 10 })).toBe(false)
    expect(isNewAlertEvent(alert({ lastTriggeredAtMs: 5 }), { triggeredAtMs: 10, everyTime: true })).toBe(true)
    expect(isNewAlertEvent(alert({ lastTriggeredAtMs: 10 }), { triggeredAtMs: 10, everyTime: true })).toBe(false)
  })

  it('records server events on their alerts', () => {
    const once = alert({ id: 'once' })
    const every = alert({ id: 'every', frequency: 'everyTime' })
    const done = alert({ id: 'done', triggeredAtMs: 3 })
    const event = { symbol: 'BTCUSDT', targetPrice: 100, direction: 'above' as const }
    const result = withServerAlertEvents(
      [once, every, done],
      [
        { ...event, id: 'once', triggeredAtMs: 20, triggeredPrice: 102 },
        { ...event, id: 'every', triggeredAtMs: 21, triggeredPrice: 103, everyTime: true },
        { ...event, id: 'done', triggeredAtMs: 22, triggeredPrice: 104 },
      ],
    )
    expect(result[0]).toEqual({ ...once, enabled: false, triggeredAtMs: 20, triggeredPrice: 102 })
    expect(result[1]).toEqual({ ...every, lastTriggeredAtMs: 21, lastTriggeredPrice: 103 })
    expect(result[2]).toBe(done)
  })
})

describe('dcaToggleChanges', () => {
  it('adds a DCA anchor halfway in time between entry and target, at the clamped DCA price', () => {
    const changes = dcaToggleChanges(drawing())
    expect(changes.anchors).toHaveLength(4)
    expect(changes.anchors?.[3]).toEqual({ timeMs: 2_000, price: decimalString(clampDcaPrice(100, 90)) })
    expect(changes.style).toBeUndefined()
  })

  it('removes the DCA anchor and clears its triggered flag', () => {
    const withDca = drawing({
      anchors: [...drawing().anchors, { timeMs: 2_000, price: '95' }],
      style: { dcaTriggered: true, lineWidth: 2 },
    })
    expect(dcaToggleChanges(withDca)).toEqual({
      anchors: withDca.anchors.slice(0, 3),
      style: { dcaTriggered: false, lineWidth: 2 },
    })
  })
})

describe('trendLineAlert', () => {
  const line = drawing({
    type: 'trendLine',
    anchors: [
      { timeMs: 0, price: '100' },
      { timeMs: 1_000, price: '200' },
    ],
  })

  it('targets the line price now and crosses from the side of the last price', () => {
    const above = trendLineAlert(line, 'BTCUSDT', 2, 120, 500)
    expect(above.target).toBeCloseTo(150)
    expect(above.options).toEqual({
      targetPrice: 150,
      direction: 'above',
      condition: 'crossing',
      line: { t1: 0, p1: 100, t2: 1_000, p2: 200 },
    })
    expect(trendLineAlert(line, 'BTCUSDT', 2, 180, 500).options.direction).toBe('below')
    expect(trendLineAlert(line, 'BTCUSDT', 2, undefined, 500).options.direction).toBe('above')
  })
})
