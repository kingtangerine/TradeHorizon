import { describe, expect, it } from 'vitest'
import { makeHash, temporaryPassword, verifyHash } from './passwords.mjs'

describe('passwords', () => {
  it('hashes with a fresh salt and verifies only the right password', async () => {
    const one = await makeHash('supersecret1')
    const two = await makeHash('supersecret1')
    expect(one).not.toBe(two)
    expect(await verifyHash('supersecret1', one)).toBe(true)
    expect(await verifyHash('wrong', one)).toBe(false)
    expect(await verifyHash('x', 'not-a-hash')).toBe(false)
  })

  it('makes readable, random temporary passwords', () => {
    const passwords = new Set(Array.from({ length: 200 }, temporaryPassword))
    expect(passwords.size).toBe(200)
    for (const password of passwords) expect(password).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{4}-[a-km-np-zA-HJ-NP-Z2-9]{4}-[a-km-np-zA-HJ-NP-Z2-9]{4}$/)
  })
})
