import { createECDH, createPublicKey, randomBytes, verify, type ECDH } from 'node:crypto'
import { decrypt } from 'http_ece'
import { describe, expect, it, vi } from 'vitest'
import { WebPushError, createWebPushSender, encryptPayload, fromBase64Url, generateVapidKeys, vapidAuthorization } from './webPush.ts'

/** A browser's side of a subscription: its key pair and auth secret. */
function browser(): { ecdh: ECDH; authSecret: Buffer; keys: { p256dh: string; auth: string } } {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const authSecret = randomBytes(16)
  return { ecdh, authSecret, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: authSecret.toString('base64url') } }
}

function parseAuthorization(header: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  if (!match) throw new Error(`Unexpected Authorization header: ${header}`)
  const [, head, claims, signature, publicKey] = match
  return { head, claims, signature, publicKey }
}

function verifies(header: string): boolean {
  const { head, claims, signature, publicKey } = parseAuthorization(header)
  const point = fromBase64Url(publicKey)
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
  })
  return verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
}

describe('VAPID keys and tokens', () => {
  it('generates keys in the base64url format of existing vapid.json files', () => {
    const keys = generateVapidKeys()
    expect(fromBase64Url(keys.publicKey)).toHaveLength(65)
    expect(fromBase64Url(keys.publicKey)[0]).toBe(0x04)
    expect(fromBase64Url(keys.privateKey)).toHaveLength(32)
    expect(keys.publicKey).toMatch(/^[\w-]+$/)
  })

  it('signs an ES256 token for the push service origin that verifies with the public key', () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', 'mailto:admin@example.com', keys, 1_800_000_000)
    const { head, claims, publicKey } = parseAuthorization(header)
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_800_000_000 + 12 * 60 * 60,
      sub: 'mailto:admin@example.com',
    })
    expect(publicKey).toBe(keys.publicKey)
    expect(verifies(header)).toBe(true)
  })

  it('rejects malformed keys', () => {
    expect(() =>
      vapidAuthorization('https://fcm.googleapis.com/x', 'mailto:a@example.com', { publicKey: 'abc', privateKey: 'def' }),
    ).toThrow(/public key/)
  })
})

describe('payload encryption (aes128gcm)', () => {
  it('produces a message the reference decoder (http_ece) decrypts', () => {
    const { ecdh, authSecret, keys } = browser()
    const message = JSON.stringify({ title: 'BTCUSDT crossed 65,000', body: 'Price alert', alertId: 'a1' })
    const body = encryptPayload(message, keys)
    expect(decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()).toBe(message)
  })

  it('writes the RFC 8188 header: salt, record size 4096, and the 65-byte server key', () => {
    const { keys } = browser()
    const salt = Buffer.alloc(16, 7)
    const body = encryptPayload('hi', keys, { salt })
    expect(body.subarray(0, 16)).toEqual(salt)
    expect(body.readUInt32BE(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(0x04)
    // header + plaintext + delimiter + tag
    expect(body).toHaveLength(86 + 2 + 1 + 16)
  })

  it('is deterministic for fixed inputs and different for fresh ones', () => {
    const { keys } = browser()
    const fixed = { salt: Buffer.alloc(16, 1), serverPrivateKey: Buffer.alloc(32, 2) }
    expect(encryptPayload('same', keys, fixed)).toEqual(encryptPayload('same', keys, fixed))
    expect(encryptPayload('same', keys)).not.toEqual(encryptPayload('same', keys))
  })

  it('rejects bad subscription keys and payloads too large for one record', () => {
    const { keys } = browser()
    expect(() => encryptPayload('x', { ...keys, auth: 'c2hvcnQ' })).toThrow(/auth secret/)
    expect(() => encryptPayload('x', { ...keys, p256dh: 'AAAA' })).toThrow(/p256dh/)
    expect(() => encryptPayload('x'.repeat(4000), keys)).toThrow(/too large/)
  })
})

describe('createWebPushSender', () => {
  it('posts the encrypted message with VAPID, TTL and encoding headers', async () => {
    const { ecdh, authSecret, keys } = browser()
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 201 }))
    const sender = createWebPushSender(fetchImpl as typeof fetch)
    const vapid = generateVapidKeys()
    sender.setVapidDetails('mailto:admin@example.com', vapid.publicKey, vapid.privateKey)

    await sender.sendNotification({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }, '{"title":"x"}', { TTL: 3600 })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc')
    const headers = init?.headers as Record<string, string>
    expect(init?.method).toBe('POST')
    expect(headers.TTL).toBe('3600')
    expect(headers['Content-Encoding']).toBe('aes128gcm')
    expect(verifies(headers.Authorization)).toBe(true)
    expect(decrypt(init?.body as Buffer, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()).toBe('{"title":"x"}')
  })

  it('rejects with the status and headers when the push service refuses', async () => {
    const { keys } = browser()
    const fetchImpl = async () => new Response('gone', { status: 410, headers: { 'Retry-After': '30' } })
    const sender = createWebPushSender(fetchImpl as typeof fetch)
    const vapid = generateVapidKeys()
    sender.setVapidDetails('mailto:admin@example.com', vapid.publicKey, vapid.privateKey)

    const failure = await sender
      .sendNotification({ endpoint: 'https://fcm.googleapis.com/x', keys }, '{}', { TTL: 60 })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebPushError)
    expect(failure).toMatchObject({ statusCode: 410, body: 'gone', headers: { 'retry-after': '30' } })
  })

  it('refuses to send before VAPID details are set', async () => {
    const { keys } = browser()
    await expect(
      createWebPushSender(vi.fn()).sendNotification({ endpoint: 'https://fcm.googleapis.com/x', keys }, '{}', { TTL: 60 }),
    ).rejects.toThrow(/setVapidDetails/)
  })
})
