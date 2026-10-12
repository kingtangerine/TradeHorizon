import { describe, expect, it } from 'vitest'
import {
  EMPTY_LAYOUT_FOLDERS,
  createFolder,
  deleteFolder,
  filterByFolder,
  folderCounts,
  moveLayoutToFolder,
  pruneFolderAssignments,
  renameFolder,
} from './layoutFolders'

const layouts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('layout folders', () => {
  it('creates a folder, optionally holding layouts, and names a blank one', () => {
    const state = createFolder(EMPTY_LAYOUT_FOLDERS, '  Swing  ', ['a'], 'f1')
    expect(state.groups).toEqual([{ id: 'f1', name: 'Swing' }])
    expect(state.assignments).toEqual({ a: 'f1' })
    expect(createFolder(EMPTY_LAYOUT_FOLDERS, '   ', [], 'f2').groups[0].name).toBe('New folder')
  })

  it('moves a layout between folders and out of any folder', () => {
    let state = createFolder(createFolder(EMPTY_LAYOUT_FOLDERS, 'One', [], 'f1'), 'Two', [], 'f2')
    state = moveLayoutToFolder(state, ['a'], 'f1')
    state = moveLayoutToFolder(state, ['a'], 'f2')
    expect(state.assignments).toEqual({ a: 'f2' })
    expect(moveLayoutToFolder(state, ['a'], undefined).assignments).toEqual({})
  })

  it('filters by all, unfiled or one folder', () => {
    const state = moveLayoutToFolder(createFolder(EMPTY_LAYOUT_FOLDERS, 'One', [], 'f1'), ['a', 'b'], 'f1')
    expect(filterByFolder(layouts, state, 'all')).toHaveLength(3)
    expect(filterByFolder(layouts, state, 'none')).toEqual([{ id: 'c' }])
    expect(filterByFolder(layouts, state, 'f1').map((layout) => layout.id)).toEqual(['a', 'b'])
    expect(folderCounts(layouts, state)).toEqual({ f1: 2 })
  })

  it('deleting a folder keeps its layouts, which become unfiled', () => {
    const state = createFolder(EMPTY_LAYOUT_FOLDERS, 'One', ['a'], 'f1')
    const after = deleteFolder(state, 'f1')
    expect(after.groups).toEqual([])
    expect(filterByFolder(layouts, after, 'none')).toHaveLength(3)
  })

  it('renames a folder', () => {
    const state = renameFolder(createFolder(EMPTY_LAYOUT_FOLDERS, 'One', [], 'f1'), 'f1', 'Scalps')
    expect(state.groups[0].name).toBe('Scalps')
  })

  it('forgets assignments of deleted layouts and leaves the state alone when nothing changed', () => {
    const state = createFolder(EMPTY_LAYOUT_FOLDERS, 'One', ['a', 'gone'], 'f1')
    expect(pruneFolderAssignments(state, ['a', 'b']).assignments).toEqual({ a: 'f1' })
    expect(pruneFolderAssignments(state, ['a', 'gone'])).toBe(state)
  })
})
