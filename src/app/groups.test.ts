import { describe, expect, it } from 'vitest'
import {
  EMPTY_GROUPS,
  assignToGroup,
  createGroup,
  deleteGroup,
  parseGroups,
  renameGroup,
  toggleGroupCollapsed,
} from './groups'

describe('drawing groups', () => {
  it('creates a group holding the chosen drawings', () => {
    const state = createGroup(EMPTY_GROUPS, '  Longs  ', ['a', 'b'], 'g1')
    expect(state.groups).toEqual([{ id: 'g1', name: 'Longs' }])
    expect(state.assignments).toEqual({ a: 'g1', b: 'g1' })
  })

  it('moves drawings between groups and out of groups', () => {
    let state = createGroup(EMPTY_GROUPS, 'Longs', ['a'], 'g1')
    state = createGroup(state, 'Trendlines', [], 'g2')
    state = assignToGroup(state, ['a'], 'g2')
    expect(state.assignments).toEqual({ a: 'g2' })
    state = assignToGroup(state, ['a'], undefined)
    expect(state.assignments).toEqual({})
  })

  it('renames and collapses a group', () => {
    let state = createGroup(EMPTY_GROUPS, 'Longs', [], 'g1')
    state = renameGroup(state, 'g1', 'Swing longs')
    state = toggleGroupCollapsed(state, 'g1')
    expect(state.groups[0]).toEqual({ id: 'g1', name: 'Swing longs', collapsed: true })
    expect(toggleGroupCollapsed(state, 'g1').groups[0].collapsed).toBeUndefined()
  })

  it('deleting a group ungroups its drawings', () => {
    const state = deleteGroup(createGroup(EMPTY_GROUPS, 'Longs', ['a'], 'g1'), 'g1')
    expect(state).toEqual({ groups: [], assignments: {} })
  })

  it('drops invalid stored data', () => {
    const parsed = parseGroups({
      groups: [{ id: 'g1', name: 'ok' }, { id: 'g1', name: 'dup' }, { id: 3, name: 'bad' }],
      assignments: { a: 'g1', b: 'missing', c: 5 },
    })
    expect(parsed.groups).toEqual([{ id: 'g1', name: 'ok' }])
    expect(parsed.assignments).toEqual({ a: 'g1' })
    expect(parseGroups(null)).toEqual(EMPTY_GROUPS)
  })
})
