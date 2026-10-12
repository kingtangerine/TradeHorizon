import { describe, expect, it } from 'vitest'
import { decideRemote } from './userSync'

const remote = { value: 'new', updatedAtMs: 2000 }

describe('decideRemote', () => {
  it('does nothing when both sides already match', () => {
    expect(decideRemote('new', { syncedAtMs: 1, dirty: true }, remote)).toBe('keep-local')
  })

  it('takes the server copy when this browser has nothing, or has not edited since its last sync', () => {
    expect(decideRemote(null, undefined, remote)).toBe('take-remote')
    expect(decideRemote('old', { syncedAtMs: 1000, dirty: false }, remote)).toBe('take-remote')
  })

  it('keeps genuine local edits when the server has not changed since the last sync', () => {
    expect(decideRemote('edited', { syncedAtMs: 2000, dirty: true }, remote)).toBe('keep-local')
  })

  it('lets a newer server copy beat a stale "dirty" local copy, keeping a backup', () => {
    expect(decideRemote('stale', { syncedAtMs: 1000, dirty: true }, remote)).toBe('take-remote-backup')
    expect(decideRemote('stale', undefined, remote)).toBe('take-remote-backup')
  })
})
