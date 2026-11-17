import type { Chart, Point } from 'klinecharts'
import type { ChartSyncLink } from './chartSyncLink'
import type { HoverState } from './types'

/** What hover tracking needs from the controller. */
export interface HoverTrackerDeps {
  readonly chart: Chart
  /** This chart's market symbol. */
  readonly symbol: string
  readonly isDisposed: () => boolean
  readonly sync: ChartSyncLink
}

/** The candle under the crosshair for the legend, also passed to the other charts of a split view. */
export class HoverTracker {
  readonly #deps: HoverTrackerDeps
  #hover: HoverState | null = null
  readonly #hoverListeners = new Set<() => void>()

  /** Starts with nothing hovered. */
  public constructor(deps: HoverTrackerDeps) {
    this.#deps = deps
  }

  /** Calls `listener` when the hovered candle changes; returns the unsubscribe. */
  public subscribe(listener: () => void): () => void {
    this.#hoverListeners.add(listener)
    return () => {
      this.#hoverListeners.delete(listener)
    }
  }

  /** The candle under the crosshair, or null. */
  public get hover(): HoverState | null {
    return this.#hover
  }

  #setHover(next: HoverState | null): void {
    if (next === this.#hover || (next && this.#hover && next.index === this.#hover.index && next.bar === this.#hover.bar)) return
    this.#hover = next
    for (const listener of this.#hoverListeners) listener()
  }

  /** The chart's onCrosshairChange action. */
  public readonly handleCrosshair = (data?: unknown): void => {
    const chart = this.#deps.chart
    const x = (data as { x?: number } | undefined)?.x
    if (typeof x !== 'number' || this.#deps.isDisposed()) return
    const list = chart.getDataList()
    if (list.length === 0) return
    const [point] = chart.convertFromPixel([{ x }], { paneId: 'candle_pane' }) as Array<Partial<Point>>
    if (point?.dataIndex === undefined) return
    const index = Math.max(0, Math.min(list.length - 1, point.dataIndex))
    this.#setHover({ index, bar: list[index], previousClose: list[index - 1]?.close, latest: index === list.length - 1 })
    if (this.#deps.sync.sharesCrosshair) {
      const y = (data as { y?: number }).y
      const [value] = typeof y === 'number' ? (chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' }) as Array<Partial<Point>>) : []
      this.#deps.sync.broadcastCrosshair({
        timestamp: list[index].timestamp,
        price: value?.value ?? list[index].close,
        symbol: this.#deps.symbol,
      })
    }
  }

  /** The pointer left the chart: nothing is hovered any more. */
  public readonly handleHostLeave = (): void => {
    this.#setHover(null)
    if (this.#deps.sync.sharesCrosshair) this.#deps.sync.broadcastCrosshair(null)
  }

  /** Forgets every listener. */
  public clearListeners(): void {
    this.#hoverListeners.clear()
  }
}
