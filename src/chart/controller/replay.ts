import type { Chart, KLineData } from 'klinecharts'
import type { MarketInterval } from '../../market'
import { DEFAULT_REPLAY_SPEED_MS, replayStartCursor, replayTransitionCursor } from '../replay'
import { barToQuote } from './helpers'
import type { PatchRuntime } from './types'

/** A running bar replay. */
export interface ReplaySession {
  /** Every bar that was loaded when the replay began; the chart shows the first `cursor` of them. */
  bars: KLineData[]
  cursor: number
  speedMs: number
  push?: (bar: KLineData) => void
  timer?: ReturnType<typeof globalThis.setInterval>
}

/** A replay carried over a timeframe switch, resumed once the new timeframe's candles have loaded. */
export interface PendingReplay {
  targetTimeMs: number
  speedMs: number
  wasPlaying: boolean
  wasPicking: boolean
}

/** What bar replay needs from the controller. */
export interface ReplayDeps {
  readonly host: HTMLElement
  readonly chart: Chart
  readonly isDisposed: () => boolean
  readonly patchRuntime: PatchRuntime
  /** True when the runtime state currently reports a replay. */
  readonly hasRuntimeReplay: () => boolean
  /** Drops the chart's candles and loads them again (the data loader then feeds the replay). */
  readonly reloadData: () => void
}

/** Bar replay: picking the start bar, stepping and playing through the loaded candles, and carrying it over timeframe switches. */
export class ReplayController {
  readonly #deps: ReplayDeps
  #replay?: ReplaySession
  #pendingReplay?: PendingReplay
  #replayPicking = false

  /** Starts with no replay. */
  public constructor(deps: ReplayDeps) {
    this.#deps = deps
  }

  /** The running replay, if any. */
  public get session(): ReplaySession | undefined {
    return this.#replay
  }

  /** The replay waiting for a new timeframe's candles, if any. */
  public get pending(): PendingReplay | undefined {
    return this.#pendingReplay
  }

  /** True while the next click on the chart chooses the bar to rewind to. */
  public get picking(): boolean {
    return this.#replayPicking
  }

  /** Arms bar replay: the next click on the chart chooses the bar to rewind to. */
  public startSelection(): void {
    this.#stopReplayTimer()
    this.#replayPicking = true
    this.#deps.host.classList.add('replay-picking')
    this.publish()
  }

  /** Disarms the bar picker. */
  public cancelSelection(): void {
    if (!this.#replayPicking) return
    this.#replayPicking = false
    if (this.#pendingReplay) this.#pendingReplay.wasPicking = false
    this.#deps.host.classList.remove('replay-picking')
    this.publish()
  }

  /** Shows the next bar of the replay. */
  public step(): void {
    const replay = this.#replay
    if (!replay?.push || this.#deps.isDisposed()) return
    if (replay.cursor < replay.bars.length) {
      const bar = replay.bars[replay.cursor]
      replay.cursor += 1
      replay.push(bar)
      this.#deps.patchRuntime({ quote: barToQuote(bar) })
    }
    if (replay.cursor >= replay.bars.length) this.#stopReplayTimer()
    this.publish()
  }

  /** Plays (or pauses) the replay at its speed. */
  public setPlaying(playing: boolean): void {
    const replay = this.#replay
    if (!replay) return
    this.#stopReplayTimer()
    if (playing && replay.cursor < replay.bars.length) {
      replay.timer = globalThis.setInterval(() => this.step(), replay.speedMs)
    }
    this.publish()
  }

  /** Milliseconds per replayed bar. */
  public setSpeed(speedMs: number): void {
    const replay = this.#replay
    if (!replay || !(speedMs > 0)) return
    const wasPlaying = replay.timer !== undefined
    replay.speedMs = speedMs
    this.setPlaying(wasPlaying)
  }

  /** Leaves replay and reloads live data. */
  public exit(): void {
    if (!this.#replay && !this.#replayPicking && !this.#pendingReplay) return
    const wasActive = !!this.#replay || !!this.#pendingReplay
    this.#clearReplay()
    if (wasActive) this.#deps.reloadData()
  }

  /** Starts the replay at the bar picked at `timestamp`. */
  public enter(timestamp: number): void {
    // Picking a new start while already replaying must rewind within the full original data.
    const bars = this.#replay?.bars ?? this.#deps.chart.getDataList().slice()
    const cursor = replayStartCursor(
      bars.map((bar) => bar.timestamp),
      timestamp,
    )
    if (cursor === null) return

    const speedMs = this.#replay?.speedMs ?? DEFAULT_REPLAY_SPEED_MS
    this.#stopReplayTimer()
    this.#replayPicking = false
    this.#deps.host.classList.remove('replay-picking')
    this.#replay = { bars, cursor, speedMs }
    this.#deps.reloadData()
  }

  /** Lets the data loader feed new replay bars to the chart. */
  public setPush(push: (bar: KLineData) => void): void {
    if (this.#replay) this.#replay.push = push
  }

  /**
   * Before a timeframe switch: keeps an active replay (or the bar picker) as pending at the same moment, or ends it, and
   * reports the new timeframe as loading.
   */
  public prepareIntervalChange(interval: MarketInterval): void {
    const targetTimeMs = this.#replay
      ? (this.#replay.bars[this.#replay.cursor - 1]?.timestamp ?? null)
      : (this.#pendingReplay?.targetTimeMs ?? null)
    const speedMs = this.#replay?.speedMs ?? this.#pendingReplay?.speedMs ?? DEFAULT_REPLAY_SPEED_MS
    const wasPlaying = this.#replay?.timer !== undefined || (this.#pendingReplay?.wasPlaying ?? false)
    const wasPicking = this.#replayPicking || (this.#pendingReplay?.wasPicking ?? false)

    if (targetTimeMs !== null) {
      this.#pendingReplay = { targetTimeMs, speedMs, wasPlaying, wasPicking }
      this.#stopReplayTimer()
      this.#replay = undefined
      this.#deps.patchRuntime({
        interval,
        connection: 'loading',
        error: null,
        replay: {
          status: wasPicking ? 'picking' : 'active',
          playing: false,
          speedMs,
          timeMs: targetTimeMs,
          atEnd: false,
        },
      })
    } else if (this.#replayPicking) {
      this.#deps.patchRuntime({
        interval,
        connection: 'loading',
        error: null,
        replay: {
          status: 'picking',
          playing: false,
          speedMs: DEFAULT_REPLAY_SPEED_MS,
          timeMs: null,
          atEnd: false,
        },
      })
    } else {
      this.#clearReplay()
      this.#deps.patchRuntime({ interval, connection: 'loading', error: null })
    }
  }

  /**
   * The new timeframe's candles have loaded: the pending replay becomes the running one at the same moment. Returns the
   * bars to show and whether it was playing; the caller feeds the chart, then publishes and resumes playing.
   */
  public activatePending(bars: KLineData[]): { shown: KLineData[]; wasPlaying: boolean } | undefined {
    const replayInfo = this.#pendingReplay
    if (!replayInfo) return undefined
    this.#pendingReplay = undefined
    const cursor = replayTransitionCursor(
      bars.map((b) => b.timestamp),
      replayInfo.targetTimeMs,
    )
    this.#replay = { bars, cursor, speedMs: replayInfo.speedMs }
    this.#replayPicking = replayInfo.wasPicking
    if (replayInfo.wasPicking) {
      this.#deps.host.classList.add('replay-picking')
    }
    const shown = bars.slice(0, cursor)
    return { shown, wasPlaying: replayInfo.wasPlaying }
  }

  #clearReplay(): void {
    this.#stopReplayTimer()
    this.#replay = undefined
    this.#pendingReplay = undefined
    this.#replayPicking = false
    this.#deps.host.classList.remove('replay-picking')
    if (this.#deps.hasRuntimeReplay()) this.#deps.patchRuntime({ replay: null })
  }

  /** Stops the play timer (the replay itself stays). */
  public stopTimer(): void {
    this.#stopReplayTimer()
  }

  #stopReplayTimer(): void {
    const replay = this.#replay
    if (replay?.timer === undefined) return
    globalThis.clearInterval(replay.timer)
    replay.timer = undefined
  }

  /** Reports the replay (or its absence) in the runtime state. */
  public publish(): void {
    const replay = this.#replay
    const pending = this.#pendingReplay
    this.#deps.patchRuntime({
      replay: replay
        ? {
            status: this.#replayPicking ? 'picking' : 'active',
            playing: replay.timer !== undefined,
            speedMs: replay.speedMs,
            timeMs: replay.bars[replay.cursor - 1]?.timestamp ?? null,
            atEnd: replay.cursor >= replay.bars.length,
          }
        : pending
          ? {
              status: this.#replayPicking ? 'picking' : 'active',
              playing: pending.wasPlaying,
              speedMs: pending.speedMs,
              timeMs: pending.targetTimeMs,
              atEnd: false,
            }
          : this.#replayPicking
            ? { status: 'picking', playing: false, speedMs: DEFAULT_REPLAY_SPEED_MS, timeMs: null, atEnd: false }
            : null,
    })
  }
}
