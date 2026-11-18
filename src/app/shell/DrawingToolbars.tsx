import type { Dispatch, SetStateAction } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import { DRAWING_TOOLS } from '../../chart/tools'
import { deleteDrawing, updateDrawing, type Drawing, type DrawingStore, type DrawingType } from '../../drawings'
import { ColorPicker } from '../ColorPicker'
import { CloseIcon, CopyIcon, EyeIcon, EyeOffIcon, LockIcon, MidlineIcon, SettingsIcon, TrashIcon, UnlockIcon } from '../Icons'
import { RectangleTemplates } from '../RectangleTemplates'
import { rectangleStyleOf, type TemplateState } from '../templates'
import { CommittedTextInput } from './CommittedTextInput'
import { TOOL_ICONS } from './toolIcons'
import { isTouchDevice, touchHint } from '../../platform/input'
import { colorInputValue, isPositionTool, styleNumber } from './workspaceHelpers'

/** Hint over the chart while a drawing tool is active: how to place it (worded for touch on a phone), and Esc to cancel. */
export function DrawingHint({ tool }: { tool: DrawingType }) {
  const Icon = TOOL_ICONS[tool]
  const hint = DRAWING_TOOLS[tool].hint
  return (
    <div className="drawing-hint" role="status">
      <Icon />
      {isTouchDevice() ? touchHint(hint) : hint}
      <kbd>Esc</kbd>
    </div>
  )
}

/** Floating toolbar for a selection of several drawings: clone, lock, hide, delete, clear. */
export function MultiSelectionToolbar({
  multiSelection,
  controller,
  setGroupFlag,
}: {
  multiSelection: readonly string[]
  controller: KLineChartController | null
  setGroupFlag(flag: 'locked' | 'hidden'): void
}) {
  return (
    <div className="floating-object-toolbar" role="toolbar" aria-label="Selected drawings">
      <span className="toolbar-grip" aria-hidden="true" />
      <strong className="toolbar-count">{multiSelection.length} drawings</strong>
      <span className="toolbar-separator" />
      <button
        type="button"
        className="toolbar-action"
        aria-label="Clone selected drawings"
        title="Clone"
        onClick={() => {
          for (const id of multiSelection) controller?.cloneDrawing(id)
        }}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className="toolbar-action"
        aria-label="Lock selected drawings"
        title="Lock or unlock all"
        onClick={() => setGroupFlag('locked')}
      >
        <LockIcon />
      </button>
      <button
        type="button"
        className="toolbar-action"
        aria-label="Hide selected drawings"
        title="Hide"
        onClick={() => setGroupFlag('hidden')}
      >
        <EyeOffIcon />
      </button>
      <button
        type="button"
        className="toolbar-action delete"
        aria-label="Delete selected drawings"
        title="Delete (Del)"
        onClick={() => controller?.deleteSelected()}
      >
        <TrashIcon />
      </button>
      <button
        type="button"
        className="toolbar-action"
        aria-label="Clear selection"
        title="Clear selection"
        onClick={() => {
          controller?.clearSelection()
          controller?.clearDrawingSelection()
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

interface SelectedDrawingToolbarProps {
  selectedDrawing: Drawing
  controller: KLineChartController | null
  drawingStore: DrawingStore
  positionSettingsOpen: boolean
  setPositionSettingsOpen: Dispatch<SetStateAction<boolean>>
  /** Opens the full settings window of the selected drawing (what a double-click does with a mouse). */
  openSettings(): void
  toggleDca(): void
  updateSelectedStyle(changes: Record<string, string | number | boolean>): void
  templateState: TemplateState
  setTemplateState: Dispatch<SetStateAction<TemplateState>>
}

/** Floating toolbar of the selected drawing: its main style settings, then clone, hide, lock, delete and close. */
export function SelectedDrawingToolbar({
  selectedDrawing,
  controller,
  drawingStore,
  positionSettingsOpen,
  setPositionSettingsOpen,
  openSettings,
  toggleDca,
  updateSelectedStyle,
  templateState,
  setTemplateState,
}: SelectedDrawingToolbarProps) {
  return (
    <div className="floating-object-toolbar" role="toolbar" aria-label="Selected object properties">
      <span className="toolbar-grip" aria-hidden="true" />
      <div className="toolbar-object-type" title={DRAWING_TOOLS[selectedDrawing.type].label}>
        {(() => {
          const Icon = TOOL_ICONS[selectedDrawing.type]
          return <Icon />
        })()}
      </div>
      <span className="toolbar-separator" />

      {isPositionTool(selectedDrawing.type) ? (
        <>
          <label className="toolbar-color-control" title="Target color">
            <ColorPicker
              label="Target color"
              value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')}
              onChange={(color) => updateSelectedStyle({ targetColor: color })}
            />
          </label>
          <label className="toolbar-color-control" title="Stop color">
            <ColorPicker
              label="Stop color"
              value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')}
              onChange={(color) => updateSelectedStyle({ stopColor: color })}
            />
          </label>
          <select
            className="toolbar-select thickness-select line-thickness"
            aria-label="Line thickness"
            title="Line thickness"
            value={styleNumber(selectedDrawing.style.lineWidth, 1)}
            onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((width) => (
              <option value={width} key={width}>
                {width}px
              </option>
            ))}
          </select>
          <button
            type="button"
            className={positionSettingsOpen ? 'toolbar-action active' : 'toolbar-action'}
            aria-label="Position settings"
            title="Position settings"
            onClick={() => setPositionSettingsOpen((open) => !open)}
          >
            <SettingsIcon />
          </button>
          <button
            type="button"
            className={selectedDrawing.anchors.length > 3 ? 'toolbar-action text-action active' : 'toolbar-action text-action'}
            aria-pressed={selectedDrawing.anchors.length > 3}
            title={selectedDrawing.anchors.length > 3 ? 'Remove the DCA line' : 'Add a DCA (second buy) line'}
            onClick={toggleDca}
          >
            DCA
          </button>
          {selectedDrawing.anchors.length > 3 && (
            <label className="toolbar-check" title="Tick when the DCA order has filled, to show the average entry">
              <input
                type="checkbox"
                checked={selectedDrawing.style.dcaTriggered === true}
                onChange={(event) => updateSelectedStyle({ dcaTriggered: event.target.checked })}
              />
              <span>Triggered</span>
            </label>
          )}
        </>
      ) : selectedDrawing.type === 'text' ? (
        <>
          <CommittedTextInput
            label="Text"
            value={typeof selectedDrawing.style.text === 'string' ? selectedDrawing.style.text : 'Text'}
            onCommit={(text) => updateSelectedStyle({ text })}
          />
          <ColorPicker
            label="Text color"
            value={colorInputValue(selectedDrawing.style.color, '#2962ff')}
            onChange={(color) => updateSelectedStyle({ color })}
          />
          <select
            className="toolbar-select thickness-select"
            aria-label="Font size"
            title="Font size"
            value={styleNumber(selectedDrawing.style.fontSize, 14)}
            onChange={(event) => updateSelectedStyle({ fontSize: Number(event.target.value) })}
          >
            {[10, 12, 14, 16, 20, 24, 32, 48].map((size) => (
              <option value={size} key={size}>
                {size}px
              </option>
            ))}
          </select>
          <button
            type="button"
            className={selectedDrawing.style.bold === true ? 'toolbar-action active' : 'toolbar-action'}
            aria-label="Bold"
            title="Bold"
            aria-pressed={selectedDrawing.style.bold === true}
            onClick={() => updateSelectedStyle({ bold: selectedDrawing.style.bold !== true })}
          >
            <b>B</b>
          </button>
        </>
      ) : (
        <>
          {selectedDrawing.type !== 'fibRetracement' && selectedDrawing.type !== 'priceRange' && (
            <label className="toolbar-color-control" title="Line color">
              {selectedDrawing.type === 'rectangle' ? (
                <ColorPicker
                  label="Line color"
                  value={colorInputValue(selectedDrawing.style.color, '#3aa9ff')}
                  none={selectedDrawing.style.noBorder === true}
                  onNone={() => updateSelectedStyle({ noBorder: true })}
                  onChange={(color) => updateSelectedStyle({ color, noBorder: false })}
                />
              ) : (
                <ColorPicker
                  label="Line color"
                  value={colorInputValue(selectedDrawing.style.color, '#f4b860')}
                  onChange={(color) => updateSelectedStyle({ color: color })}
                />
              )}
            </label>
          )}
          <select
            className="toolbar-select thickness-select line-thickness"
            aria-label="Line thickness"
            title="Line thickness"
            value={styleNumber(selectedDrawing.style.lineWidth, 2)}
            onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((width) => (
              <option value={width} key={width}>
                {width}px
              </option>
            ))}
          </select>
          <select
            className="toolbar-select style-select"
            aria-label="Line style"
            title="Line style"
            value={selectedDrawing.style.lineStyle === 'dashed' ? 'dashed' : 'solid'}
            onChange={(event) => updateSelectedStyle({ lineStyle: event.target.value })}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
          {selectedDrawing.type === 'rectangle' && (
            <>
              <span className="toolbar-separator" />
              <button
                type="button"
                className={selectedDrawing.style.midline === true ? 'toolbar-action active' : 'toolbar-action'}
                aria-label="Middle line"
                title="Draw a horizontal line through the middle"
                aria-pressed={selectedDrawing.style.midline === true}
                onClick={() => updateSelectedStyle({ midline: selectedDrawing.style.midline !== true })}
              >
                <MidlineIcon />
              </button>
              <RectangleTemplates
                state={templateState}
                current={rectangleStyleOf(selectedDrawing.style)}
                onApply={(style) => updateSelectedStyle({ ...style })}
                onChange={setTemplateState}
              />
              <label className="toolbar-color-control fill-control" title="Fill color">
                <ColorPicker
                  label="Rectangle fill color"
                  value={colorInputValue(selectedDrawing.style.fillColor, '#3aa9ff')}
                  onChange={(color) => updateSelectedStyle({ fillColor: color })}
                />
              </label>
              <label className="toolbar-opacity" title="Fill opacity">
                <span>{styleNumber(selectedDrawing.style.fillOpacity, 14)}%</span>
                <input
                  type="range"
                  aria-label="Rectangle fill opacity"
                  min="0"
                  max="100"
                  step="1"
                  value={styleNumber(selectedDrawing.style.fillOpacity, 14)}
                  onChange={(event) => updateSelectedStyle({ fillOpacity: Number(event.target.value) })}
                />
              </label>
            </>
          )}
        </>
      )}

      <span className="toolbar-separator" />
      {!isPositionTool(selectedDrawing.type) && (
        <button type="button" className="toolbar-action" aria-label="Drawing settings" title="Settings…" onClick={openSettings}>
          <SettingsIcon />
        </button>
      )}
      <button
        type="button"
        className="toolbar-action"
        aria-label="Clone object"
        title="Clone (Ctrl+D)"
        onClick={() => controller?.cloneDrawing(selectedDrawing.id)}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className={selectedDrawing.hidden ? 'toolbar-action active' : 'toolbar-action'}
        aria-label={selectedDrawing.hidden ? 'Show object' : 'Hide object'}
        title={selectedDrawing.hidden ? 'Show object' : 'Hide object'}
        onClick={() =>
          drawingStore.execute(
            updateDrawing(selectedDrawing.id, {
              hidden: !selectedDrawing.hidden,
            }),
          )
        }
      >
        {selectedDrawing.hidden ? <EyeOffIcon /> : <EyeIcon />}
      </button>
      <button
        type="button"
        className={selectedDrawing.locked ? 'toolbar-action active' : 'toolbar-action'}
        aria-label={selectedDrawing.locked ? 'Unlock object' : 'Lock object'}
        title={selectedDrawing.locked ? 'Unlock object' : 'Lock object'}
        onClick={() =>
          drawingStore.execute(
            updateDrawing(selectedDrawing.id, {
              locked: !selectedDrawing.locked,
            }),
          )
        }
      >
        {selectedDrawing.locked ? <LockIcon /> : <UnlockIcon />}
      </button>
      <button
        type="button"
        className="toolbar-action delete"
        aria-label="Delete object"
        title="Delete object"
        onClick={() => drawingStore.execute(deleteDrawing(selectedDrawing.id))}
      >
        <TrashIcon />
      </button>
      <button
        type="button"
        className="toolbar-action"
        aria-label="Close object toolbar"
        title="Close"
        onClick={() => controller?.clearDrawingSelection()}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
