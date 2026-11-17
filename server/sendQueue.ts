// A paced, retrying queue for outgoing notifications. When many alerts fire at once (BTC crossing a round number
// for hundreds of users), sending everything immediately gets most messages refused by Telegram (about 30 per second
// per bot, 1 per second per chat) or the push services. The queue sends at a safe pace, waits as long as a service
// asks after a "too many requests" answer, retries network and server errors with growing pauses, and gives up
// on errors that cannot succeed later (a chat that blocked the bot, an expired browser subscription).

/** Where the queue reports messages it gave up on (console fits). */
export type ServiceLog = Partial<Pick<Console, 'log' | 'warn'>>

/** Messages to the same key are paced apart (e.g. a Telegram chat id or a push endpoint). */
export type SendKey = string | number

/** What a failed send can tell the queue: `permanent` (never retry) and `retryAfterMs` (the service asked to wait). */
export interface SendError {
  readonly message?: string
  readonly permanent?: boolean
  readonly retryAfterMs?: number
}

/** How one queued message ended. */
export interface SendResult { readonly ok: boolean, readonly attempts: number, readonly error?: string }

export interface SendQueueOptions {
  readonly name: string
  readonly perSecond?: number
  readonly perKeyGapMs?: number
  readonly maxAttempts?: number
  readonly maxPending?: number
  readonly log?: ServiceLog
  readonly now?: () => number
}

export interface SendQueueStatus {
  readonly pending: number
  readonly sent: number
  readonly retried: number
  readonly failed: number
  readonly dropped: number
  readonly pausedForSec: number
  readonly lastError: string | null
}

export interface SendQueue {
  enqueue(key: SendKey, run: () => Promise<unknown>): Promise<SendResult>
  status(): SendQueueStatus
  stop(): void
}

interface Job {
  readonly key: SendKey
  readonly run: () => Promise<unknown>
  attempts: number
  notBefore: number
  readonly resolve: (result: SendResult) => void
}

/**
 * @param perSecond    most sends started in any one second (all keys together)
 * @param perKeyGapMs  least time between two sends to the same key (e.g. the same Telegram chat)
 * @param maxAttempts  tries per message before it counts as failed
 */
export function createSendQueue({ name, perSecond = 25, perKeyGapMs = 0, maxAttempts = 5, maxPending = 10_000, log = console, now = () => Date.now() }: SendQueueOptions): SendQueue {
  const jobs: Job[] = []
  const keyReadyAt = new Map<SendKey, number>()
  const startedAt: number[] = []
  let pausedUntil = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const stats = { sent: 0, retried: 0, failed: 0, dropped: 0 }
  let lastError: string | null = null

  function schedule(delayMs: number) {
    if (stopped) return
    if (timer) return
    timer = setTimeout(() => { timer = undefined; pump() }, Math.max(0, delayMs))
    timer.unref?.()
  }

  function pump() {
    const at = now()
    while (startedAt.length > 0 && at - startedAt[0] >= 1000) startedAt.shift()
    let wake = Infinity
    if (pausedUntil > at) wake = pausedUntil - at
    else {
      for (let index = 0; index < jobs.length;) {
        if (startedAt.length >= perSecond) { wake = Math.min(wake, startedAt[0] + 1000 - at); break }
        const job = jobs[index]
        const readyAt = Math.max(job.notBefore, keyReadyAt.get(job.key) ?? 0)
        if (readyAt > at) { wake = Math.min(wake, readyAt - at); index += 1; continue }
        jobs.splice(index, 1)
        startedAt.push(at)
        keyReadyAt.set(job.key, at + perKeyGapMs)
        void attempt(job)
      }
    }
    if (jobs.length > 0 && wake !== Infinity) schedule(wake)
    // Forget per-key pacing that no longer matters, so the map does not grow forever.
    if (keyReadyAt.size > 1000) for (const [key, readyAt] of keyReadyAt) if (readyAt <= at) keyReadyAt.delete(key)
  }

  async function attempt(job: Job) {
    job.attempts += 1
    try {
      await job.run()
      stats.sent += 1
      job.resolve({ ok: true, attempts: job.attempts })
    } catch (caught) {
      // Anything can be thrown; only the optional SendError fields are read, each with a fallback.
      const error = caught as SendError | null | undefined
      lastError = `${error?.message ?? caught}`
      if (!error?.permanent && job.attempts < maxAttempts && !stopped) {
        const waitMs = error?.retryAfterMs ?? Math.min(60_000, 1000 * 2 ** job.attempts)
        // "Too many requests" is about the whole bot / service: hold every message, not only this one.
        if (error?.retryAfterMs) pausedUntil = Math.max(pausedUntil, now() + waitMs)
        job.notBefore = now() + waitMs
        stats.retried += 1
        jobs.push(job)
      } else {
        stats.failed += 1
        log.warn?.(`[${name}] gave up on a message after ${job.attempts} attempt(s): ${lastError}`)
        job.resolve({ ok: false, attempts: job.attempts, error: lastError })
      }
    }
    if (jobs.length > 0) schedule(0)
  }

  return {
    /** Queues one send; the promise settles when it was delivered or given up on (it never rejects). */
    enqueue(key, run) {
      if (stopped || jobs.length >= maxPending) {
        stats.dropped += 1
        return Promise.resolve({ ok: false, attempts: 0, error: stopped ? 'stopped' : 'queue full' })
      }
      return new Promise<SendResult>((resolve) => {
        jobs.push({ key, run, attempts: 0, notBefore: 0, resolve })
        schedule(0)
      })
    },
    status: () => ({ pending: jobs.length, ...stats, pausedForSec: pausedUntil > now() ? Math.ceil((pausedUntil - now()) / 1000) : 0, lastError }),
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
