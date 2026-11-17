// Split-view sync (TradingView's "Sync in layout"): the charts of one tab share their crosshair and their time
// position. Each chart controller joins its tab's group; what one chart's user does is passed to the others, which
// apply it without passing it on again. No React state is involved, so mouse moves stay cheap.

/** Crosshair position shared between synced charts; null when the pointer leaves the chart. */
export interface SyncedCrosshair {
  readonly timestamp: number
  /** Price under the pointer; only charts of the same symbol draw the horizontal line. */
  readonly price: number
  readonly symbol: string
}

/** Visible time window shared between synced charts, independent of each chart's timeframe. */
export interface SyncedTime {
  /** Moment in the middle of the chart. */
  readonly centreTimeMs: number
  /** Zoom as screen pixels per millisecond, so charts on other timeframes show the same span of time. */
  readonly pixelsPerMs: number
}

/** A chart in a sync group; receives what other members broadcast. */
export interface SyncMember {
  syncedCrosshair(state: SyncedCrosshair | null): void
  syncedTime(state: SyncedTime): void
}

const groups = new Map<string, Set<SyncMember>>()

/** Adds a chart to a sync group. Returns a function that removes it again (and drops the group once empty). */
export function joinSyncGroup(group: string, member: SyncMember): () => void {
  let members = groups.get(group)
  if (!members) {
    members = new Set()
    groups.set(group, members)
  }
  members.add(member)
  return () => {
    const current = groups.get(group)
    current?.delete(member)
    if (current?.size === 0) groups.delete(group)
  }
}

/** Passes a crosshair move (or null when it leaves) to every other member of the group. */
export function broadcastCrosshair(group: string, from: SyncMember, state: SyncedCrosshair | null): void {
  for (const member of groups.get(group) ?? []) if (member !== from) member.syncedCrosshair(state)
}

/** Passes a scroll or zoom to every other member of the group. */
export function broadcastTime(group: string, from: SyncMember, state: SyncedTime): void {
  for (const member of groups.get(group) ?? []) if (member !== from) member.syncedTime(state)
}

/** Bar width for a follower on another timeframe: same pixels per millisecond, within the chart's zoom limits. */
export function followerBarSpace(state: SyncedTime, intervalMs: number, min = 0.4, max = 60): number {
  return Math.min(max, Math.max(min, state.pixelsPerMs * intervalMs))
}
