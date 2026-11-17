// Small HTTP helpers shared by the server modules.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { addVary } from './cors.ts'

const gzipAsync = promisify(gzip)

/** Set TH_TRUST_PROXY=1 when the app sits behind nginx/Cloudflare so the real client IP is used. */
export const trustProxy = process.env.TH_TRUST_PROXY === '1'

/** The visitor's IP: the first X-Forwarded-For entry behind a trusted proxy, else the socket address. */
export function clientIp(req: IncomingMessage): string {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim()
    if (forwarded) return forwarded
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Whether the visitor reached the app over HTTPS (directly, or through a trusted proxy). */
export function isHttps(req: IncomingMessage): boolean {
  return Boolean((req.socket as Partial<TLSSocket>).encrypted) || (trustProxy && req.headers['x-forwarded-proto'] === 'https')
}

/** Sends `body` as an uncached JSON response. */
export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** JSON response that is gzip-compressed when it is big and the client accepts it. */
export async function sendCompressed(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheControl = 'no-store',
): Promise<void> {
  const text = JSON.stringify(body)
  // Added to any Vary already set (CORS sets Origin); passing Vary to writeHead would replace it.
  addVary(res, 'Accept-Encoding')
  const headers: OutgoingHttpHeaders = { 'Content-Type': 'application/json', 'Cache-Control': cacheControl }
  if (text.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const data = await gzipAsync(text)
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': data.length })
    res.end(data)
    return
  }
  res.writeHead(status, headers)
  res.end(text)
}

/** A parsed JSON request body. Field values are unchecked: each route validates the fields it reads. */
export type RequestBody = Readonly<Record<string, unknown>>

/**
 * Reads and parses a JSON request body of at most `limit` bytes; an empty body reads as `{}`.
 * Every API route takes a JSON object, so arrays and bare values are rejected as invalid requests.
 */
export function readBody(req: IncomingMessage, limit = 10_000): Promise<RequestBody> {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('Request too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      let value: unknown
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        fail(new Error('Invalid request.'))
        return
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) ok(value as RequestBody)
      else fail(new Error('Invalid request.'))
    })
    req.on('error', fail)
  })
}

/** Sliding-window limiter per key (IP). Old entries are pruned so memory stays bounded. */
export function createThrottle(limit: number, windowMs: number): (key: string) => boolean {
  const hits = new Map<string, number[]>()
  const prune = setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, times] of hits) {
      const recent = times.filter((time) => time > cutoff)
      if (recent.length === 0) hits.delete(key)
      else hits.set(key, recent)
    }
  }, windowMs)
  prune.unref()
  return (key: string) => {
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
    'https://data-api.binance.vision',
    'https://fapi.binance.com',
    'https://api.bybit.com',
    'https://api.coingecko.com',
    'https://www.okx.com',
    'https://api.bitget.com',
    'https://api.gateio.ws',
    'wss://data-stream.binance.vision',
    'wss://fstream.binance.com',
    'wss://stream.bybit.com',
  ].join(' '),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Adds the security headers above (and HSTS on HTTPS) to a response. */
export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}
