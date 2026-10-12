import { describe, expect, it } from 'vitest'
import { moveTab } from './workspace'

const tabs = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const order = (list: readonly { id: string }[]) => list.map((tab) => tab.id).join('')

describe('moving tabs', () => {
  it('moves a tab forward and backward', () => {
    expect(order(moveTab(tabs, 'a', 2))).toBe('bcad')
    expect(order(moveTab(tabs, 'd', 0))).toBe('dabc')
    expect(order(moveTab(tabs, 'b', 3))).toBe('acdb')
  })

  it('leaves the order alone for no-op, unknown or out-of-range requests', () => {
    expect(order(moveTab(tabs, 'b', 1))).toBe('abcd')
    expect(order(moveTab(tabs, 'zzz', 0))).toBe('abcd')
    expect(order(moveTab(tabs, 'a', 99))).toBe('bcda')
    expect(order(moveTab(tabs, 'd', -5))).toBe('dabc')
  })

  it('does not change the original list', () => {
    moveTab(tabs, 'a', 3)
    expect(order(tabs)).toBe('abcd')
  })
})
