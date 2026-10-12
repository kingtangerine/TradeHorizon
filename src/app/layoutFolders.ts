// Folders on the Superchart page. Same shape as the object-tree groups (groups.ts), so the
// helpers are shared: a layout stays a plain SavedLayout and the folder is a label layer on top.
import {
  EMPTY_GROUPS,
  assignToGroup,
  createGroup,
  deleteGroup,
  parseGroups,
  renameGroup,
  type GroupState,
} from './groups'

export type LayoutFolderState = GroupState
export const EMPTY_LAYOUT_FOLDERS: LayoutFolderState = EMPTY_GROUPS

export { assignToGroup as moveLayoutToFolder, deleteGroup as deleteFolder, renameGroup as renameFolder }

export function layoutFoldersKey(userId: string): string {
  return `trade-horizon:user:${userId}:layout-folders:v1`
}

export function loadLayoutFolders(userId: string): LayoutFolderState {
  try {
    return parseGroups(JSON.parse(localStorage.getItem(layoutFoldersKey(userId)) ?? 'null'))
  } catch {
    return EMPTY_LAYOUT_FOLDERS
  }
}

export function saveLayoutFolders(userId: string, state: LayoutFolderState): void {
  try {
    localStorage.setItem(layoutFoldersKey(userId), JSON.stringify(state))
  } catch {
    // Storage full or blocked: folders simply are not remembered.
  }
}

/** A new folder, optionally with layouts already in it. A blank name becomes "New folder". */
export function createFolder(
  state: LayoutFolderState,
  name: string,
  layoutIds: readonly string[] = [],
  id?: string,
): LayoutFolderState {
  return createGroup(state, name.trim() || 'New folder', layoutIds, id)
}

/** Forgets assignments for layouts that no longer exist. Returns the same object when nothing changed. */
export function pruneFolderAssignments(state: LayoutFolderState, layoutIds: Iterable<string>): LayoutFolderState {
  const alive = new Set(layoutIds)
  const entries = Object.entries(state.assignments)
  const kept = entries.filter(([layoutId]) => alive.has(layoutId))
  return kept.length === entries.length ? state : { ...state, assignments: Object.fromEntries(kept) }
}

/** Which layouts to show: `all`, those in no folder (`none`), or one folder's. */
export type FolderFilter = 'all' | 'none' | string

export function filterByFolder<T extends { readonly id: string }>(
  layouts: readonly T[],
  state: LayoutFolderState,
  filter: FolderFilter,
): T[] {
  if (filter === 'all') return [...layouts]
  if (filter === 'none') return layouts.filter((layout) => !state.assignments[layout.id])
  return layouts.filter((layout) => state.assignments[layout.id] === filter)
}

export function folderCounts(layouts: readonly { readonly id: string }[], state: LayoutFolderState): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const layout of layouts) {
    const folderId = state.assignments[layout.id]
    if (folderId) counts[folderId] = (counts[folderId] ?? 0) + 1
  }
  return counts
}
