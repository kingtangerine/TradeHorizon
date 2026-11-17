import type { Dispatch, SetStateAction } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import { displaySymbol, type CryptoMarket } from '../../chart/markets'
import { deleteDrawing, updateDrawing, type Drawing, type DrawingStore } from '../../drawings'
import type { MarketInterval } from '../../market'
import type { GroupState } from '../groups'
import { CloseIcon, EyeIcon, EyeOffIcon, FolderIcon, LayersIcon } from '../Icons'
import { ObjectList } from '../ObjectList'
import { TOOL_ICONS } from './toolIcons'
import { marketKindLabel } from './workspaceHelpers'

interface ObjectTreePanelProps {
  /** Drawings of the active chart's market. */
  marketDrawings: readonly Drawing[]
  market: CryptoMarket
  interval: MarketInterval
  selectedDrawingId: string | undefined
  groupState: GroupState
  setGroupState: Dispatch<SetStateAction<GroupState>>
  groupSelectMode: boolean
  setGroupSelectMode: Dispatch<SetStateAction<boolean>>
  setObjectTreeOpen: Dispatch<SetStateAction<boolean>>
  controller: KLineChartController | null
  drawingStore: DrawingStore
}

/** Right-hand object tree: the drawings on the active market, with folders, show/hide and delete. */
export function ObjectTreePanel({
  marketDrawings,
  market,
  interval,
  selectedDrawingId,
  groupState,
  setGroupState,
  groupSelectMode,
  setGroupSelectMode,
  setObjectTreeOpen,
  controller,
  drawingStore,
}: ObjectTreePanelProps) {
  const allDrawingsHidden = marketDrawings.length > 0 && marketDrawings.every((drawing) => drawing.hidden)
  return (
    <aside className="object-tree" aria-label="Object tree">
      <header className="object-tree-header">
        <div>
          <LayersIcon />
          <strong>Object tree</strong>
          <span>{marketDrawings.length}</span>
        </div>
        {marketDrawings.length > 0 && (
          <button
            type="button"
            className={groupSelectMode ? 'object-icon-button active' : 'object-icon-button'}
            aria-label="Group objects"
            aria-pressed={groupSelectMode}
            title="Group objects into folders"
            onClick={() => setGroupSelectMode((on) => !on)}
          >
            <FolderIcon />
          </button>
        )}
        {marketDrawings.length > 0 && (
          <button
            type="button"
            className="object-icon-button"
            aria-label={allDrawingsHidden ? 'Show all drawings' : 'Hide all drawings'}
            title={allDrawingsHidden ? 'Show all drawings' : 'Hide all drawings'}
            onClick={() => {
              for (const drawing of marketDrawings) {
                if (!!drawing.hidden === allDrawingsHidden) {
                  drawingStore.execute(updateDrawing(drawing.id, { hidden: !allDrawingsHidden }))
                }
              }
            }}
          >
            {allDrawingsHidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
        <button
          type="button"
          className="object-icon-button"
          aria-label="Close object tree"
          title="Close object tree"
          onClick={() => setObjectTreeOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="object-market-row">
        <span className="object-market-symbol">{market.mark}</span>
        <div>
          <strong>{displaySymbol(market.symbol)}</strong>
          <span>
            {market.venue} {marketKindLabel(market)} · {interval}
          </span>
        </div>
      </div>

      <ObjectList
        drawings={marketDrawings}
        selectedId={selectedDrawingId}
        groupState={groupState}
        icons={TOOL_ICONS}
        selectMode={groupSelectMode}
        onSelectModeChange={setGroupSelectMode}
        onGroupState={setGroupState}
        onFocus={(id) => controller?.focusDrawing(id)}
        onSetHidden={(ids, hidden) => {
          for (const id of ids) {
            const drawing = marketDrawings.find((item) => item.id === id)
            if (drawing && !!drawing.hidden !== hidden) drawingStore.execute(updateDrawing(id, { hidden }))
          }
        }}
        onDelete={(id) => drawingStore.execute(deleteDrawing(id))}
      />
    </aside>
  )
}
