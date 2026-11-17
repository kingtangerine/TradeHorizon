import { targetAt } from '../../../server/alertRules.ts'
import { clampDcaPrice } from '../../chart/geometry'
import { movingAverageActive, type IndicatorSettings } from '../../chart/indicators'
import { decimalString } from '../../chart/model'
import { DRAWING_TOOLS } from '../../chart/tools'
import type { ChartRuntimeState } from '../../chart/types'
import type { Drawing, DrawingType, DrawingUpdate } from '../../drawings'
import type { MarketInterval } from '../../market'
import type { AlertOptions, PriceAlert } from '../alerts'
import type { AlertEvent } from '../backgroundAlerts'
import type { UserWorkspace } from '../workspace'

/** Timeframe of the chart before the first runtime update, and of a newly opened chart tab. */
export const INITIAL_INTERVAL: MarketInterval = '15m'

/** Name used for a layout whose name was left empty. */
export const DEFAULT_LAYOUT_NAME = 'Main layout'

/** Long and short positions: drawings with risk settings, a DCA line and their own settings window. */
export function isPositionTool(type: DrawingType): boolean {
  return DRAWING_TOOLS[type].placement === 'position'
}

/** The replay bar's clock: the newest revealed bar in UTC, or a dash before one is chosen. */
export function formatReplayTime(valueMs: number | null): string {
  if (valueMs === null) return '—'
  return `${new Date(valueMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Text of the connection chip in the toolbar. */
export function connectionCopy(state: ChartRuntimeState): string {
  switch (state.connection) {
    case 'live':
      return 'Live'
    case 'reconnecting':
      return 'Reconnecting'
    case 'connecting':
      return 'Connecting'
    case 'loading':
      return 'Loading history'
    case 'error':
      return 'Data unavailable'
  }
}

/** A numeric drawing style value, or the fallback when it is missing or not a finite number. */
export function styleNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Short name of the kind of market (spot, perpetual futures or an index). */
export function marketKindLabel(market: { kind: 'spot' | 'futures' | 'dominance' }): string {
  return market.kind === 'spot' ? 'Spot' : market.kind === 'futures' ? 'Perpetual' : 'Index'
}

/** A drawing color as "#rrggbb" for a color picker (rgb()/rgba() values are converted, anything else gives the fallback). */
export function colorInputValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{6}$/i.test(value)) return value

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (!rgba) return fallback
  return `#${rgba
    .slice(1, 4)
    .map((part) =>
      Math.max(0, Math.min(255, Number(part)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** How many indicators are on the chart (the Indicators button is highlighted when there are any). */
export function countActiveIndicators(volumeVisible: boolean, indicators: IndicatorSettings): number {
  return (
    (volumeVisible ? 1 : 0) +
    (movingAverageActive(indicators.sma) ? 1 : 0) +
    (movingAverageActive(indicators.ema) ? 1 : 0) +
    (indicators.vwap.visible ? 1 : 0) +
    (indicators.qvwap.visible ? 1 : 0) +
    Object.values(indicators.dominance).filter(Boolean).length +
    indicators.studies.length +
    indicators.scripts.length
  )
}

/** The workspace without the tab `id`; closing the active tab activates the one before it. The last tab cannot be closed. */
export function closeTab(current: UserWorkspace, id: string): UserWorkspace {
  if (current.tabs.length === 1) return current
  const index = current.tabs.findIndex((tab) => tab.id === id)
  const tabs = current.tabs.filter((tab) => tab.id !== id)
  if (current.activeTabId !== id) return { ...current, tabs }
  const next = tabs[Math.max(0, index - 1)] ?? tabs[0]
  return { ...current, tabs, activeTabId: next.id }
}

/** Switches an alert off, or back on (re-armed: its last trigger is cleared). */
export function toggleAlertEnabled(alert: PriceAlert): PriceAlert {
  if (alert.enabled) return { ...alert, enabled: false }
  const { triggeredAtMs: _at, triggeredPrice: _price, ...rearmed } = alert
  return { ...rearmed, enabled: true }
}

/** Records alerts that fired in the app: "every time" alerts count the trigger and stay on, the others switch off. */
export function withTriggeredAlerts(
  current: readonly PriceAlert[],
  triggered: readonly PriceAlert[],
  now: number,
  price: number,
): PriceAlert[] {
  return current.map((alert) => {
    if (!triggered.some((item) => item.id === alert.id)) return alert
    return alert.frequency === 'everyTime'
      ? { ...alert, lastTriggeredAtMs: now, lastTriggeredPrice: price, triggerCount: (alert.triggerCount ?? 0) + 1 }
      : { ...alert, triggeredAtMs: now, triggeredPrice: price, enabled: false }
  })
}

/** Whether a trigger reported by the server is not yet recorded on the alert. */
export function isNewAlertEvent(alert: PriceAlert, event: { triggeredAtMs: number; everyTime?: boolean }): boolean {
  return event.everyTime ? (alert.lastTriggeredAtMs ?? 0) < event.triggeredAtMs : !alert.triggeredAtMs
}

/** Records triggers reported by the server on the alerts they belong to. */
export function withServerAlertEvents(current: readonly PriceAlert[], fresh: readonly AlertEvent[]): PriceAlert[] {
  return current.map((alert) => {
    const event = fresh.find((item) => item.id === alert.id)
    if (!event || !isNewAlertEvent(alert, event)) return alert
    return event.everyTime
      ? { ...alert, lastTriggeredAtMs: event.triggeredAtMs, lastTriggeredPrice: event.triggeredPrice }
      : { ...alert, enabled: false, triggeredAtMs: event.triggeredAtMs, triggeredPrice: event.triggeredPrice }
  })
}

/** Changes that add a DCA (second buy) line to a position drawing, or remove it when it has one. */
export function dcaToggleChanges(drawing: Drawing): DrawingUpdate {
  const [entry, target, stop] = drawing.anchors
  if (drawing.anchors.length > 3) {
    return {
      anchors: drawing.anchors.slice(0, 3),
      style: { ...drawing.style, dcaTriggered: false },
    }
  }
  return {
    anchors: [
      ...drawing.anchors,
      {
        timeMs: Math.round(entry.timeMs + (target.timeMs - entry.timeMs) / 2),
        price: decimalString(clampDcaPrice(Number(entry.price), Number(stop.price))),
      },
    ],
  }
}

/** Alert that fires when the price crosses a trend line or ray, and the line's price now. */
export function trendLineAlert(
  drawing: Drawing,
  symbol: string,
  pricePrecision: number,
  last: number | undefined,
  now: number,
): { options: AlertOptions; target: number } {
  const [first, second] = drawing.anchors
  const line = { t1: first.timeMs, p1: Number(first.price), t2: second.timeMs, p2: Number(second.price) }
  const target = targetAt({ id: '', symbol, targetPrice: line.p1, direction: 'above', line }, now)
  return {
    options: {
      targetPrice: Number(target.toFixed(pricePrecision)),
      direction: last !== undefined && last > target ? 'below' : 'above',
      condition: 'crossing',
      line,
    },
    target,
  }
}
