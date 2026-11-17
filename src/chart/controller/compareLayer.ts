import type { Chart } from 'klinecharts'
import { exchangeSymbol } from '../../market/binance/futures'
import { fetchMarketKlines } from '../../market/sources'
import type { Candle, FetchBinanceKlinesOptions, MarketInterval } from '../../market'
import { COMPARE_COLORS, compareChange } from '../compare'
import { COMPARE_INDICATOR_NAME, type CompareSeries } from '../compareOverlay'
import { getMarket, type CryptoMarket } from '../markets'
import { HIDDEN_INDICATOR_TOOLTIP, HISTORY_PAGE_SIZE } from './helpers'
import { rangeWithCompareLines, type PriceAxisRange } from './priceRange'
import type { PatchRuntime } from './types'

/** What the compare lines need from the controller. */
export interface CompareLayerDeps {
  readonly chart: Chart
  readonly market: CryptoMarket
  /** The chart's current timeframe. */
  readonly interval: () => MarketInterval
  readonly isDisposed: () => boolean
  readonly patchRuntime: PatchRuntime
  /** Something on screen moved. */
  readonly emitView: () => void
  /** Asks the price axis to measure its range again. */
  readonly refreshPriceAxis: () => void
}

/** Compare symbols: their candles at this chart's timeframe, refreshed while shown, drawn as lines over the candles. */
export class CompareLayer {
  readonly #deps: CompareLayerDeps
  #compareSymbols: readonly string[] = []
  #compareSeries: CompareSeries[] = []
  #compareIndicatorId?: string
  #compareTimer?: ReturnType<typeof globalThis.setInterval>
  #compareEpoch = 0

  /** Starts with no compare symbols. */
  public constructor(deps: CompareLayerDeps) {
    this.#deps = deps
  }

  /** Shows these symbols (the chart's own symbol is skipped); loads them when the list changed. */
  public apply(symbols: readonly string[]): void {
    const wanted = symbols.filter((symbol) => symbol !== this.#deps.market.symbol)
    if (wanted.join(',') === this.#compareSymbols.join(',')) return
    this.#compareSymbols = wanted
    this.#compareSeries = this.#compareSeries.filter((item) => wanted.includes(item.symbol))
    void this.#loadCompare()
  }

  /** After a timeframe switch: loads the compare symbols again at the new timeframe. */
  public reloadForInterval(): void {
    if (this.#compareSymbols.length > 0) {
      this.#compareSeries = []
      void this.#loadCompare()
    }
  }

  /** Loads every compare symbol's recent candles, then keeps the newest ones fresh every 20 seconds. */
  async #loadCompare(): Promise<void> {
    const epoch = ++this.#compareEpoch
    if (this.#compareTimer !== undefined) {
      globalThis.clearInterval(this.#compareTimer)
      this.#compareTimer = undefined
    }
    if (this.#compareSymbols.length === 0) {
      this.#renderCompare()
      return
    }
    const interval = this.#deps.interval()
    const load = async (limit: number) => {
      const results = await Promise.all(
        this.#compareSymbols.map(async (symbol, index) => {
          const market = getMarket(symbol)
          if (market.symbol !== symbol || market.kind === 'dominance') return undefined
          try {
            const candles = await this.#fetchKlinesFor(market, { symbol: exchangeSymbol(market.symbol), interval, limit })
            const bars = candles
              .map((candle) => ({ timestamp: candle.openTimeMs, close: Number(candle.close) }))
              .filter((bar) => Number.isFinite(bar.close))
            const previous = this.#compareSeries.find((item) => item.symbol === symbol)?.bars ?? []
            const merged =
              limit < HISTORY_PAGE_SIZE && previous.length > 0
                ? [...previous.filter((bar) => bar.timestamp < (bars[0]?.timestamp ?? Infinity)), ...bars]
                : bars
            return { symbol, color: COMPARE_COLORS[index % COMPARE_COLORS.length], bars: merged }
          } catch {
            return this.#compareSeries.find((item) => item.symbol === symbol)
          }
        }),
      )
      if (this.#deps.isDisposed() || epoch !== this.#compareEpoch || interval !== this.#deps.interval()) return
      this.#compareSeries = results.filter((item): item is CompareSeries => item !== undefined)
      this.#renderCompare()
    }
    await load(HISTORY_PAGE_SIZE)
    if (this.#deps.isDisposed() || epoch !== this.#compareEpoch) return
    this.#compareTimer = globalThis.setInterval(() => void load(3), 20_000)
  }

  #renderCompare(): void {
    const chart = this.#deps.chart
    if (this.#compareSeries.length === 0) {
      if (this.#compareIndicatorId) chart.removeIndicator({ id: this.#compareIndicatorId })
      this.#compareIndicatorId = undefined
      this.#deps.patchRuntime({})
      return
    }
    const config = { name: COMPARE_INDICATOR_NAME, extendData: { series: this.#compareSeries } }
    if (this.#compareIndicatorId) chart.overrideIndicator({ id: this.#compareIndicatorId, ...config })
    else {
      const id = chart.createIndicator({ ...config, paneId: 'candle_pane', createTooltipDataSource: () => HIDDEN_INDICATOR_TOOLTIP }, true)
      if (id) this.#compareIndicatorId = id
    }
    // The price range includes the compare lines, so ask the axis to measure again.
    this.#deps.refreshPriceAxis()
    this.#deps.emitView()
  }

  /** Legend: each compare symbol's colour, last close and change over the visible candles. */
  public legend(): Array<{ symbol: string; color: string; last?: number; changePercent?: number }> {
    const data = this.#deps.chart.getDataList()
    const range = this.#deps.chart.getVisibleRange()
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(data.length, Math.ceil(range.to))
    return this.#compareSeries.map((item) => ({
      symbol: item.symbol,
      color: item.color,
      last: item.bars.at(-1)?.close,
      changePercent: compareChange(data, item.bars, from, to),
    }))
  }

  #fetchKlinesFor(market: CryptoMarket, options: FetchBinanceKlinesOptions): Promise<Candle[]> {
    return fetchMarketKlines(market, options)
  }

  /** The automatic price range widened to fit the visible part of the compare lines. */
  public readonly withCompareRange = <T extends PriceAxisRange>(range: T): T => {
    if (this.#compareSeries.length === 0) return range
    const data = this.#deps.chart.getDataList()
    const visible = this.#deps.chart.getVisibleRange()
    const from = Math.max(0, Math.floor(visible.from))
    const to = Math.min(data.length, Math.ceil(visible.to))
    return rangeWithCompareLines(range, this.#compareSeries, data, from, to)
  }

  /** Stops refreshing and ignores loads still in flight. */
  public dispose(): void {
    if (this.#compareTimer !== undefined) globalThis.clearInterval(this.#compareTimer)
    this.#compareEpoch += 1
  }
}
