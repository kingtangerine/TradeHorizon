import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { MAX_COMPARE } from '../../chart/compare'
import {
  DEFAULT_INDICATORS,
  MAX_SCRIPT_INSTANCES,
  type IndicatorSettings,
  type MovingAverageKind,
  type ScriptInstance,
  type VwapKind,
} from '../../chart/indicators'
import { MAX_STUDIES, newStudy, type Study, type StudyType } from '../../chart/studies'
import type { Preferences } from '../preferences'
import { loadScripts, type UserScript } from '../scripts'
import type { UserWorkspace } from '../workspace'
import { useBackHandler } from '../../platform/backStack'

/**
 * Indicators on the chart: the built-in ones, studies, compared symbols and the user's own scripts ("My scripts"),
 * with the dialogs that edit them.
 */
export function useIndicatorActions(
  userId: string,
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>,
  setPreferences: Dispatch<SetStateAction<Preferences>>,
) {
  const updateIndicators = useCallback(
    (update: (current: IndicatorSettings) => IndicatorSettings) => {
      setWorkspace((current) => ({ ...current, indicators: update(current.indicators ?? DEFAULT_INDICATORS) }))
    },
    [setWorkspace],
  )

  const toggleVwap = useCallback(
    (kind: VwapKind) => {
      updateIndicators((current) =>
        kind === 'vwap'
          ? { ...current, vwap: { ...current.vwap, visible: !current.vwap.visible } }
          : { ...current, qvwap: { visible: !current.qvwap.visible } },
      )
    },
    [updateIndicators],
  )

  const toggleMovingAverage = useCallback(
    (kind: MovingAverageKind) => {
      updateIndicators((current) => ({
        ...current,
        [kind]: { ...current[kind], visible: !current[kind].visible && current[kind].periods.length > 0 },
      }))
    },
    [updateIndicators],
  )

  const [studySettingsId, setStudySettingsId] = useState<string>()
  /** Compare: the first compared symbol switches the chart to the percent scale, as in TradingView. */
  const addCompare = useCallback(
    (symbol: string) => {
      updateIndicators((current) =>
        current.compare.includes(symbol) || current.compare.length >= MAX_COMPARE
          ? current
          : { ...current, compare: [...current.compare, symbol] },
      )
      setWorkspace((current) => (current.scaleMode ? current : { ...current, scaleMode: 'percent' }))
    },
    [setWorkspace, updateIndicators],
  )
  const removeCompare = useCallback(
    (symbol: string) => {
      updateIndicators((current) => ({ ...current, compare: current.compare.filter((item) => item !== symbol) }))
    },
    [updateIndicators],
  )
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  // "My scripts": the user's scripts, the editor, and the settings of a script on the chart.
  const [scripts, setScripts] = useState<UserScript[]>(() => loadScripts(userId))
  const [scriptEditor, setScriptEditor] = useState<{ script?: UserScript }>()
  const [scriptSettingsId, setScriptSettingsId] = useState<string>()

  // Android Back closes the indicator windows, the one opened last first (see platform/backStack.ts).
  useBackHandler(indicatorsOpen, () => setIndicatorsOpen(false))
  useBackHandler(studySettingsId !== undefined, () => setStudySettingsId(undefined))
  useBackHandler(scriptEditor !== undefined, () => setScriptEditor(undefined))
  useBackHandler(scriptSettingsId !== undefined, () => setScriptSettingsId(undefined))
  const addScriptInstance = useCallback(
    (script: UserScript) => {
      updateIndicators((current) =>
        current.scripts.length >= MAX_SCRIPT_INSTANCES
          ? current
          : {
              ...current,
              scripts: [
                ...current.scripts,
                {
                  id: `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  scriptId: script.id,
                  name: script.name,
                  source: script.source,
                  inputs: [],
                  visible: true,
                },
              ],
            },
      )
    },
    [updateIndicators],
  )
  /** Saving a script updates its copies on the chart (their inputs are kept when the script still has them). */
  const saveScript = useCallback(
    (script: UserScript, addToChart: boolean) => {
      setScripts((current) =>
        current.some((item) => item.id === script.id)
          ? current.map((item) => (item.id === script.id ? script : item))
          : [...current, script],
      )
      updateIndicators((current) => ({
        ...current,
        scripts: current.scripts.map((item) =>
          item.scriptId === script.id ? { ...item, name: script.name, source: script.source } : item,
        ),
      }))
      if (addToChart) addScriptInstance(script)
      setScriptEditor(undefined)
    },
    [addScriptInstance, updateIndicators],
  )
  const deleteScript = useCallback(
    (id: string) => {
      setScripts((current) => current.filter((item) => item.id !== id))
      updateIndicators((current) => ({ ...current, scripts: current.scripts.filter((item) => item.scriptId !== id) }))
    },
    [updateIndicators],
  )
  const changeScriptInstance = useCallback(
    (instance: ScriptInstance) => {
      updateIndicators((current) => ({ ...current, scripts: current.scripts.map((item) => (item.id === instance.id ? instance : item)) }))
    },
    [updateIndicators],
  )
  const removeScriptInstance = useCallback(
    (id: string) => {
      updateIndicators((current) => ({ ...current, scripts: current.scripts.filter((item) => item.id !== id) }))
      setScriptSettingsId((current) => (current === id ? undefined : current))
    },
    [updateIndicators],
  )
  const toggleFavoriteIndicator = useCallback(
    (id: string) => {
      setPreferences((current) => ({
        ...current,
        favoriteIndicators: current.favoriteIndicators.includes(id)
          ? current.favoriteIndicators.filter((item) => item !== id)
          : [...current.favoriteIndicators, id],
      }))
    },
    [setPreferences],
  )
  const addStudy = useCallback(
    (type: StudyType) => {
      const id = `study-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      updateIndicators((current) =>
        current.studies.length >= MAX_STUDIES ? current : { ...current, studies: [...current.studies, newStudy(type, id)] },
      )
    },
    [updateIndicators],
  )
  const changeStudy = useCallback(
    (study: Study) => {
      updateIndicators((current) => ({ ...current, studies: current.studies.map((item) => (item.id === study.id ? study : item)) }))
    },
    [updateIndicators],
  )
  const removeStudy = useCallback(
    (id: string) => {
      updateIndicators((current) => ({ ...current, studies: current.studies.filter((item) => item.id !== id) }))
      setStudySettingsId((current) => (current === id ? undefined : current))
    },
    [updateIndicators],
  )

  return {
    updateIndicators,
    toggleVwap,
    toggleMovingAverage,
    studySettingsId,
    setStudySettingsId,
    addCompare,
    removeCompare,
    indicatorsOpen,
    setIndicatorsOpen,
    scripts,
    setScripts,
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
  }
}

/** Indicator state and actions from useIndicatorActions. */
export type IndicatorActions = ReturnType<typeof useIndicatorActions>
