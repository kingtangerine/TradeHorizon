import type { Dispatch, SetStateAction } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import { TOOL_GROUPS } from '../../chart/tools'
import type { ChartConnectionState } from '../../chart/types'
import type { DrawingStore, DrawingStoreSnapshot, DrawingType } from '../../drawings'
import { CursorIcon, EyeIcon, EyeOffIcon, LockIcon, MagnetIcon, PencilLockIcon, RedoIcon, TrashIcon, UndoIcon, UnlockIcon } from '../Icons'
import { ToolGroup } from '../ToolGroup'
import type { UserWorkspace } from '../workspace'
import { TOOL_ICONS } from './toolIcons'

interface ToolRailProps {
  activeTool: 'cursor' | DrawingType
  /** The last tool used in each group, which its button shows. */
  groupTools: Record<string, DrawingType>
  chooseCursor(): void
  chooseTool(type: DrawingType): void
  controller: KLineChartController | null
  connection: ChartConnectionState
  workspace: UserWorkspace
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>
  drawingStore: DrawingStore
  drawingSnapshot: DrawingStoreSnapshot
  selectedDrawingId: string | undefined
}

/** Left rail: pointer and drawing tools, magnet and drawing-mode toggles, undo, redo and delete. */
export function ToolRail({
  activeTool,
  groupTools,
  chooseCursor,
  chooseTool,
  controller,
  connection,
  workspace,
  setWorkspace,
  drawingStore,
  drawingSnapshot,
  selectedDrawingId,
}: ToolRailProps) {
  return (
    <aside className="tool-rail" aria-label="Drawing tools">
      <button
        type="button"
        className={activeTool === 'cursor' ? 'tool-button active' : 'tool-button'}
        aria-label="Pointer tool"
        title="Pointer (Esc)"
        onClick={chooseCursor}
      >
        <CursorIcon />
      </button>
      {TOOL_GROUPS.map((group) => (
        <ToolGroup
          key={group.id}
          label={group.label}
          tools={group.tools}
          shown={group.tools.includes(activeTool as DrawingType) ? (activeTool as DrawingType) : (groupTools[group.id] ?? group.tools[0])}
          activeTool={activeTool}
          icons={TOOL_ICONS}
          disabled={!controller || connection === 'error'}
          onChoose={chooseTool}
          onCursor={chooseCursor}
        />
      ))}

      <span className="tool-divider" />

      <button
        type="button"
        className={workspace.magnet ? 'tool-button active' : 'tool-button'}
        aria-label="Magnet: snap to candle open, high, low, close"
        aria-pressed={!!workspace.magnet}
        title={workspace.magnet ? 'Magnet on: points snap to OHLC' : 'Magnet off: free placement'}
        onClick={() =>
          setWorkspace((current) => {
            const { magnet, ...rest } = current
            return magnet ? rest : { ...rest, magnet: true }
          })
        }
      >
        <MagnetIcon />
      </button>
      <button
        type="button"
        className={workspace.stayInDrawingMode ? 'tool-button active' : 'tool-button'}
        aria-label="Stay in drawing mode"
        aria-pressed={!!workspace.stayInDrawingMode}
        title={
          workspace.stayInDrawingMode
            ? 'Stay in drawing mode: on (the tool stays selected after each drawing)'
            : 'Stay in drawing mode: off'
        }
        onClick={() =>
          setWorkspace((current) => {
            const { stayInDrawingMode, ...rest } = current
            return stayInDrawingMode ? rest : { ...rest, stayInDrawingMode: true }
          })
        }
      >
        <PencilLockIcon />
      </button>
      <button
        type="button"
        className={workspace.lockAllDrawings ? 'tool-button active' : 'tool-button'}
        aria-label="Lock all drawings"
        aria-pressed={!!workspace.lockAllDrawings}
        title={workspace.lockAllDrawings ? 'All drawings locked' : 'Lock all drawings'}
        onClick={() =>
          setWorkspace((current) => {
            const { lockAllDrawings, ...rest } = current
            return lockAllDrawings ? rest : { ...rest, lockAllDrawings: true }
          })
        }
      >
        {workspace.lockAllDrawings ? <LockIcon /> : <UnlockIcon />}
      </button>
      <button
        type="button"
        className={workspace.hideAllDrawings ? 'tool-button active' : 'tool-button'}
        aria-label="Hide all drawings"
        aria-pressed={!!workspace.hideAllDrawings}
        title={workspace.hideAllDrawings ? 'Show all drawings' : 'Hide all drawings'}
        onClick={() =>
          setWorkspace((current) => {
            const { hideAllDrawings, ...rest } = current
            return hideAllDrawings ? rest : { ...rest, hideAllDrawings: true }
          })
        }
      >
        {workspace.hideAllDrawings ? <EyeOffIcon /> : <EyeIcon />}
      </button>

      <span className="tool-divider" />

      <button
        type="button"
        className="tool-button"
        aria-label="Undo drawing change"
        title="Undo (Ctrl+Z)"
        onClick={() => drawingStore.undo()}
        disabled={!drawingSnapshot.canUndo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="tool-button"
        aria-label="Redo drawing change"
        title="Redo (Ctrl+Y)"
        onClick={() => drawingStore.redo()}
        disabled={!drawingSnapshot.canRedo}
      >
        <RedoIcon />
      </button>
      <button
        type="button"
        className="tool-button danger"
        aria-label="Delete selected drawing"
        title="Delete selected drawing"
        onClick={() => controller?.deleteSelected()}
        disabled={!selectedDrawingId}
      >
        <TrashIcon />
      </button>
    </aside>
  )
}
