// Three-way merge for synced data. Two devices may change the same item (layouts, drawings, alerts…)
// before either has seen the other's copy. Instead of the last upload replacing the whole list, the copies
// are merged item by item against the last version both had in common (the "base"):
//   - an item only one side changed takes that side's version,
//   - an item added on either side is kept,
//   - an item deleted on one side and untouched on the other is removed,
//   - an item changed on both sides is merged field by field; a field changed on both keeps the local value.
// The base is not stored in full: a tree of short fingerprints is enough to tell "changed" from "unchanged",
// which keeps it small next to the data itself.

export interface Base {
  /** Fingerprint of the whole value. */
  readonly h: string
  /** Children by item id (arrays of objects with an `id`), by element (arrays of plain values) or by property. */
  readonly c?: Readonly<Record<string, Base>>
}

const MAX_DEPTH = 5

/** FNV-1a (32 bit) in base 36: short, fast, and plenty to detect a change. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const fp = (value: unknown): string => fingerprint(JSON.stringify(value) ?? 'undefined')

type Kind = 'idArray' | 'valueArray' | 'emptyArray' | 'object' | 'leaf'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function kindOf(value: unknown): Kind {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'emptyArray'
    const ids = new Set<string>()
    if (value.every((item) => isPlainObject(item) && typeof item.id === 'string' && !ids.has(item.id) && ids.add(item.id))) return 'idArray'
    const values = new Set<string>()
    if (value.every((item) => (item === null || ['string', 'number', 'boolean'].includes(typeof item)) && !values.has(JSON.stringify(item)) && values.add(JSON.stringify(item)))) return 'valueArray'
    return 'leaf'
  }
  return isPlainObject(value) ? 'object' : 'leaf'
}

function entriesOf(value: unknown, kind: Kind): Array<[string, unknown]> {
  if (kind === 'idArray') return (value as Array<{ id: string }>).map((item) => [item.id, item])
  if (kind === 'valueArray') return (value as unknown[]).map((item) => [JSON.stringify(item), item])
  if (kind === 'object') return Object.entries(value as Record<string, unknown>)
  return []
}

export function baseOf(value: unknown, depth = 0): Base {
  const kind = kindOf(value)
  const h = fp(value)
  if (depth >= MAX_DEPTH || kind === 'leaf' || kind === 'emptyArray') return { h }
  return { h, c: Object.fromEntries(entriesOf(value, kind).map(([key, child]) => [key, baseOf(child, depth + 1)])) }
}

function unify(local: Kind, remote: Kind): Kind | undefined {
  if (local === remote) return local
  if (local === 'emptyArray' && (remote === 'idArray' || remote === 'valueArray')) return remote
  if (remote === 'emptyArray' && (local === 'idArray' || local === 'valueArray')) return local
  return undefined
}

export function merge(base: Base | undefined, local: unknown, remote: unknown): unknown {
  if (JSON.stringify(local) === JSON.stringify(remote)) return local
  if (base) {
    if (fp(local) === base.h) return remote
    if (fp(remote) === base.h) return local
  }
  const kind = unify(kindOf(local), kindOf(remote))
  if (kind === 'idArray' || kind === 'valueArray' || kind === 'object') return mergeKeyed(kind, base?.c, local, remote)
  // A plain value changed on both sides: this device's edit wins; with no common base, the server copy does.
  return base ? local : remote
}

function mergeKeyed(kind: Kind, children: Base['c'], local: unknown, remote: unknown): unknown {
  const localEntries = new Map(entriesOf(local, kind))
  const remoteEntries = new Map(entriesOf(remote, kind))
  const result = new Map<string, unknown>()

  for (const key of new Set([...remoteEntries.keys(), ...localEntries.keys()])) {
    const child = children?.[key]
    const inLocal = localEntries.has(key)
    const inRemote = remoteEntries.has(key)
    if (inLocal && inRemote) {
      result.set(key, merge(child, localEntries.get(key), remoteEntries.get(key)))
    } else if (inLocal) {
      // Missing on the server: deleted there if this device still has the base version, otherwise new or edited here.
      if (!(child && fp(localEntries.get(key)) === child.h)) result.set(key, localEntries.get(key))
    } else if (!(child && fp(remoteEntries.get(key)) === child.h)) {
      result.set(key, remoteEntries.get(key))
    }
  }

  // Keep the server's order and slot items that only this device has next to their local neighbours.
  const order = [...remoteEntries.keys()].filter((key) => result.has(key))
  let anchor = -1
  for (const key of localEntries.keys()) {
    const at = order.indexOf(key)
    if (at >= 0) anchor = at
    else if (result.has(key)) order.splice(++anchor, 0, key)
  }

  if (kind === 'object') return Object.fromEntries(order.map((key) => [key, result.get(key)]))
  return order.map((key) => result.get(key))
}

function parse(raw: string): { ok: true, value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(raw) } } catch { return { ok: false } }
}

/** Base for a stored string (JSON or not). */
export function baseOfRaw(raw: string): Base {
  const parsed = parse(raw)
  return parsed.ok ? baseOf(parsed.value) : { h: fingerprint(raw) }
}

/** Merges two stored strings. Returns one of the inputs unchanged when one side wins outright. */
export function mergeRaw(base: Base | undefined, local: string, remote: string): string {
  if (local === remote) return local
  const left = parse(local)
  const right = parse(remote)
  if (!left.ok || !right.ok) {
    if (base && fingerprint(local) === base.h) return remote
    if (base && fingerprint(remote) === base.h) return local
    return base ? local : remote
  }
  const merged = merge(base, left.value, right.value)
  if (merged === left.value) return local
  if (merged === right.value) return remote
  return JSON.stringify(merged)
}
