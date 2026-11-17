import type { Dispatch, SetStateAction } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import type { CryptoMarket } from '../../chart/markets'
import { batchDrawings, deleteDrawing, updateDrawing, type Drawing, type DrawingStore } from '../../drawings'
import type { AlertOptions } from '../alerts'
import { DrawingContextMenu } from '../DrawingContextMenu'
import { DrawingSettingsDialog, type DrawingSettingsTab } from '../DrawingSettingsDialog'
import { isPositionTool, trendLineAlert } from './workspaceHelpers'

interface DrawingDialogsProps {
  drawings: readonly Drawing[]
  multiSelection: readonly string[]
  /** The drawing whose settings window is open, and its tab. */
  drawingSettings: { id: string; tab: DrawingSettingsTab } | undefined
  setDrawingSettings: Dispatch<SetStateAction<{ id: string; tab: DrawingSettingsTab } | undefined>>
  /** The drawing whose right-click menu is open, and where. */
  drawingMenu: { id: string; left: number; top: number } | undefined
  setDrawingMenu: Dispatch<SetStateAction<{ id: string; left: number; top: number } | undefined>>
  setPositionSettingsOpen: Dispatch<SetStateAction<boolean>>
  chartTimeZone: string
  market: CryptoMarket
  /** Latest price of the active chart. */
  quoteClose: number | undefined
  createAlert(options: AlertOptions, symbol: string): void
  showToast(message: string): void
  controller: KLineChartController | null
  drawingStore: DrawingStore
}

/** A drawing's settings window (double-click) and its right-click menu. */
export function DrawingDialogs({
  drawings,
  multiSelection,
  drawingSettings,
  setDrawingSettings,
  drawingMenu,
  setDrawingMenu,
  setPositionSettingsOpen,
  chartTimeZone,
  market,
  quoteClose,
  createAlert,
  showToast,
  controller,
  drawingStore,
}: DrawingDialogsProps) {
  return (
    <>
      {drawingSettings && drawings.some((drawing) => drawing.id === drawingSettings.id) && (
        <DrawingSettingsDialog
          key={drawingSettings.id + drawingSettings.tab}
          drawing={drawings.find((drawing) => drawing.id === drawingSettings.id)!}
          timeZone={chartTimeZone}
          pricePrecision={market.pricePrecision}
          initialTab={drawingSettings.tab}
          onUpdate={(changes) => drawingStore.execute(updateDrawing(drawingSettings.id, changes))}
          onClose={() => setDrawingSettings(undefined)}
        />
      )}

      {drawingMenu &&
        (() => {
          const drawing = drawings.find((item) => item.id === drawingMenu.id)
          if (!drawing) return null
          const group = multiSelection.length > 1 && multiSelection.includes(drawing.id)
          const ids = group ? [...multiSelection] : [drawing.id]
          const targets = drawings.filter((item) => ids.includes(item.id))
          const locked = targets.every((item) => item.locked)
          const single = ids.length === 1
          return (
            <DrawingContextMenu
              left={drawingMenu.left}
              top={drawingMenu.top}
              locked={locked}
              count={ids.length}
              onSettings={() =>
                isPositionTool(drawing.type) ? setPositionSettingsOpen(true) : setDrawingSettings({ id: drawing.id, tab: 'style' })
              }
              onVisibility={() => setDrawingSettings({ id: drawing.id, tab: 'visibility' })}
              onAddAlert={
                single && (drawing.type === 'trendLine' || drawing.type === 'ray')
                  ? () => {
                      const { options, target } = trendLineAlert(drawing, market.symbol, market.pricePrecision, quoteClose, Date.now())
                      createAlert(options, market.symbol)
                      showToast(`Alert on the trend line: fires when the price crosses it (now ${target.toFixed(market.pricePrecision)}).`)
                    }
                  : undefined
              }
              onClone={() => {
                for (const id of ids) controller?.cloneDrawing(id)
              }}
              onLock={() => drawingStore.execute(batchDrawings(targets.map((item) => updateDrawing(item.id, { locked: !locked }))))}
              onHide={() => drawingStore.execute(batchDrawings(targets.map((item) => updateDrawing(item.id, { hidden: true }))))}
              onDelete={() => (group ? controller?.deleteSelected() : drawingStore.execute(deleteDrawing(drawing.id)))}
              onClose={() => setDrawingMenu(undefined)}
            />
          )
        })()}
    </>
  )
}
