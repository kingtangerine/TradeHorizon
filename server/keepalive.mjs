// Keeps the server running on hosts that stop idle Node apps (Plesk / Phusion Passenger stops an app after
// about 5 minutes without web requests). Price alerts and the Telegram bot live in this process, so while it
// is stopped nothing is checked or sent. The server therefore requests its own /healthz every couple of
// minutes through its public address (learned from the requests it receives, or TH_PUBLIC_URL), which counts
// as traffic. Also: a record of when the process started, so /healthz shows whether it keeps being restarted.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PING_MS = 2 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** Public origin of a request as the visitor used it ("https://example.com"), or undefined for local/odd hosts. */
export function originOf(headers, trustProxy) {
  const host = String((trustProxy && headers['x-forwarded-host']) || headers.host || '').split(',')[0].trim()
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return undefined
  if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(host)) return undefined
  const forwarded = String(headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const proto = forwarded === 'https' || forwarded === 'http' ? forwarded : 'http'
  return `${proto}://${host}`
}

export function createKeepAlive({ publicUrl, trustProxy = true, fetchImpl = (url, init) => fetch(url, init), log = console, intervalMs = PING_MS }) {
  let origin = publicUrl ? publicUrl.replace(/\/+$/, '') : undefined
  let timer
  let lastPing = { atMs: 0, ok: false }

  async function ping() {
    if (!origin) return
    try {
      const response = await fetchImpl(`${origin}/healthz?keepalive=1`, { headers: { 'User-Agent': 'TradeHorizon keep-alive' }, signal: AbortSignal.timeout(15_000) })
      lastPing = { atMs: Date.now(), ok: response.ok }
    } catch (error) {
      if (lastPing.ok || lastPing.atMs === 0) log.warn?.(`[keep-alive] could not reach ${origin}: ${error.message}`)
      lastPing = { atMs: Date.now(), ok: false }
    }
  }

  return {
    /** Learns the public address from a real visitor's request (the first one that has a usable Host). */
    observe(req) {
      if (origin || req.headers['user-agent'] === 'TradeHorizon keep-alive') return
      origin = originOf(req.headers, trustProxy)
      if (origin) log.log?.(`[keep-alive] pinging ${origin}/healthz every ${Math.round(intervalMs / 60_000)} min so the host does not stop the app`)
    },
    start() {
      timer = setInterval(() => void ping(), intervalMs)
      timer.unref?.()
    },
    stop() { clearInterval(timer) },
    status: () => ({ origin: origin ?? null, lastPingAtMs: lastPing.atMs || null, lastPingOk: lastPing.ok }),
    ping,
  }
}

/** Remembers process start times (last 50) in the data folder. Returns the list including this start. */
export function recordStart(dataDir, now = Date.now()) {
  const file = join(dataDir, 'starts.json')
  let starts = []
  if (existsSync(file)) {
    try { starts = JSON.parse(readFileSync(file, 'utf8')).filter((value) => typeof value === 'number') } catch { /* start fresh */ }
  }
  starts = [...starts, now].slice(-50)
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(starts))
    renameSync(`${file}.tmp`, file)
  } catch { /* data folder not writable: health shows that separately */ }
  return starts
}

export function startsWithinDay(starts, now = Date.now()) {
  return starts.filter((value) => now - value < DAY_MS).length
}
