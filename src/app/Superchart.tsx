import { useEffect, useMemo, useState } from 'react'
import { CloseIcon, FolderIcon, MoreVerticalIcon, PlusIcon, SearchIcon, SortIcon, SplitIcon, StarIcon } from './Icons'
import {
  createFolder,
  deleteFolder,
  filterByFolder,
  folderCounts,
  moveLayoutToFolder,
  renameFolder,
  type FolderFilter,
  type LayoutFolderState,
} from './layoutFolders'
import {
  MAX_COMBINED_LAYOUTS,
  combinedPanes,
  defaultSplitName,
  filterAndSortLayouts,
  layoutSummary,
  shortSymbol,
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
  folders: LayoutFolderState
  onFoldersChange(next: LayoutFolderState): void
  activeLayoutId?: string
  onOpen(layout: SavedLayout): void
  /** Middle-click: open in a new tab without switching to it. */
  onOpenInBackground(layout: SavedLayout, forceCopy?: boolean): void
  /** Opens the chosen layouts as one tab with a chart for each; `save` also keeps the result as a layout. */
  onOpenTogether(layouts: SavedLayout[], options: { name: string; save: boolean }): void
  onCreate(): void
  onNewChart(): void
  onToggleFavorite(id: string): void
  onRename(id: string, name: string): void
  onDuplicate(id: string): void
  onDelete(id: string): void
}

export function Superchart({
  layouts,
  folders,
  onFoldersChange,
  activeLayoutId,
  onOpen,
  onOpenInBackground,
  onOpenTogether,
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
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all')
  const [newFolderName, setNewFolderName] = useState<string>()
  const [renamingFolderId, setRenamingFolderId] = useState<string>()
  const [folderDraft, setFolderDraft] = useState('')
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false)
  // A folder deleted elsewhere (or on another device) falls back to showing everything.
  const filter: FolderFilter = folderFilter === 'all' || folderFilter === 'none' || folders.groups.some((folder) => folder.id === folderFilter) ? folderFilter : 'all'
  const counts = useMemo(() => folderCounts(layouts, folders), [layouts, folders])
  const unfiledCount = layouts.length - Object.values(counts).reduce((sum, count) => sum + count, 0)
  const activeFolder = folders.groups.find((folder) => folder.id === filter)
  const visible = useMemo(
    () => filterAndSortLayouts(filterByFolder(layouts, folders, filter), query, sort),
    [layouts, folders, filter, query, sort],
  )

  const commitNewFolder = (layoutId?: string) => {
    if (newFolderName === undefined) return
    const id = crypto.randomUUID()
    onFoldersChange(createFolder(folders, newFolderName, layoutId ? [layoutId] : [], id))
    setFolderFilter(layoutId ? filter : id)
    setNewFolderName(undefined)
  }
  const commitFolderRename = () => {
    if (renamingFolderId && folderDraft.trim()) onFoldersChange(renameFolder(folders, renamingFolderId, folderDraft))
    setRenamingFolderId(undefined)
  }

  // Combine mode: tick 2 to 4 layouts, in the order the charts should appear.
  const [combining, setCombining] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [splitName, setSplitName] = useState('')
  const [keepSplit, setKeepSplit] = useState(true)
  const picked = useMemo(
    () => pickedIds.map((id) => layouts.find((layout) => layout.id === id)).filter((layout): layout is SavedLayout => !!layout),
    [pickedIds, layouts],
  )
  const autoName = picked.length >= 2 ? defaultSplitName(combinedPanes(picked)) : ''
  const stopCombining = () => { setCombining(false); setPickedIds([]); setSplitName('') }
  const togglePick = (id: string) => setPickedIds((current) => (
    current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length >= MAX_COMBINED_LAYOUTS ? current : [...current, id]
  ))

  useEffect(() => {
    const closePopovers = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-popover]')) return
      setMenuId(undefined)
      setConfirmDeleteId(undefined)
      setSortOpen(false)
      setConfirmDeleteFolder(false)
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
          <button
            type="button"
            className={combining ? 'superchart-pill-button active' : 'superchart-pill-button'}
            aria-pressed={combining}
            title="Open 2 to 4 saved layouts together in one split view"
            onClick={() => (combining ? stopCombining() : setCombining(true))}
          >
            <SplitIcon count={4} /> Combine
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

        <div className="folder-bar" role="tablist" aria-label="Layout folders">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'folder-chip active' : 'folder-chip'} onClick={() => setFolderFilter('all')}>
            All <small>{layouts.length}</small>
          </button>
          {folders.groups.map((folder) => (
            renamingFolderId === folder.id ? (
              <input
                key={folder.id}
                className="folder-input"
                autoFocus
                maxLength={40}
                value={folderDraft}
                aria-label="Folder name"
                onChange={(event) => setFolderDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={commitFolderRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitFolderRename()
                  if (event.key === 'Escape') setRenamingFolderId(undefined)
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                key={folder.id}
                aria-selected={filter === folder.id}
                className={filter === folder.id ? 'folder-chip active' : 'folder-chip'}
                onClick={() => setFolderFilter(folder.id)}
              >
                <FolderIcon /> {folder.name} <small>{counts[folder.id] ?? 0}</small>
              </button>
            )
          ))}
          {unfiledCount > 0 && folders.groups.length > 0 && (
            <button type="button" role="tab" aria-selected={filter === 'none'} className={filter === 'none' ? 'folder-chip active' : 'folder-chip'} onClick={() => setFolderFilter('none')}>
              No folder <small>{unfiledCount}</small>
            </button>
          )}
          {newFolderName !== undefined ? (
            <input
              className="folder-input"
              autoFocus
              maxLength={40}
              placeholder="Folder name"
              value={newFolderName}
              aria-label="New folder name"
              onChange={(event) => setNewFolderName(event.target.value)}
              onBlur={() => (newFolderName.trim() ? commitNewFolder() : setNewFolderName(undefined))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitNewFolder()
                if (event.key === 'Escape') setNewFolderName(undefined)
              }}
            />
          ) : (
            <button type="button" className="folder-chip folder-add" onClick={() => setNewFolderName('')}>
              <PlusIcon /> New folder
            </button>
          )}
          {activeFolder && renamingFolderId !== activeFolder.id && (
            <span className="folder-actions" data-popover>
              <button type="button" onClick={() => { setRenamingFolderId(activeFolder.id); setFolderDraft(activeFolder.name) }}>Rename</button>
              <button
                type="button"
                className="danger"
                title="Layouts in the folder are kept"
                onClick={() => {
                  if (!confirmDeleteFolder) { setConfirmDeleteFolder(true); return }
                  setConfirmDeleteFolder(false)
                  setFolderFilter('all')
                  onFoldersChange(deleteFolder(folders, activeFolder.id))
                }}
              >
                {confirmDeleteFolder ? 'Click again to delete folder' : 'Delete folder'}
              </button>
            </span>
          )}
        </div>

        <div className="layout-card-grid">
          {!combining && (
            <button type="button" className="layout-card layout-card-create" onClick={onCreate}>
              <PlusIcon /> Create new layout
            </button>
          )}

          {visible.map((layout) => {
            const summary = layoutSummary(layout)
            const renaming = renamingId === layout.id
            const position = pickedIds.indexOf(layout.id)
            const full = combining && position < 0 && pickedIds.length >= MAX_COMBINED_LAYOUTS
            const cardClass = ['layout-card', layout.id === activeLayoutId ? 'current' : '', position >= 0 ? 'picked' : '', full ? 'pick-disabled' : ''].filter(Boolean).join(' ')
            return (
              <article className={cardClass} key={layout.id}>
                <button
                  type="button"
                  className="layout-card-open"
                  aria-label={combining ? `${position >= 0 ? 'Remove' : 'Add'} ${layout.name} ${position >= 0 ? 'from' : 'to'} the split view` : `Open ${layout.name}`}
                  aria-pressed={combining ? position >= 0 : undefined}
                  disabled={full}
                  onClick={() => (combining ? togglePick(layout.id) : onOpen(layout))}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                  onAuxClick={(event) => {
                    if (event.button !== 1 || combining) return
                    event.preventDefault()
                    onOpenInBackground(layout)
                  }}
                />
                {combining && <span className={position >= 0 ? 'layout-card-pick on' : 'layout-card-pick'} aria-hidden="true">{position >= 0 ? position + 1 : ''}</span>}
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
                  {summary.charts > 1 && <b className="layout-card-split" title={`${summary.charts} charts`}><SplitIcon count={summary.charts} /> {summary.charts}</b>}
                  {summary.symbol}, {summary.interval} • {formatLayoutDate(layout.updatedAtMs)}
                  {folders.assignments[layout.id] && filter === 'all' && <b className="layout-card-folder" title="Folder"><FolderIcon /> {folders.groups.find((folder) => folder.id === folders.assignments[layout.id])?.name}</b>}
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
                      <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onOpenInBackground(layout, true) }}>Open in new tab</button>
                      <button type="button" role="menuitem" onClick={() => startRename(layout)}>Rename</button>
                      <div className="menu-label">Move to folder</div>
                      {folders.groups.map((folder) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={folders.assignments[layout.id] === folder.id}
                          className={folders.assignments[layout.id] === folder.id ? 'selected' : ''}
                          key={folder.id}
                          onClick={() => { setMenuId(undefined); onFoldersChange(moveLayoutToFolder(folders, [layout.id], folder.id)) }}
                        >
                          {folder.name}
                        </button>
                      ))}
                      {folders.assignments[layout.id] && (
                        <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onFoldersChange(moveLayoutToFolder(folders, [layout.id], undefined)) }}>No folder</button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const name = globalThis.prompt('Name for the new folder')
                          setMenuId(undefined)
                          if (name && name.trim()) onFoldersChange(createFolder(folders, name, [layout.id]))
                        }}
                      >
                        + New folder…
                      </button>
                      <div className="menu-separator" />
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

        {combining && (
          <div className="combine-bar" role="region" aria-label="Open layouts together">
            <div className="combine-info">
              <SplitIcon count={Math.max(2, picked.length)} />
              <div>
                <strong>{picked.length < 2 ? 'Pick 2 to 4 layouts' : `${picked.length} layouts in one ${picked.length}-chart tab`}</strong>
                <span>Each layout contributes the chart it was saved with. The numbers show the order.</span>
              </div>
            </div>
            {picked.length > 0 && (
              <div className="combine-chips">
                {picked.map((layout, index) => {
                  const summary = layoutSummary(layout)
                  return (
                    <button type="button" className="combine-chip" key={layout.id} onClick={() => togglePick(layout.id)} aria-label={`Remove ${layout.name}`}>
                      <b>{index + 1}</b> {shortSymbol(summary.symbol)} {summary.interval} <CloseIcon />
                    </button>
                  )
                })}
              </div>
            )}
            <div className="combine-actions">
              <input
                value={splitName}
                maxLength={48}
                placeholder={autoName || 'Name (optional)'}
                aria-label="Name for the split view"
                onChange={(event) => setSplitName(event.target.value)}
              />
              <label className="combine-keep">
                <input type="checkbox" checked={keepSplit} onChange={(event) => setKeepSplit(event.target.checked)} />
                Keep for later
              </label>
              <button
                type="button"
                className="combine-open"
                disabled={picked.length < 2}
                onClick={() => onOpenTogether(picked, { name: splitName.trim() || autoName, save: keepSplit })}
              >
                Open split view
              </button>
              <button type="button" className="combine-cancel" onClick={stopCombining}>Cancel</button>
            </div>
          </div>
        )}

        {visible.length === 0 && (
          <p className="superchart-empty">
            {layouts.length === 0
              ? 'No saved layouts yet. Create one, or use Save in the chart toolbar.'
              : query.trim() ? `No layouts match “${query.trim()}”.` : 'No layouts in this folder yet. Use ⋮ on a layout and pick Move to folder.'}
          </p>
        )}
      </div>
    </section>
  )
}
