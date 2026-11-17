// Types for the one function the web push tests use from `http_ece` (MIT, development only), the reference
// implementation of RFC 8188 content encryption. It ships no types of its own.
declare module 'http_ece' {
  import type { ECDH } from 'node:crypto'

  interface DecryptOptions {
    readonly version: 'aes128gcm'
    /** The browser's key pair; the sender's public key is read from the message header. */
    readonly privateKey: ECDH
    readonly authSecret: Buffer
  }

  export function decrypt(buffer: Buffer, options: DecryptOptions): Buffer
}
