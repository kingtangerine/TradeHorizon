import { batchDrawings, updateDrawing, type Drawing, type DrawingStore } from '../../drawings'
import { dcaToggleChanges, isPositionTool } from './workspaceHelpers'

/** Edits the drawing toolbars make to the selected drawing or the multi-selection (each one is an undo step). */
export interface DrawingEdits {
  /** Adds or removes the DCA line of the selected position. */
  toggleDca(): void
  /** Lock or hide every drawing of the multi-selection (locking unlocks all when all were locked). */
  setGroupFlag(flag: 'locked' | 'hidden'): void
  /** Merges style changes into the selected drawing. */
  updateSelectedStyle(changes: Record<string, string | number | boolean>): void
}

/** The drawing toolbar actions for the current selection. */
export function drawingEdits(
  drawingStore: DrawingStore,
  drawings: readonly Drawing[],
  selectedDrawing: Drawing | undefined,
  multiSelection: readonly string[],
): DrawingEdits {
  const toggleDca = () => {
    if (!selectedDrawing || !isPositionTool(selectedDrawing.type)) return
    drawingStore.execute(updateDrawing(selectedDrawing.id, dcaToggleChanges(selectedDrawing)))
  }

  const setGroupFlag = (flag: 'locked' | 'hidden') => {
    const selected = drawings.filter((drawing) => multiSelection.includes(drawing.id))
    const value = flag === 'hidden' ? true : !selected.every((drawing) => drawing.locked)
    drawingStore.execute(batchDrawings(selected.map((drawing) => updateDrawing(drawing.id, { [flag]: value }))))
  }

  const updateSelectedStyle = (changes: Record<string, string | number | boolean>) => {
    if (!selectedDrawing) return
    drawingStore.execute(
      updateDrawing(selectedDrawing.id, {
        style: { ...selectedDrawing.style, ...changes },
      }),
    )
  }

  return { toggleDca, setGroupFlag, updateSelectedStyle }
}
