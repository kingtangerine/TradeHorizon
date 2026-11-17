import type { Chart, OverlayEvent } from 'klinecharts'
import { ALERT_LINE_OVERLAY_NAME } from '../overlayNames'
import type { AlertLine, KLineChartControllerCallbacks } from './types'

const ALERT_GROUP_ID = 'trade-horizon:alerts'
const ALERT_OVERLAY_PREFIX = 'alert:'
const ALERT_COLOR = '#f5a623'
/** Alert lines sit above every drawing (see the stacking note in drawingLayer.ts). */
const ALERT_Z_LEVEL = 2_000_000
const ALERT_PAUSED_COLOR = '#787b86'

/** Price alerts drawn as draggable lines with a delete button. */
export class AlertLines {
  readonly #chart: Chart
  readonly #callbacks: Pick<KLineChartControllerCallbacks, 'onAlertMove' | 'onAlertDelete'>
  #alertLines: readonly AlertLine[] = []

  /** Draws on `chart`; drags and delete clicks go to `callbacks`. */
  public constructor(chart: Chart, callbacks: Pick<KLineChartControllerCallbacks, 'onAlertMove' | 'onAlertDelete'>) {
    this.#chart = chart
    this.#callbacks = callbacks
  }

  /** Shows these price alerts as draggable lines (an empty list hides them all). */
  public set(lines: readonly AlertLine[]): void {
    this.#alertLines = lines
    const wanted = new Map(lines.map((line) => [ALERT_OVERLAY_PREFIX + line.id, line]))
    for (const overlay of this.#chart.getOverlays({ groupId: ALERT_GROUP_ID })) {
      if (!wanted.has(overlay.id)) this.#chart.removeOverlay({ id: overlay.id })
    }
    const existing = new Set(this.#chart.getOverlays({ groupId: ALERT_GROUP_ID }).map((overlay) => overlay.id))
    // The line spans the whole chart, so only its price matters; the time just has to be a valid candle.
    const timestamp = this.#chart.getDataList().at(-1)?.timestamp ?? Date.now()
    for (const [overlayId, line] of wanted) {
      const configuration = {
        id: overlayId,
        name: ALERT_LINE_OVERLAY_NAME,
        groupId: ALERT_GROUP_ID,
        zLevel: ALERT_Z_LEVEL,
        fixedZLevel: true,
        points: [{ timestamp, value: line.price }],
        styles: { alertColor: line.paused ? ALERT_PAUSED_COLOR : ALERT_COLOR, alertPaused: line.paused ? 1 : 0 },
        onPressedMoveEnd: (event: OverlayEvent<unknown>) => {
          const price = event.overlay.points[0]?.value
          const current = this.#alertLines.find((item) => item.id === line.id)
          if (price === undefined || !Number.isFinite(price) || price <= 0 || !current) return
          const rounded = Number(price.toFixed(this.#chart.getSymbol()?.pricePrecision ?? 8))
          if (rounded !== current.price) this.#callbacks.onAlertMove?.(line.id, rounded)
        },
        onClick: (event: OverlayEvent<unknown>) => {
          if (event.figure?.key === 'alert-delete') this.#callbacks.onAlertDelete?.(line.id)
        },
        // The library deletes an overlay on right-click unless this is prevented.
        onRightClick: (event: OverlayEvent<unknown>) => {
          event.preventDefault?.()
        },
      }
      if (existing.has(overlayId)) this.#chart.overrideOverlay(configuration as never)
      else this.#chart.createOverlay(configuration as never)
    }
  }
}
