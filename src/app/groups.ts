// User-defined folders for the object tree. Kept apart from the drawing model: a drawing
// stays a pure market-space shape, and the grouping is just a label layer on top of it.

export interface DrawingGroup {
  readonly id: string
  readonly name: string
  readonly collapsed?: boolean
}

export interface GroupState {
  readonly groups: readonly DrawingGroup[]
  /** drawing id -> group id. Drawings without an entry are ungrouped. */
  readonly assignments: Readonly<Record<string, string>>
}

export const EMPTY_GROUPS: GroupState = { groups: [], assignments: {} }

export function groupsKey(userId: string): string {
  return `trade-horizon:user:${userId}:groups:v1`
}

export function parseGroups(value: unknown): GroupState {
  if (typeof value !== 'object' || value === null) return EMPTY_GROUPS
  const raw = value as { groups?: unknown, assignments?: unknown }
  const groups: DrawingGroup[] = []
  if (Array.isArray(raw.groups)) {
    for (const item of raw.groups) {
      if (typeof item !== 'object' || item === null) continue
      const { id, name, collapsed } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof name !== 'string' || groups.some((group) => group.id === id)) continue
      groups.push({ id, name: name.slice(0, 40), ...(collapsed === true ? { collapsed: true } : {}) })
    }
  }
  const assignments: Record<string, string> = {}
  if (typeof raw.assignments === 'object' && raw.assignments !== null) {
    for (const [drawingId, groupId] of Object.entries(raw.assignments)) {
      if (typeof groupId === 'string' && groups.some((group) => group.id === groupId)) assignments[drawingId] = groupId
    }
  }
  return { groups, assignments }
}

export function loadGroups(userId: string): GroupState {
  try {
    return parseGroups(JSON.parse(localStorage.getItem(groupsKey(userId)) ?? 'null'))
  } catch {
    return EMPTY_GROUPS
  }
}

export function saveGroups(userId: string, state: GroupState): void {
  try {
    localStorage.setItem(groupsKey(userId), JSON.stringify(state))
  } catch {
    // Storage full or blocked: grouping simply is not remembered.
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 40) || 'New group'
}

export function createGroup(state: GroupState, name: string, drawingIds: readonly string[], id: string = crypto.randomUUID()): GroupState {
  return assignToGroup({ ...state, groups: [...state.groups, { id, name: cleanName(name) }] }, drawingIds, id)
}

export function renameGroup(state: GroupState, groupId: string, name: string): GroupState {
  return { ...state, groups: state.groups.map((group) => (group.id === groupId ? { ...group, name: cleanName(name) } : group)) }
}

export function toggleGroupCollapsed(state: GroupState, groupId: string): GroupState {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) return group
      const { collapsed: _, ...rest } = group
      return group.collapsed ? rest : { ...rest, collapsed: true }
    }),
  }
}

/** Deleting a group keeps its drawings; they become ungrouped. */
export function deleteGroup(state: GroupState, groupId: string): GroupState {
  const assignments = Object.fromEntries(Object.entries(state.assignments).filter(([, id]) => id !== groupId))
  return { groups: state.groups.filter((group) => group.id !== groupId), assignments }
}

/** Moves drawings into a group, or out of any group when `groupId` is undefined. */
export function assignToGroup(state: GroupState, drawingIds: readonly string[], groupId: string | undefined): GroupState {
  const assignments = { ...state.assignments }
  for (const id of drawingIds) {
    if (groupId === undefined) delete assignments[id]
    else assignments[id] = groupId
  }
  return { ...state, assignments }
}
