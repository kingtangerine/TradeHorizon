import type { KLineData } from 'klinecharts'

// The last candles of every chart you looked at, kept in the browser (IndexedDB). When a page is reloaded, for
// example because the phone discarded the tab while you were in another app, the chart paints from here at once
// and quietly catches up with the exchange, instead of showing a loading screen.

const DB_NAME = 'trade-horizon-cache'
const STORE = 'candles'
const MAX_SERIES = 40
const MAX_BARS = 1000
/** A cached series is only used when the newest cached candle is at most this many candles old. */
export const MAX_CACHE_GAP_BARS = 900

type Row = [timestamp: number, open: number, high: number, low: number, close: number, volume: number]

interface Entry {
  readonly key: string
  readonly savedAtMs: number
  readonly bars: readonly Row[]
}

const keyFor = (marketId: string, interval: string) => `${marketId}|${interval}`

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'key' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Cached candles for a chart, or null. Never throws: a broken cache just means a normal load. */
export async function loadCachedBars(marketId: string, interval: string): Promise<KLineData[] | null> {
  try {
    const db = await openDb()
    const entry = await wrap(db.transaction(STORE).objectStore(STORE).get(keyFor(marketId, interval))) as Entry | undefined
    db.close()
    if (!entry || !Array.isArray(entry.bars) || entry.bars.length === 0) return null
    return entry.bars.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }))
  } catch {
    return null
  }
}

/** Saves the newest candles of a chart. Fire and forget. */
export function saveCachedBars(marketId: string, interval: string, bars: readonly KLineData[]): void {
  if (bars.length === 0) return
  const rows: Row[] = bars.slice(-MAX_BARS).map((bar) => [bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0])
  void (async () => {
    try {
      const db = await openDb()
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      store.put({ key: keyFor(marketId, interval), savedAtMs: Date.now(), bars: rows } satisfies Entry)
      // Keep only the most recently saved series.
      const all = await wrap(store.getAll()) as Entry[]
      if (all.length > MAX_SERIES) {
        for (const stale of all.sort((a, b) => a.savedAtMs - b.savedAtMs).slice(0, all.length - MAX_SERIES)) store.delete(stale.key)
      }
      db.close()
    } catch {
      // Caching is an optimisation only.
    }
  })()
}
