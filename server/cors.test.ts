import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_ALLOWED_ORIGINS, applyCors, parseAllowedOrigins } from './cors.ts'
import { sendCompressed } from './http.ts'

describe('parseAllowedOrigins', () => {
  it('defaults to the Android app origins', () => {
    expect([...parseAllowedOrigins(undefined)]).toEqual(DEFAULT_ALLOWED_ORIGINS.split(','))
  })

  it('reads a comma-separated list, trimming spaces and trailing slashes', () => {
    expect([...parseAllowedOrigins(' https://a.example/ ,https://b.example,, ')]).toEqual(['https://a.example', 'https://b.example'])
  })

  it('allows no origin when set to an empty value', () => {
    expect(parseAllowedOrigins('').size).toBe(0)
  })
})

describe('applyCors on a real server', () => {
  const allowed = parseAllowedOrigins('https://localhost')
  let server: Server
  let base: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (applyCors(req, res, allowed)) return
      // A large body, so the compressed path (which sets its own Vary) is exercised.
      void sendCompressed(req, res, 200, { data: 'x'.repeat(2000) }, 'public, max-age=300')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('answers a preflight from an allowed origin', async () => {
    const response = await fetch(`${base}/api/data`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(response.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('adds the origin to real responses and keeps both Vary values', async () => {
    const response = await fetch(`${base}/api/markets`, { headers: { Origin: 'https://localhost', 'Accept-Encoding': 'gzip' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost')
    const vary = (response.headers.get('vary') ?? '').toLowerCase()
    expect(vary).toContain('origin')
    expect(vary).toContain('accept-encoding')
  })

  it('gives another origin no CORS headers and does not answer its preflight', async () => {
    const preflight = await fetch(`${base}/api/data`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' },
    })
    expect(preflight.status).toBe(200) // fell through to the normal handler
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull()
    expect((preflight.headers.get('vary') ?? '').toLowerCase()).toContain('origin')
  })

  it('leaves same-origin requests (no Origin header) untouched', async () => {
    const response = await fetch(`${base}/api/markets`)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
