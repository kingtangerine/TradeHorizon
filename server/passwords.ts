// Password hashing (scrypt with a random salt per password) and temporary passwords for admin resets.
// Passwords are never stored or logged, only their hash, so nobody can look one up: a forgotten password is replaced.
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) => {
    scrypt(password, salt, 64, (error, key) => (error ? fail(error) : ok(key)))
  })

export async function makeHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`
}

export async function verifyHash(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = String(stored).split(':')
  if (!saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = await derive(password, Buffer.from(saltHex, 'hex'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// No 0/O, 1/l/I: easy to read out or type from a message.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A random password like "k7Pq-Zm3x-Rt9d" (about 70 bits), for an admin to hand to a user who forgot theirs. */
export function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `${group()}-${group()}-${group()}`
}
