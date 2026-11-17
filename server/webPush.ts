// Web Push delivery with node:crypto only: VAPID authentication (RFC 8292) and aes128gcm payload encryption
// (RFC 8291 on top of RFC 8188). Replaces the MPL-licensed `web-push` package; keys keep the same format, so
// existing server/data/vapid.json files and browser subscriptions stay valid.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto'

/** The application server's VAPID key pair: base64url P-256 public point (65 bytes) and private scalar (32 bytes). */
export interface VapidKeys {
  readonly publicKey: string
  readonly privateKey: string
}

/** A browser push subscription: where to send, and the browser's encryption keys (base64url). */
export interface PushTarget {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

/** A push service that answered with an error status. Carries what the send queue needs to decide on retries. */
export class WebPushError extends Error {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string

  constructor(statusCode: number, headers: Readonly<Record<string, string>>, body: string) {
    super(`push service answered ${statusCode}`)
    this.name = 'WebPushError'
    this.statusCode = statusCode
    this.headers = headers
    this.body = body
  }
}

/** Largest record the push services accept (RFC 8291 §4), header included. */
const RECORD_SIZE = 4096
const HEADER_BYTES = 16 + 4 + 1 + 65 // salt, record size, key id length, server public key
const TAG_BYTES = 16
/** VAPID tokens are valid for 12 hours, well inside the 24-hour maximum push services allow. */
const VAPID_LIFETIME_SEC = 12 * 60 * 60
const SEND_TIMEOUT_MS = 15_000

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** Decodes base64url (or plain base64, with or without padding), as browsers and older key files may use either. */
export function fromBase64Url(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** A new VAPID key pair, in the same encoding the `web-push` package used. */
export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  if (!jwk.d || !jwk.x || !jwk.y) throw new Error('Could not export the generated VAPID key.')
  const publicPoint = Buffer.concat([Buffer.from([0x04]), fromBase64Url(jwk.x), fromBase64Url(jwk.y)])
  return { publicKey: base64url(publicPoint), privateKey: jwk.d }
}

function checkedVapidKeys(keys: VapidKeys): { publicPoint: Buffer; privateScalar: Buffer } {
  const publicPoint = fromBase64Url(keys.publicKey)
  const privateScalar = fromBase64Url(keys.privateKey)
  if (publicPoint.length !== 65 || publicPoint[0] !== 0x04) throw new Error('The VAPID public key must be an uncompressed P-256 point.')
  if (privateScalar.length !== 32) throw new Error('The VAPID private key must be 32 bytes.')
  return { publicPoint, privateScalar }
}

/** The `Authorization` header for one push service origin: `vapid t=<ES256 JWT>, k=<public key>` (RFC 8292). */
export function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): string {
  const { publicPoint, privateScalar } = checkedVapidKeys(keys)
  const signingKey = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: base64url(privateScalar),
      x: base64url(publicPoint.subarray(1, 33)),
      y: base64url(publicPoint.subarray(33, 65)),
    },
  })
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + VAPID_LIFETIME_SEC, sub: subject })))
  // JWS ES256 wants the raw r||s signature, not DER.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: signingKey, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${base64url(publicPoint)}`
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer => Buffer.from(hkdfSync('sha256', ikm, salt, info, length))

/** Fixed inputs for tests; in normal use both are fresh random values for every message. */
export interface EncryptionInputs {
  readonly salt?: Buffer
  readonly serverPrivateKey?: Buffer
}

/** Encrypts `payload` for one browser as a single aes128gcm record (RFC 8291 §3.4, RFC 8188 §2). */
export function encryptPayload(payload: string | Buffer, target: PushTarget['keys'], inputs: EncryptionInputs = {}): Buffer {
  const userAgentPublic = fromBase64Url(target.p256dh)
  const authSecret = fromBase64Url(target.auth)
  if (userAgentPublic.length !== 65 || userAgentPublic[0] !== 0x04)
    throw new Error('The subscription p256dh key is not a P-256 public key.')
  if (authSecret.length !== 16) throw new Error('The subscription auth secret must be 16 bytes.')

  const plaintext = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  if (HEADER_BYTES + plaintext.length + 1 + TAG_BYTES > RECORD_SIZE) throw new Error('The notification payload is too large.')

  const ecdh = createECDH('prime256v1')
  if (inputs.serverPrivateKey) ecdh.setPrivateKey(inputs.serverPrivateKey)
  else ecdh.generateKeys()
  const serverPublic = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(userAgentPublic)
  const salt = inputs.salt ?? randomBytes(16)

  // IKM mixes in the browser's auth secret and both public keys; CEK and nonce then come from IKM and the salt.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), userAgentPublic, serverPublic])
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32)
  const contentKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12)

  // One record, so the padding delimiter is 0x02 ("last record") with no extra padding.
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()])

  const header = Buffer.alloc(HEADER_BYTES)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(serverPublic.length, 20)
  serverPublic.copy(header, 21)
  return Buffer.concat([header, ciphertext])
}

/** What createPushService needs to deliver notifications (server/alerts.ts). */
export interface WebPushSender {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(subscription: PushTarget, payload: string, options: { TTL: number }): Promise<void>
}

/** The real sender: encrypts and POSTs each message to the browser's push service. */
export function createWebPushSender(fetchImpl: typeof fetch = globalThis.fetch): WebPushSender {
  let details: { subject: string; keys: VapidKeys } | undefined
  return {
    setVapidDetails(subject, publicKey, privateKey) {
      const keys = { publicKey, privateKey }
      checkedVapidKeys(keys)
      details = { subject, keys }
    },
    async sendNotification(subscription, payload, options) {
      if (!details) throw new Error('Call setVapidDetails() before sending push notifications.')
      const body = encryptPayload(payload, subscription.keys)
      const response = await fetchImpl(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, details.subject, details.keys),
          TTL: String(options.TTL),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
        },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '') // The status is what matters; the body is only for logs.
        throw new WebPushError(response.status, Object.fromEntries(response.headers), text)
      }
    },
  }
}
