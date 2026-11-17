import type { Chart, Coordinate } from 'klinecharts'
import {
  broadcastCrosshair,
  broadcastTime,
  followerBarSpace,
  joinSyncGroup,
  type SyncMember,
  type SyncedCrosshair,
  type SyncedTime,
} from '../chartSync'
import { scrollToCentre } from './paneGeometry'
import type { PatchRuntime } from './types'

/** Runs chart moves the controller makes itself without them counting as the user navigating. */
export class NavigationGuard {
  #ignoreNavigationEvents = false
  #navigationTimer?: ReturnType<typeof globalThis.setTimeout>

  /** True for a short while after a programmatic move (its scroll and zoom events are not the user's). */
  public get ignoring(): boolean {
    return this.#ignoreNavigationEvents
  }

  /** Runs `action` and ignores the navigation events it causes for 300 ms. */
  public run(action: () => void): void {
    this.#ignoreNavigationEvents = true
    action()
    if (this.#navigationTimer !== undefined) globalThis.clearTimeout(this.#navigationTimer)
    this.#navigationTimer = globalThis.setTimeout(() => {
      this.#ignoreNavigationEvents = false
      this.#navigationTimer = undefined
    }, 300)
  }

  /** Cancels the pending timer. */
  public dispose(): void {
    if (this.#navigationTimer !== undefined) globalThis.clearTimeout(this.#navigationTimer)
  }
}

/** What split-view sync needs from the controller. */
export interface ChartSyncLinkDeps {
  readonly chart: Chart
  readonly host: HTMLElement
  /** This chart's market symbol. */
  readonly symbol: string
  readonly isDisposed: () => boolean
  /** True while a bar replay runs (time sync is ignored then). */
  readonly isReplaying: () => boolean
  /** Length of one candle of the current timeframe. */
  readonly intervalMs: () => number
  readonly navigation: NavigationGuard
  readonly patchRuntime: PatchRuntime
}

/** Split-view sync: the group is the tab; crosshair and time are passed to its other charts. */
export class ChartSyncLink {
  readonly #deps: ChartSyncLinkDeps
  #syncGroup?: string
  #syncOptions = { crosshair: false, time: false }
  #leaveSync?: () => void
  #applyingSync = false
  #timeSyncFrame?: number
  readonly #syncMember: SyncMember = {
    syncedCrosshair: (state) => this.#applySyncedCrosshair(state),
    syncedTime: (state) => this.#applySyncedTime(state),
  }

  /** Starts outside any group. */
  public constructor(deps: ChartSyncLinkDeps) {
    this.#deps = deps
  }

  /** True when this chart passes its crosshair to the rest of its group. */
  public get sharesCrosshair(): boolean {
    return !!this.#syncGroup && this.#syncOptions.crosshair
  }

  /** Joins (or leaves) the split-view group of this chart's tab. */
  public setSync(group: string | undefined, options: { crosshair: boolean; time: boolean }): void {
    this.#syncOptions = options
    if (group !== this.#syncGroup) {
      this.#leaveSync?.()
      this.#leaveSync = group ? joinSyncGroup(group, this.#syncMember) : undefined
      this.#syncGroup = group
    }
    if (!options.crosshair) this.#deps.chart.executeAction('onCrosshairChange', null as never)
  }

  /** Passes this chart's crosshair (or its absence) to the other charts of the group; only call when `sharesCrosshair`. */
  public broadcastCrosshair(state: SyncedCrosshair | null): void {
    if (this.#syncGroup) broadcastCrosshair(this.#syncGroup, this.#syncMember, state)
  }

  /** At most one time message per frame while the user drags or zooms. */
  public queueTimeSync(): void {
    if (!this.#syncGroup || !this.#syncOptions.time || this.#applyingSync || this.#timeSyncFrame !== undefined) return
    this.#timeSyncFrame = requestAnimationFrame(() => {
      this.#timeSyncFrame = undefined
      if (this.#deps.isDisposed() || !this.#syncGroup) return
      const chart = this.#deps.chart
      const range = chart.getVisibleRange()
      const data = chart.getDataList()
      const centre = data[Math.max(0, Math.min(data.length - 1, Math.round((range.from + range.to) / 2)))]
      if (!centre) return
      broadcastTime(this.#syncGroup, this.#syncMember, {
        centreTimeMs: centre.timestamp,
        pixelsPerMs: chart.getBarSpace().bar / this.#deps.intervalMs(),
      })
    })
  }

  #applySyncedTime(state: SyncedTime): void {
    const chart = this.#deps.chart
    if (this.#deps.isDisposed() || !this.#syncOptions.time || this.#deps.isReplaying() || chart.getDataList().length === 0) return
    this.#applyingSync = true
    try {
      this.#deps.navigation.run(() => {
        chart.setBarSpace(followerBarSpace(state, this.#deps.intervalMs()))
        scrollToCentre(chart, this.#deps.host, state.centreTimeMs)
      })
      this.#deps.patchRuntime({ followingLive: false })
    } finally {
      this.#applyingSync = false
    }
  }

  #applySyncedCrosshair(state: SyncedCrosshair | null): void {
    const chart = this.#deps.chart
    if (this.#deps.isDisposed() || !this.#syncOptions.crosshair) return
    if (!state) {
      chart.executeAction('onCrosshairChange', null as never)
      return
    }
    const data = chart.getDataList()
    if (data.length === 0) return
    // The candle of this timeframe that contains the moment (the last one opening at or before it).
    let low = 0
    let high = data.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (data[middle].timestamp <= state.timestamp) low = middle
      else high = middle - 1
    }
    const x = (chart.convertToPixel({ dataIndex: low }, { paneId: 'candle_pane' }) as Partial<Coordinate>).x
    if (x === undefined) return
    const sameSymbol = state.symbol === this.#deps.symbol
    const y = sameSymbol ? (chart.convertToPixel({ value: state.price }, { paneId: 'candle_pane' }) as Partial<Coordinate>).y : undefined
    // Off-screen y: only the vertical line shows on charts of other symbols.
    chart.executeAction('onCrosshairChange', { x, y: y ?? -1000, paneId: 'candle_pane' } as never)
  }

  /** Leaves the group and drops a queued time message. */
  public dispose(): void {
    this.#leaveSync?.()
    this.#leaveSync = undefined
    if (this.#timeSyncFrame !== undefined) cancelAnimationFrame(this.#timeSyncFrame)
  }
}
