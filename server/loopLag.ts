// How long requests have to wait because the server is busy: a timer that should fire every 100 ms records how late
// it actually runs (the "event loop delay"). A few milliseconds is healthy; hundreds mean the server is not keeping up.
// Windows timers tick about every 15 ms, so expect around 15 ms there even when idle; Linux shows about 1 ms.

/** Event loop delay in ms: typical (p50), worst 1% (p99) and worst. */
export interface LoopLagStatus {
  p50: number
  p99: number
  max: number
}

export interface LoopLagOptions {
  intervalMs?: number
  windowMs?: number
  now?: () => number
}

export interface LoopLagMonitor {
  start(): void
  stop(): void
  status(): LoopLagStatus
  tick(): void
}

export function createLoopLagMonitor({
  intervalMs = 100,
  windowMs = 60_000,
  now = () => performance.now(),
}: LoopLagOptions = {}): LoopLagMonitor {
  const size = Math.ceil(windowMs / intervalMs)
  const samples = new Float64Array(size)
  let count = 0
  let next = 0
  let expected = now() + intervalMs
  let timer: NodeJS.Timeout | undefined

  function tick() {
    const at = now()
    samples[next] = Math.max(0, at - expected)
    next = (next + 1) % size
    count = Math.min(size, count + 1)
    expected = at + intervalMs
  }

  return {
    start() {
      expected = now() + intervalMs
      timer = setInterval(tick, intervalMs)
      timer.unref?.()
    },
    stop() {
      clearInterval(timer)
    },
    /** Delay in ms over the last minute: typical (p50), worst 1% (p99) and worst. */
    status() {
      if (count === 0) return { p50: 0, p99: 0, max: 0 }
      const sorted = Array.from(samples.subarray(0, count)).sort((a, b) => a - b)
      const pick = (p: number) => Math.round(sorted[Math.min(count - 1, Math.floor((count - 1) * p))])
      return { p50: pick(0.5), p99: pick(0.99), max: Math.round(sorted[count - 1]) }
    },
    tick, // for tests
  }
}
