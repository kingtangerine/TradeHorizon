import type { IndicatorSettings } from '../../chart/indicators'
import type { CryptoMarket } from '../../chart/markets'
import type { ChartRuntimeState } from '../../chart/types'
import { IndicatorsDialog } from '../IndicatorsDialog'
import { ScriptEditorDialog, ScriptSettingsDialog } from '../ScriptEditorDialog'
import { StudySettingsDialog } from '../StudySettingsDialog'
import type { IndicatorActions } from './useIndicatorActions'

interface IndicatorDialogsProps {
  actions: IndicatorActions
  indicators: IndicatorSettings
  volumeVisible: boolean
  market: CryptoMarket
  runtime: ChartRuntimeState
  /** Indicators the user starred. */
  favorites: readonly string[]
  toggleVolume(): void
}

/** The indicator windows: the Indicators library, the script editor, and the settings of a script or study on the chart. */
export function IndicatorDialogs({ actions, indicators, volumeVisible, market, runtime, favorites, toggleVolume }: IndicatorDialogsProps) {
  const {
    updateIndicators,
    studySettingsId,
    setStudySettingsId,
    indicatorsOpen,
    setIndicatorsOpen,
    scripts,
    scriptEditor,
    setScriptEditor,
    scriptSettingsId,
    setScriptSettingsId,
    addScriptInstance,
    saveScript,
    deleteScript,
    changeScriptInstance,
    removeScriptInstance,
    toggleFavoriteIndicator,
    addStudy,
    changeStudy,
    removeStudy,
  } = actions
  return (
    <>
      {indicatorsOpen && (
        <IndicatorsDialog
          indicators={indicators}
          volumeVisible={volumeVisible}
          market={market}
          dominanceNote={
            runtime.dominance === 'loading'
              ? 'Importing dominance data…'
              : runtime.dominance === 'error'
                ? `Could not import dominance data: ${runtime.dominanceError}`
                : undefined
          }
          favorites={favorites}
          scripts={scripts}
          onUpdate={updateIndicators}
          onToggleVolume={toggleVolume}
          onAddStudy={addStudy}
          onAddScript={addScriptInstance}
          onEditScript={(script) => setScriptEditor({ script })}
          onDeleteScript={deleteScript}
          onToggleFavorite={toggleFavoriteIndicator}
          onClose={() => setIndicatorsOpen(false)}
        />
      )}

      {scriptEditor && <ScriptEditorDialog script={scriptEditor.script} onSave={saveScript} onClose={() => setScriptEditor(undefined)} />}

      {scriptSettingsId &&
        indicators.scripts.some((item) => item.id === scriptSettingsId) &&
        (() => {
          const instance = indicators.scripts.find((item) => item.id === scriptSettingsId)!
          return (
            <ScriptSettingsDialog
              key={instance.id}
              instance={instance}
              onChange={changeScriptInstance}
              onEdit={() => {
                setScriptSettingsId(undefined)
                setScriptEditor({
                  script: scripts.find((item) => item.id === instance.scriptId) ?? {
                    id: instance.scriptId,
                    name: instance.name,
                    source: instance.source,
                    updatedAtMs: 0,
                  },
                })
              }}
              onRemove={() => removeScriptInstance(instance.id)}
              onClose={() => setScriptSettingsId(undefined)}
            />
          )
        })()}

      {studySettingsId && indicators.studies.some((study) => study.id === studySettingsId) && (
        <StudySettingsDialog
          study={indicators.studies.find((study) => study.id === studySettingsId)!}
          onChange={changeStudy}
          onRemove={() => removeStudy(studySettingsId)}
          onClose={() => setStudySettingsId(undefined)}
        />
      )}
    </>
  )
}
