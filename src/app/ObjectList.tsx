import { useState } from 'react'
import { DRAWING_TOOLS } from '../chart/tools'
import type { Drawing, DrawingType } from '../drawings'
import { ChevronIcon, EyeIcon, EyeOffIcon, FolderIcon, TrashIcon } from './Icons'
import {
  assignToGroup,
  createGroup,
  deleteGroup,
  renameGroup,
  toggleGroupCollapsed,
  type GroupState,
} from './groups'

type IconComponent = (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element

interface ObjectListProps {
  /** Drawings of the open market, oldest first. */
  drawings: readonly Drawing[]
  selectedId?: string
  groupState: GroupState
  icons: Readonly<Record<DrawingType, IconComponent>>
  selectMode: boolean
  onSelectModeChange(next: boolean): void
  onGroupState(next: GroupState): void
  onFocus(id: string): void
  onSetHidden(ids: readonly string[], hidden: boolean): void
  onDelete(id: string): void
}

/** Object tree body: user folders first, then ungrouped objects, newest on top. */
export function ObjectList({
  drawings,
  selectedId,
  groupState,
  icons,
  selectMode,
  onSelectModeChange,
  onGroupState,
  onFocus,
  onSetHidden,
  onDelete,
}: ObjectListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')

  const numbered = drawings.map((drawing, index) => ({ drawing, number: index + 1 })).reverse()
  const inGroup = (groupId: string) => numbered.filter(({ drawing }) => groupState.assignments[drawing.id] === groupId)
  const ungrouped = numbered.filter(({ drawing }) => !groupState.assignments[drawing.id])
  const checkedIds = drawings.filter((drawing) => checked.has(drawing.id)).map((drawing) => drawing.id)

  const toggleChecked = (id: string) => setChecked((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const finishSelecting = () => {
    setChecked(new Set())
    setNewName('')
    onSelectModeChange(false)
  }

  const row = ({ drawing, number }: { drawing: Drawing, number: number }, nested: boolean) => {
    const label = DRAWING_TOOLS[drawing.type].label
    const Icon = icons[drawing.type]
    const detail = drawing.type === 'text' && typeof drawing.style.text === 'string' ? drawing.style.text : `#${number}`
    const classes = ['object-row', drawing.id === selectedId ? 'selected' : '', nested ? 'nested' : '', selectMode ? 'selecting' : '']
    return (
      <div
        className={classes.filter(Boolean).join(' ')}
        key={drawing.id}
        onClick={() => (selectMode ? toggleChecked(drawing.id) : onFocus(drawing.id))}
      >
        {selectMode
          ? <input type="checkbox" checked={checked.has(drawing.id)} onChange={() => toggleChecked(drawing.id)} aria-label={`Select ${label.toLowerCase()} ${number}`} onClick={(event) => event.stopPropagation()} />
          : <Icon />}
        <button type="button" className="object-name" title={`Focus ${label.toLowerCase()}`} onClick={(event) => { if (selectMode) return; event.stopPropagation(); onFocus(drawing.id) }}>
          <span>{label}</span>
          <small>{detail}</small>
        </button>
        <button
          type="button"
          className="object-icon-button"
          aria-label={`${drawing.hidden ? 'Show' : 'Hide'} ${label.toLowerCase()}`}
          title={drawing.hidden ? 'Show object' : 'Hide object'}
          onClick={(event) => { event.stopPropagation(); onSetHidden([drawing.id], !drawing.hidden) }}
        >
          {drawing.hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          className="object-icon-button delete"
          aria-label={`Delete ${label.toLowerCase()}`}
          title="Delete object"
          onClick={(event) => { event.stopPropagation(); onDelete(drawing.id) }}
        >
          <TrashIcon />
        </button>
      </div>
    )
  }

  const commitRename = (groupId: string) => {
    onGroupState(renameGroup(groupState, groupId, editName))
    setEditingId(undefined)
  }

  return (
    <>
      <div className="object-list">
        {groupState.groups.map((group) => {
          const members = inGroup(group.id)
          const allHidden = members.length > 0 && members.every(({ drawing }) => drawing.hidden)
          return (
            <div className="object-group" key={group.id}>
              <div className="object-group-header">
                <button
                  type="button"
                  className={group.collapsed ? 'object-icon-button collapsed' : 'object-icon-button'}
                  aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                  aria-expanded={!group.collapsed}
                  onClick={() => onGroupState(toggleGroupCollapsed(groupState, group.id))}
                >
                  <ChevronIcon />
                </button>
                <FolderIcon />
                {editingId === group.id ? (
                  <input
                    className="object-group-input"
                    autoFocus
                    value={editName}
                    maxLength={40}
                    aria-label="Group name"
                    onChange={(event) => setEditName(event.target.value)}
                    onBlur={() => commitRename(group.id)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') commitRename(group.id)
                      if (event.key === 'Escape') setEditingId(undefined)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="object-name"
                    title="Click to rename"
                    onClick={() => { setEditingId(group.id); setEditName(group.name) }}
                  >
                    <span>{group.name}</span>
                    <small>{members.length}</small>
                  </button>
                )}
                {members.length > 0 && (
                  <button
                    type="button"
                    className="object-icon-button"
                    aria-label={allHidden ? `Show all in ${group.name}` : `Hide all in ${group.name}`}
                    title={allHidden ? 'Show group' : 'Hide group'}
                    onClick={() => onSetHidden(members.map(({ drawing }) => drawing.id), !allHidden)}
                  >
                    {allHidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                )}
                <button
                  type="button"
                  className="object-icon-button delete"
                  aria-label={`Ungroup ${group.name}`}
                  title="Delete group (objects are kept)"
                  onClick={() => onGroupState(deleteGroup(groupState, group.id))}
                >
                  <TrashIcon />
                </button>
              </div>
              {!group.collapsed && members.map((entry) => row(entry, true))}
              {!group.collapsed && members.length === 0 && <div className="object-group-empty">Empty. Use Group objects to add some.</div>}
            </div>
          )
        })}

        {ungrouped.map((entry) => row(entry, false))}

        {drawings.length === 0 && (
          <div className="object-tree-empty">
            <FolderIcon />
            <strong>No drawing objects</strong>
            <span>Pick a tool on the left, then click or drag on the chart.</span>
          </div>
        )}
      </div>

      {selectMode && (
        <div className="object-group-bar" role="group" aria-label="Group objects">
          <strong>{checkedIds.length} selected</strong>
          <div className="object-group-create">
            <input
              value={newName}
              maxLength={40}
              placeholder="New group name"
              aria-label="New group name"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              disabled={checkedIds.length === 0}
              onClick={() => { onGroupState(createGroup(groupState, newName, checkedIds)); finishSelecting() }}
            >
              Create group
            </button>
          </div>
          {groupState.groups.length > 0 && (
            <select
              aria-label="Move selected to group"
              disabled={checkedIds.length === 0}
              value=""
              onChange={(event) => {
                const value = event.target.value
                if (!value) return
                onGroupState(assignToGroup(groupState, checkedIds, value === '__none' ? undefined : value))
                finishSelecting()
              }}
            >
              <option value="">Move to existing group…</option>
              {groupState.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
              <option value="__none">Remove from group</option>
            </select>
          )}
          <button type="button" className="object-group-done" onClick={finishSelecting}>Done</button>
        </div>
      )}
    </>
  )
}
