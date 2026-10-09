import { useEffect, useMemo, useState } from 'react'
import { MoreVerticalIcon, PlusIcon, SearchIcon, SortIcon, StarIcon } from './Icons'
import {
  filterAndSortLayouts,
  layoutSummary,
  type LayoutSort,
  type SavedLayout,
} from './workspace'

const SORT_OPTIONS: ReadonlyArray<{ value: LayoutSort; label: string }> = [
  { value: 'modified', label: 'Recently modified' },
  { value: 'created', label: 'Recently created' },
  { value: 'name', label: 'Name' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatLayoutDate(valueMs: number): string {
  const date = new Date(valueMs)
  return `${date.getDate()} ${MONTHS[date.getMonth()]} '${String(date.getFullYear()).slice(-2)}`
}

interface SuperchartProps {
  layouts: readonly SavedLayout[]
  activeLayoutId?: string
  onOpen(layout: SavedLayout): void
  /** Middle-click: open in a new tab without switching to it. */
  onOpenInBackground(layout: SavedLayout): void
  onCreate(): void
  onNewChart(): void
  onToggleFavorite(id: string): void
  onRename(id: string, name: string): void
  onDuplicate(id: string): void
  onDelete(id: string): void
}

export function Superchart({
  layouts,
  activeLayoutId,
  onOpen,
  onOpenInBackground,
  onCreate,
  onNewChart,
  onToggleFavorite,
  onRename,
  onDuplicate,
  onDelete,
}: SuperchartProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LayoutSort>('modified')
  const [sortOpen, setSortOpen] = useState(false)
  const [menuId, setMenuId] = useState<string>()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>()
  const [renamingId, setRenamingId] = useState<string>()
  const [draftName, setDraftName] = useState('')
  const visible = useMemo(() => filterAndSortLayouts(layouts, query, sort), [layouts, query, sort])

  useEffect(() => {
    const closePopovers = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-popover]')) return
      setMenuId(undefined)
      setConfirmDeleteId(undefined)
      setSortOpen(false)
    }
    globalThis.addEventListener('mousedown', closePopovers)
    return () => globalThis.removeEventListener('mousedown', closePopovers)
  }, [])

  const startRename = (layout: SavedLayout) => {
    setRenamingId(layout.id)
    setDraftName(layout.name)
    setMenuId(undefined)
  }

  const commitRename = () => {
    if (renamingId && draftName.trim()) onRename(renamingId, draftName.trim())
    setRenamingId(undefined)
  }

  return (
    <section className="superchart-page" aria-labelledby="superchart-page-title">
      <div className="superchart-inner">
        <header className="superchart-header">
          <h1 id="superchart-page-title">Supercharts</h1>
          <label className="superchart-search">
            <SearchIcon />
            <input
              value={query}
              placeholder="Search"
              aria-label="Search layouts"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="superchart-pill-button" onClick={onNewChart}>
            <PlusIcon /> New chart
          </button>
          <div className="superchart-sort" data-popover>
            <button
              type="button"
              className="superchart-icon-button"
              aria-label="Sort layouts"
              aria-expanded={sortOpen}
              title="Sort layouts"
              onClick={() => setSortOpen((open) => !open)}
            >
              <SortIcon />
            </button>
            {sortOpen && (
              <div className="superchart-menu" role="menu">
                {SORT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={sort === option.value}
                    className={sort === option.value ? 'selected' : ''}
                    key={option.value}
                    onClick={() => { setSort(option.value); setSortOpen(false) }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="layout-card-grid">
          <button type="button" className="layout-card layout-card-create" onClick={onCreate}>
            <PlusIcon /> Create new layout
          </button>

          {visible.map((layout) => {
            const summary = layoutSummary(layout)
            const renaming = renamingId === layout.id
            return (
              <article
                className={layout.id === activeLayoutId ? 'layout-card current' : 'layout-card'}
                key={layout.id}
              >
                <button
                  type="button"
                  className="layout-card-open"
                  aria-label={`Open ${layout.name}`}
                  onClick={() => onOpen(layout)}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return
                    event.preventDefault()
                    onOpenInBackground(layout)
                  }}
                />
                <button
                  type="button"
                  className={layout.favorite ? 'layout-card-star active' : 'layout-card-star'}
                  aria-label={layout.favorite ? `Unstar ${layout.name}` : `Star ${layout.name}`}
                  aria-pressed={!!layout.favorite}
                  onClick={() => onToggleFavorite(layout.id)}
                >
                  <StarIcon filled={layout.favorite} />
                </button>
                {renaming ? (
                  <input
                    className="layout-card-rename"
                    autoFocus
                    maxLength={48}
                    value={draftName}
                    aria-label="Layout name"
                    onChange={(event) => setDraftName(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') setRenamingId(undefined)
                    }}
                  />
                ) : (
                  <strong className="layout-card-name">{layout.name}</strong>
                )}
                <span className="layout-card-meta">
                  {summary.symbol}, {summary.interval} • {formatLayoutDate(layout.updatedAtMs)}
                  {layout.id === activeLayoutId && <em>Current</em>}
                </span>

                <div className="layout-card-menu-anchor" data-popover>
                  <button
                    type="button"
                    className="layout-card-more"
                    aria-label={`Actions for ${layout.name}`}
                    aria-expanded={menuId === layout.id}
                    onClick={() => { setMenuId(menuId === layout.id ? undefined : layout.id); setConfirmDeleteId(undefined) }}
                  >
                    <MoreVerticalIcon />
                  </button>
                  {menuId === layout.id && (
                    <div className="superchart-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onOpen(layout) }}>Open</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onOpenInBackground(layout) }}>Open in new tab</button>
                      <button type="button" role="menuitem" onClick={() => startRename(layout)}>Rename</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onDuplicate(layout.id) }}>Make a copy</button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          if (confirmDeleteId !== layout.id) { setConfirmDeleteId(layout.id); return }
                          setMenuId(undefined)
                          setConfirmDeleteId(undefined)
                          onDelete(layout.id)
                        }}
                      >
                        {confirmDeleteId === layout.id ? 'Click again to delete' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        {visible.length === 0 && (
          <p className="superchart-empty">
            {layouts.length === 0
              ? 'No saved layouts yet. Create one, or use Save in the chart toolbar.'
              : `No layouts match “${query.trim()}”.`}
          </p>
        )}
      </div>
    </section>
  )
}
