// Small HTTP helpers shared by the server modules.
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

/** Set TH_TRUST_PROXY=1 when the app sits behind nginx/Cloudflare so the real client IP is used. */
export const trustProxy = process.env.TH_TRUST_PROXY === '1'

export function clientIp(req) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function isHttps(req) {
  return Boolean(req.socket.encrypted) || (trustProxy && req.headers['x-forwarded-proto'] === 'https')
}

export function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** JSON response that is gzip-compressed when it is big and the client accepts it. */
export async function sendCompressed(req, res, status, body, cacheControl = 'no-store') {
  const text = JSON.stringify(body)
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, Vary: 'Accept-Encoding' }
  if (text.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const data = await gzipAsync(text)
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': data.length })
    res.end(data)
    return
  }
  res.writeHead(status, headers)
  res.end(text)
}

export function readBody(req, limit = 10_000) {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { fail(new Error('Request too large.')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { fail(new Error('Invalid request.')) }
    })
    req.on('error', fail)
  })
}

/** Sliding-window limiter per key (IP). Old entries are pruned so memory stays bounded. */
export function createThrottle(limit, windowMs) {
  const hits = new Map()
  const prune = setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, times] of hits) {
      const recent = times.filter((time) => time > cutoff)
      if (recent.length === 0) hits.delete(key)
      else hits.set(key, recent)
    }
  }, windowMs)
  prune.unref()
  return (key) => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs)
    recent.push(now)
    hits.set(key, recent)
    return recent.length > limit
  }
}

/**
 * Browser security headers for every response. The CSP lists exactly the market-data hosts the
 * app talks to; everything else is blocked, which limits the damage of any script-injection bug.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React and the chart set inline style attributes, so styles need 'unsafe-inline'; scripts do not.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  [
    "connect-src 'self'",
    'https://data-api.binance.vision', 'https://fapi.binance.com', 'https://api.bybit.com', 'https://api.coingecko.com',
    'wss://data-stream.binance.vision', 'wss://fstream.binance.com', 'wss://stream.bybit.com',
  ].join(' '),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export function applySecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}
