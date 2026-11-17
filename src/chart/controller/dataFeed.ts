import type { Chart, DataLoader, KLineData } from 'klinecharts'
import { exchangeSymbol } from '../../market/binance/futures'
import { fetchMarketKlines, subscribeMarketKlines } from '../../market/sources'
import {
  LatestBinanceKlinesLoader,
  StaleMarketDataRequestError,
  type Candle,
  type FetchBinanceKlinesOptions,
  type KlineStreamStatus,
  type MarketInterval,
} from '../../market'
import { MAX_CACHE_GAP_BARS, loadCachedBars, saveCachedBars } from '../candleCache'
import { dominanceCandles, fetchDominancePage, loadDominanceWeights } from '../dominance'
import { periodToInterval } from '../intervals'
import type { CryptoMarket } from '../markets'
import { candleToKLineData } from '../model'
import { candleToQuote, type ChartRuntimeState } from '../types'
import {
  HISTORY_PAGE_SIZE,
  MAX_VIEWPORT_BACKFILL_PAGES,
  VIEWPORT_BACKFILL_MARGIN_BARS,
  barToQuote,
  errorMessage,
  intervalDurationMs,
  isAbortError,
} from './helpers'
import type { ReplayController } from './replay'
import type { PatchRuntime, PendingViewport } from './types'

/** Coming back after this long, replace the live connection even if it looks open. */
const RESUME_RECONNECT_AFTER_MS = 10_000
/** A dropped live connection is only shown to the user if it has not recovered after this long. */
const STATUS_GRACE_MS = 1500
const DOMINANCE_POLL_MS = 20_000

/** What the candle feed needs from the controller. */
export interface DataFeedDeps {
  readonly chart: Chart
  readonly market: CryptoMarket
  /** The chart's current timeframe. */
  readonly interval: () => MarketInterval
  readonly isDisposed: () => boolean
  readonly runtimeState: () => ChartRuntimeState
  readonly patchRuntime: PatchRuntime
  readonly replay: ReplayController
  /** Where the chart should land once the first candles of a new timeframe have loaded. */
  readonly pendingViewport: () => PendingViewport | undefined
  /** Runs after the first candles of a load are on the chart (restores the viewport, syncs drawings). */
  readonly afterInitialData: () => void
}

/**
 * The chart's candles: history pages (from the local cache first, then the exchange), the live stream with its
 * reconnect backfill, dominance index bars and polling, replay bars from memory, and saving the candles when the page is left.
 */
export class DataFeed {
  readonly #deps: DataFeedDeps
  readonly #historyLoader = new LatestBinanceKlinesLoader((options) => this.#fetchKlines(options))
  #stream?: { stop(): void; nudge?(force?: boolean): void }
  #hiddenAtMs?: number
  #statusTimer?: ReturnType<typeof globalThis.setTimeout>
  /** True when the chart was painted from the local candle cache and still has to catch up with the exchange. */
  #catchUpPending = false
  #dataEpoch = 0
  #dominancePoll?: ReturnType<typeof globalThis.setInterval>
  #dominanceReference?: Record<string, number>

  /** Creates the feed; the controller hands `dataLoader` to the chart. */
  public constructor(deps: DataFeedDeps) {
    this.#deps = deps
  }

  #intervalMs(): number {
    return intervalDurationMs(this.#deps.interval())
  }

  /** The klinecharts data loader of this chart. */
  public readonly dataLoader: DataLoader = {
    getBars: async ({ type, timestamp, period, callback }) => {
      const interval = periodToInterval(period)
      if (!interval) {
        callback([], false)
        this.#deps.patchRuntime({
          connection: 'error',
          error: `Unsupported chart period ${period.span} ${period.type}`,
        })
        return
      }

      // During a replay the chart is fed from memory; only older history still comes from the network.
      const replay = this.#deps.replay.session
      if (replay && type !== 'forward') {
        if (type !== 'init') {
          callback([], false)
          return
        }
        const shown = replay.bars.slice(0, replay.cursor)
        callback(shown, { forward: true, backward: false })
        const latest = shown.at(-1)
        this.#deps.patchRuntime({ interval, connection: 'live', quote: latest ? barToQuote(latest) : null, error: null })
        this.#deps.replay.publish()
        this.#deps.afterInitialData()
        return
      }

      if (this.#deps.market.kind === 'dominance') {
        await this.#loadDominanceBars(type, interval, timestamp, callback)
        return
      }

      const epoch = this.#dataEpoch

      // Reopening a chart (or the app) paints from the local cache at once; the live feed then fills in what is new.
      if (type === 'init' && !this.#deps.pendingViewport() && !this.#deps.replay.pending) {
        const cached = await loadCachedBars(this.#deps.market.marketId, interval)
        if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return
        const newest = cached?.at(-1)
        if (cached && newest && cached.length >= 200 && Date.now() - newest.timestamp < MAX_CACHE_GAP_BARS * this.#intervalMs()) {
          this.#catchUpPending = true
          callback(cached, { forward: true, backward: false })
          this.#deps.patchRuntime({ interval, connection: 'connecting', quote: barToQuote(newest), error: null })
          this.#deps.afterInitialData()
          return
        }
      }

      if (type === 'init') {
        this.#deps.patchRuntime({ interval, connection: 'loading', error: null })
      }

      try {
        const result = await this.#historyLoader.load({
          symbol: exchangeSymbol(this.#deps.market.symbol),
          interval,
          limit: HISTORY_PAGE_SIZE,
          ...(type === 'forward' && timestamp !== null ? { endTimeMs: Math.max(0, timestamp - 1) } : {}),
          ...(type === 'backward' && timestamp !== null ? { startTimeMs: timestamp + 1 } : {}),
        })

        if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return

        let bars = result.candles.map(candleToKLineData)
        let hasPage = bars.length === HISTORY_PAGE_SIZE

        // After a timeframe switch, fetch enough older candles to show the same moment again.
        const pending = type === 'init' ? this.#deps.pendingViewport() : undefined
        const pendingReplay = type === 'init' ? this.#deps.replay.pending : undefined
        const targetReplayTime = pendingReplay?.targetTimeMs
        const targetCenterTime = pending?.followingLive ? undefined : pending?.centerTimeMs
        const backfillTarget =
          targetReplayTime !== undefined
            ? targetCenterTime !== undefined
              ? Math.min(targetReplayTime, targetCenterTime)
              : targetReplayTime
            : targetCenterTime

        if (backfillTarget !== undefined) {
          const neededFrom = backfillTarget - VIEWPORT_BACKFILL_MARGIN_BARS * this.#intervalMs()
          for (
            let page = 0;
            hasPage && bars.length > 0 && bars[0].timestamp > neededFrom && page < MAX_VIEWPORT_BACKFILL_PAGES;
            page += 1
          ) {
            const older = await this.#fetchKlines({
              symbol: exchangeSymbol(this.#deps.market.symbol),
              interval,
              limit: HISTORY_PAGE_SIZE,
              endTimeMs: Math.max(0, bars[0].timestamp - 1),
            })
            if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return
            bars = [...older.map(candleToKLineData), ...bars]
            hasPage = older.length === HISTORY_PAGE_SIZE
          }
          if (pending && pending.centerTimeMs !== undefined && bars.length > 0 && bars[0].timestamp > pending.centerTimeMs) {
            pending.followingLive = true
          }
        }

        if (type === 'init' && this.#deps.replay.pending) {
          const resumed = this.#deps.replay.activatePending(bars)!
          callback(resumed.shown, { forward: hasPage, backward: false })
          const latest = resumed.shown.at(-1)
          this.#deps.patchRuntime({
            interval,
            connection: 'live',
            quote: latest ? barToQuote(latest) : null,
            error: null,
          })
          saveCachedBars(this.#deps.market.marketId, interval, bars)
          this.#deps.replay.publish()
          this.#deps.afterInitialData()
          if (resumed.wasPlaying) {
            this.#deps.replay.setPlaying(true)
          }
          return
        }

        callback(bars, {
          forward: type === 'backward' ? false : hasPage,
          backward: type === 'backward' ? hasPage : false,
        })

        if (type === 'init') {
          const latest = result.candles.at(-1)
          this.#deps.patchRuntime({
            connection: 'connecting',
            quote: latest ? candleToQuote(latest) : null,
            error: latest ? null : 'No candles were returned for this market.',
          })
          saveCachedBars(this.#deps.market.marketId, interval, bars)
          this.#deps.replay.publish()
          this.#deps.afterInitialData()
        }
      } catch (error) {
        if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || error instanceof StaleMarketDataRequestError || isAbortError(error)) {
          return
        }

        callback([], false)
        this.#deps.patchRuntime({ connection: 'error', error: errorMessage(error) })
      }
    },

    subscribeBar: ({ period, callback }) => {
      const interval = periodToInterval(period)
      if (!interval || interval !== this.#deps.interval() || this.#deps.isDisposed()) return
      if (this.#deps.replay.session) {
        this.#deps.replay.setPush(callback)
        return
      }
      if (this.#deps.market.kind === 'dominance') {
        this.#startDominancePolling(interval, callback)
        return
      }

      this.#stream?.stop()
      const epoch = this.#dataEpoch
      let hasOpened = false
      if (this.#catchUpPending) {
        this.#catchUpPending = false
        void this.#backfillAfterReconnect(interval, epoch, callback)
      }

      const streamOptions = {
        symbol: exchangeSymbol(this.#deps.market.symbol),
        interval,
        onCandle: (candle: Candle) => {
          if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return
          callback(candleToKLineData(candle))
          this.#deps.patchRuntime({ quote: candleToQuote(candle), error: null })
        },
        onStatus: (status: KlineStreamStatus) => {
          if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return
          this.#handleStreamStatus(status)
          if (status.state === 'open') {
            if (hasOpened) void this.#backfillAfterReconnect(interval, epoch, callback)
            hasOpened = true
          }
        },
        onError: (error: Error) => {
          if (this.#deps.isDisposed() || epoch !== this.#dataEpoch) return
          this.#deps.patchRuntime({ error: error.message })
        },
      }
      this.#stream = subscribeMarketKlines(this.#deps.market, streamOptions)
    },

    unsubscribeBar: () => {
      this.#stream?.stop()
      this.#stream = undefined
      this.stopDominancePolling()
    },
  }

  /** Before a timeframe switch: drops in-flight history, the live stream and polling, and outdates pending responses. */
  public cancelForIntervalChange(): void {
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.stopDominancePolling()
    this.#dataEpoch += 1
  }

  /** Loads the chart's candles again after an error (or to reach a far-back date). */
  public retry(): void {
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.#dataEpoch += 1
    this.#deps.patchRuntime({ connection: 'loading', error: null })
    this.#deps.chart.resetData()
  }

  /** Drops the chart's candles and loads them again (entering or leaving replay). */
  public reload(): void {
    this.#historyLoader.cancel()
    this.#stream?.stop()
    this.#stream = undefined
    this.stopDominancePolling()
    this.#dataEpoch += 1
    this.#deps.chart.resetData()
  }

  /** Cancels history loading and stops the live stream for good. */
  public dispose(): void {
    this.#historyLoader.cancel()
    this.#stream?.stop()
  }

  /** Cancels a pending connection-status update. */
  public clearStatusTimer(): void {
    globalThis.clearTimeout(this.#statusTimer)
  }

  /** Leaving the page saves the chart; coming back replaces a live connection that died in the background. */
  public readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.#hiddenAtMs = Date.now()
      this.#persistBars()
      return
    }
    const away = this.#hiddenAtMs === undefined ? 0 : Date.now() - this.#hiddenAtMs
    this.#hiddenAtMs = undefined
    this.#stream?.nudge?.(away > RESUME_RECONNECT_AFTER_MS)
  }

  /** Saves the candles when the page goes away. */
  public readonly handlePageHide = (): void => this.#persistBars()
  /** Back online (or back from the page cache): reconnect the live stream now. */
  public readonly handleResumeNow = (): void => {
    this.#stream?.nudge?.(true)
  }

  #persistBars(): void {
    if (this.#deps.isDisposed() || this.#deps.replay.session || this.#deps.replay.pending || this.#deps.market.kind === 'dominance') return
    const bars = this.#deps.chart.getDataList()
    if (bars.length >= 50) saveCachedBars(this.#deps.market.marketId, this.#deps.interval(), bars)
  }

  #handleStreamStatus(status: KlineStreamStatus): void {
    globalThis.clearTimeout(this.#statusTimer)
    if (status.state === 'open') {
      this.#deps.patchRuntime({ connection: 'live', error: null })
    } else if (status.state === 'connecting' || status.state === 'reconnecting') {
      const connection = status.state
      // A connection that was live usually recovers within a moment (for example right after you return to the
      // tab), so only tell the user if it has not come back after a short grace period.
      if (this.#deps.runtimeState().connection === 'live') {
        this.#statusTimer = globalThis.setTimeout(() => {
          if (!this.#deps.isDisposed()) this.#deps.patchRuntime({ connection })
        }, STATUS_GRACE_MS)
      } else {
        this.#deps.patchRuntime({ connection })
      }
    }
  }

  /** Candle history from the exchange this market trades on. */
  #fetchKlines(options: FetchBinanceKlinesOptions): Promise<Candle[]> {
    return fetchMarketKlines(this.#deps.market, options)
  }

  async #backfillAfterReconnect(interval: MarketInterval, epoch: number, callback: (data: KLineData) => void): Promise<void> {
    try {
      const candles = await this.#fetchKlines({
        symbol: exchangeSymbol(this.#deps.market.symbol),
        interval,
        limit: HISTORY_PAGE_SIZE,
      })
      if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return

      const latestTimestamp = this.#deps.chart.getDataList().at(-1)?.timestamp ?? 0
      for (const candle of candles) {
        if (candle.openTimeMs >= latestTimestamp) callback(candleToKLineData(candle))
      }

      const latest = candles.at(-1)
      if (latest) this.#deps.patchRuntime({ quote: candleToQuote(latest), error: null })
    } catch (error) {
      if (!this.#deps.isDisposed() && epoch === this.#dataEpoch) {
        this.#deps.patchRuntime({ error: errorMessage(error) })
      }
    }
  }

  async #loadDominanceBars(
    type: string,
    interval: MarketInterval,
    timestamp: number | null,
    callback: Parameters<DataLoader['getBars']>[0]['callback'],
  ): Promise<void> {
    const key = this.#deps.market.dominanceKey
    if (!key || type === 'backward' || (type === 'forward' && timestamp === null)) {
      callback([], false)
      return
    }

    const epoch = this.#dataEpoch
    if (type === 'init') this.#deps.patchRuntime({ interval, connection: 'loading', error: null })

    try {
      const weights = await loadDominanceWeights()
      const page = await fetchDominancePage(
        weights,
        interval,
        type === 'forward' && timestamp !== null ? { endTimeMs: Math.max(0, timestamp - 1), reference: this.#dominanceReference } : {},
      )
      if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return

      if (type === 'init') this.#dominanceReference = page.reference
      const bars = dominanceCandles(page.rows, key)

      if (type === 'init' && this.#deps.replay.pending) {
        const resumed = this.#deps.replay.activatePending(bars)!
        callback(resumed.shown, { forward: page.hasMore, backward: false })
        const latest = resumed.shown.at(-1)
        this.#deps.patchRuntime({
          connection: latest ? 'live' : 'error',
          quote: latest ? barToQuote(latest) : null,
          error: latest ? null : 'No dominance data was returned.',
        })
        this.#deps.replay.publish()
        this.#deps.afterInitialData()
        if (resumed.wasPlaying) {
          this.#deps.replay.setPlaying(true)
        }
        return
      }

      callback(bars, { forward: page.hasMore, backward: false })

      if (type === 'init') {
        const latest = bars.at(-1)
        this.#deps.patchRuntime({
          connection: latest ? 'live' : 'error',
          quote: latest ? barToQuote(latest) : null,
          error: latest ? null : 'No dominance data was returned.',
        })
        this.#deps.replay.publish()
        this.#deps.afterInitialData()
      }
    } catch (error) {
      if (this.#deps.isDisposed() || epoch !== this.#dataEpoch) return
      callback([], false)
      if (type === 'init') this.#deps.patchRuntime({ connection: 'error', quote: null, error: errorMessage(error) })
    }
  }

  #startDominancePolling(interval: MarketInterval, callback: (data: KLineData) => void): void {
    this.stopDominancePolling()
    const key = this.#deps.market.dominanceKey
    if (!key) return
    const epoch = this.#dataEpoch

    this.#dominancePoll = globalThis.setInterval(() => {
      void loadDominanceWeights()
        .then((weights) => fetchDominancePage(weights, interval, { limit: 2, reference: this.#dominanceReference }))
        .then((page) => {
          if (this.#deps.isDisposed() || epoch !== this.#dataEpoch || interval !== this.#deps.interval()) return
          const lastTimestamp = this.#deps.chart.getDataList().at(-1)?.timestamp ?? 0
          let latest: KLineData | undefined
          for (const bar of dominanceCandles(page.rows, key)) {
            if (bar.timestamp < lastTimestamp) continue
            callback(bar)
            latest = bar
          }
          if (latest) this.#deps.patchRuntime({ quote: barToQuote(latest), connection: 'live', error: null })
        })
        .catch(() => {
          // A missed poll is harmless; the next tick catches up.
        })
    }, DOMINANCE_POLL_MS)
  }

  /** Stops polling the dominance index for new bars. */
  public stopDominancePolling(): void {
    if (this.#dominancePoll === undefined) return
    globalThis.clearInterval(this.#dominancePoll)
    this.#dominancePoll = undefined
  }
}
