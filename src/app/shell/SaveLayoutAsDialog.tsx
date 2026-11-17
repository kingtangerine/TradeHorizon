import type { Dispatch, SetStateAction } from 'react'
import { CloseIcon, LayersIcon } from '../Icons'

interface SaveLayoutAsDialogProps {
  layoutDraftName: string
  setLayoutDraftName: Dispatch<SetStateAction<string>>
  saveCurrentLayout(name?: string, forceNew?: boolean): void
  setSaveAsOpen: Dispatch<SetStateAction<boolean>>
}

/** "Save layout as" window: saves the open layout as a new copy under another name. */
export function SaveLayoutAsDialog({ layoutDraftName, setLayoutDraftName, saveCurrentLayout, setSaveAsOpen }: SaveLayoutAsDialogProps) {
  return (
    <div className="superchart-backdrop" role="presentation" onMouseDown={() => setSaveAsOpen(false)}>
      <form
        className="compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-layout-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          saveCurrentLayout(layoutDraftName, true)
          setSaveAsOpen(false)
        }}
      >
        <header>
          <div>
            <LayersIcon />
            <h2 id="save-layout-title">Save layout as</h2>
          </div>
          <button type="button" onClick={() => setSaveAsOpen(false)} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <label>
          <span>Layout name</span>
          <input autoFocus required maxLength={48} value={layoutDraftName} onChange={(event) => setLayoutDraftName(event.target.value)} />
        </label>
        <footer>
          <button type="button" onClick={() => setSaveAsOpen(false)}>
            Cancel
          </button>
          <button type="submit">Save copy</button>
        </footer>
      </form>
    </div>
  )
}
