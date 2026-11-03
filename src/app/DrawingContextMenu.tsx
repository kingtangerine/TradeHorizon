import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CopyIcon, EyeOffIcon, LockIcon, SettingsIcon, TrashIcon, UnlockIcon } from './Icons'

// Right-click menu on a drawing (TradingView): settings, clone, lock, hide, timeframe visibility, delete.

interface DrawingContextMenuProps {
  left: number
  top: number
  locked: boolean
  /** More than one drawing is selected: the actions apply to all of them. */
  count: number
  onSettings(): void
  onVisibility(): void
  onClone(): void
  onLock(): void
  onHide(): void
  onDelete(): void
  onClose(): void
}

export function DrawingContextMenu({ left, top, locked, count, onSettings, onVisibility, onClone, onLock, onHide, onDelete, onClose }: DrawingContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: Event) => { if (!(event.target instanceof Node && ref.current?.contains(event.target))) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    globalThis.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape)
      globalThis.removeEventListener('blur', onClose)
    }
  }, [onClose])
  const run = (action: () => void) => () => { action(); onClose() }
  const single = count <= 1
  const style = { left: Math.min(left, globalThis.innerWidth - 230), top: Math.min(top, globalThis.innerHeight - 260) }
  return createPortal(
    <div ref={ref} className="chart-context-menu drawing-context-menu" role="menu" style={style} onContextMenu={(event) => event.preventDefault()}>
      {!single && <div className="context-menu-title">{count} drawings selected</div>}
      {single && <button type="button" role="menuitem" onClick={run(onSettings)}><SettingsIcon /> Settings…</button>}
      {single && <button type="button" role="menuitem" onClick={run(onVisibility)}><EyeOffIcon /> Visibility on timeframes…</button>}
      <button type="button" role="menuitem" onClick={run(onClone)}><CopyIcon /> Clone <kbd>Ctrl+D</kbd></button>
      <button type="button" role="menuitem" onClick={run(onLock)}>{locked ? <UnlockIcon /> : <LockIcon />} {locked ? 'Unlock' : 'Lock'}</button>
      <button type="button" role="menuitem" onClick={run(onHide)}><EyeOffIcon /> Hide</button>
      <button type="button" role="menuitem" className="danger" onClick={run(onDelete)}><TrashIcon /> {single ? 'Remove' : `Remove ${count} drawings`} <kbd>Del</kbd></button>
    </div>,
    document.body,
  )
}
