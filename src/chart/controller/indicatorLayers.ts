import type { Chart } from 'klinecharts'
import type { DominanceRow, MarketInterval } from '../../market'
import { DOMINANCE_KEYS, dominanceCalc, dominanceIndicatorName, fetchDominancePage, loadDominanceWeights } from '../dominance'
import {
  DOMINANCE_COLORS,
  MOVING_AVERAGE_COLORS,
  VWAP_COLORS,
  movingAverageActive,
  type DominanceKey,
  type MovingAverageKind,
  type MovingAverageSettings,
  type ScriptInstance,
} from '../indicators'
import type { CryptoMarket } from '../markets'
import { runScript } from '../script'
import { SCRIPT_INDICATOR_NAME, compiledScript, type ScriptExtend } from '../scriptIndicator'
import { STUDIES, type Study } from '../studies'
import { studyIndicatorName } from '../studyIndicators'
import type { ChartRuntimeState } from '../types'
import { VOLUME_OVERLAY_NAME } from '../volumeOverlay'
import { VWAP_ANCHORS } from '../vwap'
import { QVWAP_INDICATOR_NAME, VWAP_INDICATOR_NAME } from '../vwapIndicator'
import { HIDDEN_INDICATOR_TOOLTIP, errorMessage } from './helpers'
import type { IndicatorValues, PatchRuntime } from './types'

const DOMINANCE_INDICATOR_REFRESH_MS = 60_000

/** What the indicator layers need from the controller. */
export interface IndicatorLayersDeps {
  readonly chart: Chart
  readonly market: CryptoMarket
  /** The chart's current timeframe. */
  readonly interval: () => MarketInterval
  readonly isDisposed: () => boolean
  readonly runtimeState: () => ChartRuntimeState
  readonly patchRuntime: PatchRuntime
}

/**
 * The klinecharts indicators on the chart: volume, the Heikin Ashi / baseline series, moving averages, VWAPs, library
 * studies, user scripts and dominance panes, and reading their values for the HTML legends.
 */
export class IndicatorLayers {
  readonly #deps: IndicatorLayersDeps
  readonly #vwapIds = new Map<'vwap' | 'qvwap', string>()
  #volumeIndicatorId?: string
  #seriesIndicator: { id: string; name: string } | undefined
  /** Indicator-library studies on the chart: study id -> klinecharts indicator. */
  readonly #studyIds = new Map<string, { indicatorId: string; type: Study['type'] }>()
  /** User scripts on the chart: instance id -> klinecharts indicator, its pane and its plots. */
  readonly #scriptIds = new Map<string, { indicatorId: string; overlay: boolean; extend: ScriptExtend }>()
  readonly #movingAverageIds = new Map<MovingAverageKind, string>()
  readonly #dominanceIds = new Map<DominanceKey, string>()
  #dominanceRows?: DominanceRow[]
  #dominanceRowsInterval?: MarketInterval
  #dominanceIndicatorPoll?: ReturnType<typeof globalThis.setInterval>
  #dominanceEpoch = 0

  /** Starts with no indicators. */
  public constructor(deps: IndicatorLayersDeps) {
    this.#deps = deps
  }

  /** Shows or hides the volume bars along the bottom of the price pane (never on an index, which has no volume). */
  public setVolumeVisible(requested: boolean): void {
    // An index has no traded volume, so its pane would always be empty.
    const visible = requested && this.#deps.market.kind !== 'dominance'

    if (visible && !this.#volumeIndicatorId) {
      // Along the bottom of the price pane, behind the candles (negative zLevel), like TradingView.
      const id = this.#deps.chart.createIndicator(
        { name: VOLUME_OVERLAY_NAME, paneId: 'candle_pane', zLevel: -1, createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP },
        true,
      )
      if (id) this.#volumeIndicatorId = id
      return
    }

    if (!visible && this.#volumeIndicatorId) {
      this.#deps.chart.removeIndicator({ id: this.#volumeIndicatorId })
      this.#volumeIndicatorId = undefined
    }
  }

  /** Heikin Ashi and baseline are our own series over the (hidden) candles: keeps the one named `wanted` (or none). */
  public setSeries(wanted: string | undefined): void {
    if (this.#seriesIndicator && this.#seriesIndicator.name !== wanted) {
      this.#deps.chart.removeIndicator({ id: this.#seriesIndicator.id })
      this.#seriesIndicator = undefined
    }
    if (wanted && !this.#seriesIndicator) {
      const id = this.#deps.chart.createIndicator(
        { name: wanted, paneId: 'candle_pane', createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP },
        true,
      )
      if (id) this.#seriesIndicator = { id, name: wanted }
    }
  }

  /** Moving average and VWAP values for a candle (the newest when `index` is undefined). */
  public indicatorValuesAt(index?: number): IndicatorValues {
    const chart = this.#deps.chart
    const at = index ?? chart.getDataList().length - 1
    const row = (id: string | undefined): Record<string, number | undefined> | undefined => {
      if (!id) return undefined
      const indicator = chart.getIndicators({ id })[0] as { result?: Array<Record<string, number | undefined>> } | undefined
      return indicator?.result?.[at]
    }
    const series = (kind: MovingAverageKind, prefix: string): Array<number | undefined> => {
      const values = row(this.#movingAverageIds.get(kind))
      return values
        ? Object.keys(values)
            .filter((key) => key.startsWith(prefix))
            .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
            .map((key) => values[key])
        : []
    }
    return {
      sma: series('sma', 'ma'),
      ema: series('ema', 'ema'),
      vwap: row(this.#vwapIds.get('vwap'))?.vwap,
      qvwap: row(this.#vwapIds.get('qvwap'))?.vwap,
    }
  }

  /** User scripts: run once here to learn their plots (titles, colours), then klinecharts recalculates them itself. */
  public applyScripts(instances: readonly ScriptInstance[]): void {
    const chart = this.#deps.chart
    const wanted = new Map(instances.map((item) => [item.id, item]))
    for (const [id, entry] of this.#scriptIds) {
      const instance = wanted.get(id)
      const script = instance ? compiledScript(instance.source) : undefined
      if (!instance || !script || script instanceof Error || script.overlay !== entry.overlay) {
        chart.removeIndicator({ id: entry.indicatorId })
        this.#scriptIds.delete(id)
      }
    }
    const data = chart.getDataList()
    for (const instance of instances) {
      const script = compiledScript(instance.source)
      if (script instanceof Error) continue
      let extend: ScriptExtend
      try {
        const sample = runScript(script, data.slice(-300), instance.inputs)
        extend = {
          source: instance.source,
          inputs: instance.inputs,
          plots: sample.plots.map((plot) => ({ title: plot.title, color: plot.color, width: plot.width })),
          hlines: sample.hlines.map((line) => ({ value: line.value, color: line.color })),
        }
      } catch {
        continue
      }
      const precision = script.precision ?? (script.overlay ? (chart.getSymbol()?.pricePrecision ?? 2) : 2)
      const name = script.title || instance.name
      const legend = (indicator: { result?: Array<Record<string, number | undefined>> }, dataIndex: number | undefined) => ({
        name,
        calcParamsText:
          instance.inputs.length > 0
            ? ` ${(instance.inputs.length ? instance.inputs : script.inputs.map((input) => input.defaultValue)).join(' ')}`
            : '',
        features: [],
        legends: extend.plots.map((plot, index) => {
          const value = indicator.result?.[dataIndex ?? indicator.result.length - 1]?.[`p${index}`]
          return {
            title: { text: `${plot.title}: `, color: plot.color },
            value: { text: value === undefined ? '—' : value.toFixed(precision), color: plot.color },
          }
        }),
      })
      const config = {
        name: SCRIPT_INDICATOR_NAME,
        visible: instance.visible,
        precision,
        extendData: extend,
        styles: {
          lines: Array.from({ length: 8 }, (_, index) => ({
            color: extend.plots[index]?.color ?? 'transparent',
            size: extend.plots[index]?.width ?? 1.5,
          })),
        },
        createTooltipDataSource: script.overlay
          ? () => HIDDEN_INDICATOR_TOOLTIP
          : ({
              indicator,
              crosshair,
            }: {
              indicator: { result?: Array<Record<string, number | undefined>> }
              crosshair: { dataIndex?: number }
            }) => legend(indicator, crosshair.dataIndex),
      }
      const existing = this.#scriptIds.get(instance.id)
      if (existing) {
        chart.overrideIndicator({ id: existing.indicatorId, ...config } as never)
        existing.extend = extend
        continue
      }
      const paneId = script.overlay ? 'candle_pane' : `trade-horizon:script:${instance.id}`
      const created = chart.createIndicator({ ...config, paneId } as never, script.overlay)
      if (!created) continue
      this.#scriptIds.set(instance.id, { indicatorId: created, overlay: script.overlay, extend })
      if (!script.overlay) chart.setPaneOptions({ id: paneId, height: 120, minHeight: 64 })
    }
  }

  /** A script's plots at a candle (the newest when `index` is undefined), for the legend of scripts on the candles. */
  public scriptValuesAt(instanceId: string, index?: number): Array<{ title: string; color: string; value?: number }> {
    const entry = this.#scriptIds.get(instanceId)
    if (!entry || this.#deps.isDisposed()) return []
    const at = index ?? this.#deps.chart.getDataList().length - 1
    const indicator = this.#deps.chart.getIndicators({ id: entry.indicatorId })[0] as
      { result?: Array<Record<string, number | undefined>> } | undefined
    const row = indicator?.result?.[at]
    return entry.extend.plots.map((plot, plotIndex) => ({ title: plot.title, color: plot.color, value: row?.[`p${plotIndex}`] }))
  }

  /** Library studies: price-pane ones stack on the candles (legend in HTML), the rest get their own pane and legend. */
  public applyStudies(studies: readonly Study[]): void {
    const chart = this.#deps.chart
    const wanted = new Map(studies.map((study) => [study.id, study]))
    for (const [id, entry] of this.#studyIds) {
      const study = wanted.get(id)
      if (!study || study.type !== entry.type) {
        chart.removeIndicator({ id: entry.indicatorId })
        this.#studyIds.delete(id)
      }
    }
    for (const study of studies) {
      const definition = STUDIES[study.type]
      const onPrice = definition.pane === 'price'
      const precision = onPrice || study.type === 'atr' ? (chart.getSymbol()?.pricePrecision ?? 2) : definition.type === 'macd' ? 4 : 2
      const config = {
        name: studyIndicatorName(study.type),
        calcParams: [...study.params],
        visible: study.visible,
        precision,
        extendData: { colors: study.colors },
        styles: { lines: study.colors.map((color) => ({ color, size: 1.5 })) },
      }
      const existing = this.#studyIds.get(study.id)
      if (existing) {
        chart.overrideIndicator({ id: existing.indicatorId, ...config })
        continue
      }
      const paneId = onPrice ? 'candle_pane' : `trade-horizon:study:${study.id}`
      const created = chart.createIndicator(
        { ...config, paneId, ...(onPrice ? { createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP } : {}) },
        onPrice,
      )
      if (!created) continue
      this.#studyIds.set(study.id, { indicatorId: created, type: study.type })
      if (!onPrice) chart.setPaneOptions({ id: paneId, height: 120, minHeight: 64 })
    }
  }

  /** A library study's line values at a candle (the newest when `index` is undefined), in its lines' order. */
  public studyValuesAt(studyId: string, index?: number): Array<number | undefined> {
    const entry = this.#studyIds.get(studyId)
    if (!entry || this.#deps.isDisposed()) return []
    const at = index ?? this.#deps.chart.getDataList().length - 1
    const indicator = this.#deps.chart.getIndicators({ id: entry.indicatorId })[0] as
      { result?: Array<Record<string, number | undefined>> } | undefined
    const row = indicator?.result?.[at]
    return STUDIES[entry.type].lines.map((line) => row?.[line.key])
  }

  /** VWAP lines sit on the price pane. An index has no traded volume, so there is nothing to average. */
  public applyVwap(kind: 'vwap' | 'qvwap', visible: boolean, anchor: (typeof VWAP_ANCHORS)[number]): void {
    const chart = this.#deps.chart
    const id = this.#vwapIds.get(kind)
    if (!visible || this.#deps.market.kind === 'dominance') {
      if (id) {
        chart.removeIndicator({ id })
        this.#vwapIds.delete(kind)
      }
      return
    }
    const styles = { lines: [{ color: VWAP_COLORS[kind], size: 1.5 }] }
    const calcParams = [VWAP_ANCHORS.indexOf(anchor)]
    const name = kind === 'vwap' ? VWAP_INDICATOR_NAME : QVWAP_INDICATOR_NAME
    if (id) {
      chart.overrideIndicator({ id, name, calcParams, styles })
      return
    }
    const created = chart.createIndicator(
      { name, paneId: 'candle_pane', calcParams, styles, createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP },
      true,
    )
    if (created) this.#vwapIds.set(kind, created)
  }

  /** Simple or exponential moving averages on the price pane (one indicator per kind, one line per period). */
  public applyMovingAverage(kind: MovingAverageKind, settings: MovingAverageSettings): void {
    const chart = this.#deps.chart
    const id = this.#movingAverageIds.get(kind)
    if (!movingAverageActive(settings)) {
      if (id) {
        chart.removeIndicator({ id })
        this.#movingAverageIds.delete(kind)
      }
      return
    }

    const calcParams = [...settings.periods]
    const colors = MOVING_AVERAGE_COLORS[kind]
    const styles = {
      lines: calcParams.map((_, index) => ({ color: colors[index % colors.length], size: 1.5 })),
    }
    if (id) {
      chart.overrideIndicator({ id, name: kind === 'sma' ? 'MA' : 'EMA', calcParams, styles })
      return
    }
    const created = chart.createIndicator(
      {
        name: kind === 'sma' ? 'MA' : 'EMA',
        paneId: 'candle_pane',
        calcParams,
        styles,
        createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP,
      },
      true,
    )
    if (created) this.#movingAverageIds.set(kind, created)
  }

  /** Dominance indicators, each in its own pane below the candles. */
  public applyDominance(wanted: Readonly<Record<DominanceKey, boolean>>): void {
    const chart = this.#deps.chart
    for (const key of DOMINANCE_KEYS) {
      const id = this.#dominanceIds.get(key)
      if (!wanted[key]) {
        if (id) {
          chart.removeIndicator({ id })
          this.#dominanceIds.delete(key)
        }
        continue
      }
      if (id) continue

      const paneId = `trade-horizon:dominance:${key}`
      const created = chart.createIndicator({
        name: dominanceIndicatorName(key),
        paneId,
        styles: { lines: [{ color: DOMINANCE_COLORS[key], size: 1.5 }] },
      })
      if (created) {
        this.#dominanceIds.set(key, created)
        chart.setPaneOptions({ id: paneId, height: 112, minHeight: 64 })
      }
    }
    this.syncDominanceData()
  }

  /** Feeds the dominance panes rows for the current timeframe (loading them when needed) and keeps them refreshed. */
  public syncDominanceData(): void {
    if (this.#dominanceIds.size === 0) {
      this.#dominanceEpoch += 1
      if (this.#dominanceIndicatorPoll !== undefined) {
        globalThis.clearInterval(this.#dominanceIndicatorPoll)
        this.#dominanceIndicatorPoll = undefined
      }
      const runtimeState = this.#deps.runtimeState()
      if (runtimeState.dominance && runtimeState.dominance !== 'idle') {
        this.#deps.patchRuntime({ dominance: 'idle', dominanceError: null })
      }
      return
    }

    this.#dominanceIndicatorPoll ??= globalThis.setInterval(() => this.#refreshDominanceRows(false), DOMINANCE_INDICATOR_REFRESH_MS)
    if (this.#dominanceRows && this.#dominanceRowsInterval === this.#deps.interval()) {
      this.#pushDominanceRows(this.#dominanceRows)
      return
    }
    this.#refreshDominanceRows(true)
  }

  #refreshDominanceRows(showProgress: boolean): void {
    const epoch = ++this.#dominanceEpoch
    const interval = this.#deps.interval()
    if (showProgress) this.#deps.patchRuntime({ dominance: 'loading', dominanceError: null })

    loadDominanceWeights()
      .then((weights) => fetchDominancePage(weights, interval))
      .then((page) => {
        if (this.#deps.isDisposed() || epoch !== this.#dominanceEpoch) return
        this.#dominanceRows = page.rows
        this.#dominanceRowsInterval = interval
        this.#pushDominanceRows(page.rows)
        this.#deps.patchRuntime({ dominance: 'ready', dominanceError: null })
      })
      .catch((error: unknown) => {
        if (this.#deps.isDisposed() || epoch !== this.#dominanceEpoch || !showProgress) return
        this.#deps.patchRuntime({ dominance: 'error', dominanceError: errorMessage(error) })
      })
  }

  #pushDominanceRows(rows: readonly DominanceRow[]): void {
    for (const [key, id] of this.#dominanceIds) {
      this.#deps.chart.overrideIndicator({ id, name: dominanceIndicatorName(key), calc: dominanceCalc(key, rows) })
    }
  }

  /** Stops refreshing the dominance panes. */
  public dispose(): void {
    if (this.#dominanceIndicatorPoll !== undefined) globalThis.clearInterval(this.#dominanceIndicatorPoll)
  }
}
