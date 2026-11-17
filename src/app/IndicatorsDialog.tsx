import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DOMINANCE_DESCRIPTIONS,
  DOMINANCE_LABELS,
  MAX_MOVING_AVERAGE_PERIOD,
  MAX_MOVING_AVERAGE_PERIODS,
  MOVING_AVERAGE_COLORS,
  MOVING_AVERAGE_LABELS,
  addMovingAveragePeriod,
  movingAverageActive,
  parsePeriod,
  removeMovingAveragePeriod,
  type DominanceKey,
  type IndicatorSettings,
  type MovingAverageKind,
} from '../chart/indicators'
import { MAX_STUDIES, STUDIES, STUDY_TYPES, type StudyType } from '../chart/studies'
import { VWAP_ANCHORS, VWAP_ANCHOR_LABELS, type VwapAnchor } from '../chart/vwap'
import type { CryptoMarket } from '../chart/markets'
import { compiledScript } from '../chart/scriptIndicator'
import { CloseIcon, PlusIcon, SearchIcon, StarIcon, TrashIcon, SettingsIcon } from './Icons'
import type { UserScript } from './scripts'

// TradingView's "Indicators, metrics & strategies" window: sections on the left (Favorites, My scripts, Technicals,
// Trending, Market dominance), the list on the right, one search over everything. Rows are starred to keep them in
// Favorites; clicking a row adds the indicator (or turns a built-in one on and off). The window stays open.

type Section = 'favorites' | 'scripts' | 'technicals' | 'trending' | 'dominance'

const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: 'favorites', label: 'Favorites' },
  { id: 'scripts', label: 'My scripts' },
  { id: 'technicals', label: 'Technicals' },
  { id: 'trending', label: 'Trending' },
  { id: 'dominance', label: 'Market dominance' },
]

/** What traders add most, in TradingView's popular order. */
const TRENDING = [
  'study:rsi',
  'builtin:ema',
  'study:macd',
  'study:bb',
  'builtin:vwap',
  'builtin:sma',
  'study:volumeProfile',
  'study:supertrend',
  'study:stochRsi',
  'study:ichimoku',
  'builtin:volume',
  'study:atr',
]

interface Entry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly section: 'technicals' | 'dominance' | 'scripts'
}

interface IndicatorsDialogProps {
  indicators: IndicatorSettings
  volumeVisible: boolean
  market: CryptoMarket
  dominanceNote?: string
  favorites: readonly string[]
  scripts: readonly UserScript[]
  onUpdate(update: (current: IndicatorSettings) => IndicatorSettings): void
  onToggleVolume(): void
  onAddStudy(type: StudyType): void
  onAddScript(script: UserScript): void
  onEditScript(script?: UserScript): void
  onDeleteScript(id: string): void
  onToggleFavorite(id: string): void
  onClose(): void
}

/** The indicators window: browse and search indicators, scripts and dominance metrics, star favorites, add them to the chart. */
export function IndicatorsDialog(props: IndicatorsDialogProps) {
  const {
    indicators,
    volumeVisible,
    market,
    favorites,
    scripts,
    onUpdate,
    onToggleVolume,
    onAddStudy,
    onAddScript,
    onEditScript,
    onDeleteScript,
    onToggleFavorite,
    onClose,
  } = props
  const [section, setSection] = useState<Section>(favorites.length > 0 ? 'favorites' : 'technicals')
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<MovingAverageKind, string>>({ sma: '', ema: '' })
  const [maError, setMaError] = useState<{ kind: MovingAverageKind; message: string } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  const entries = useMemo<Entry[]>(
    () => [
      { id: 'builtin:volume', name: 'Volume', description: 'Traded volume along the bottom of the price chart', section: 'technicals' },
      {
        id: 'builtin:sma',
        name: 'Moving Average Simple',
        description: `SMA of the close · up to ${MAX_MOVING_AVERAGE_PERIODS} lengths`,
        section: 'technicals',
      },
      {
        id: 'builtin:ema',
        name: 'Moving Average Exponential',
        description: `EMA of the close · up to ${MAX_MOVING_AVERAGE_PERIODS} lengths`,
        section: 'technicals',
      },
      {
        id: 'builtin:vwap',
        name: 'VWAP',
        description: 'Volume-weighted average price, restarting each day, week, month …',
        section: 'technicals',
      },
      {
        id: 'builtin:qvwap',
        name: 'QVWAP',
        description: 'Quarterly VWAP: average price paid since the start of the quarter',
        section: 'technicals',
      },
      ...STUDY_TYPES.map((type) => ({
        id: `study:${type}`,
        name: STUDIES[type].name,
        description: STUDIES[type].description,
        section: 'technicals' as const,
      })),
      ...(['btc', 'usdt', 'alt'] as const).map((key) => ({
        id: `dominance:${key}`,
        name: DOMINANCE_DESCRIPTIONS[key],
        description: `${DOMINANCE_LABELS[key]} · % of the total crypto market cap (estimated)`,
        section: 'dominance' as const,
      })),
      ...scripts.map((script) => {
        const compiled = compiledScript(script.source)
        return {
          id: `script:${script.id}`,
          name: script.name,
          description:
            compiled instanceof Error
              ? compiled.message
              : `${compiled.overlay ? 'On the candles' : 'Own pane'} · ${compiled.inputs.length} input${compiled.inputs.length === 1 ? '' : 's'}`,
          section: 'scripts' as const,
        }
      }),
    ],
    [scripts],
  )

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? entries.filter((entry) => `${entry.name} ${entry.description} ${entry.id}`.toLowerCase().includes(needle))
    : section === 'favorites'
      ? favorites.map((id) => byId.get(id)).filter((entry): entry is Entry => !!entry)
      : section === 'trending'
        ? TRENDING.map((id) => byId.get(id)).filter((entry): entry is Entry => !!entry)
        : entries.filter((entry) => entry.section === section)

  /** On-chart state shown at the end of the row. */
  const status = (entry: Entry): string | undefined => {
    const [kind, key] = entry.id.split(':') as [string, string]
    if (entry.id === 'builtin:volume') return volumeVisible ? 'On chart' : undefined
    if (kind === 'builtin' && (key === 'sma' || key === 'ema'))
      return movingAverageActive(indicators[key]) ? `On chart · ${indicators[key].periods.join(', ')}` : undefined
    if (entry.id === 'builtin:vwap') return indicators.vwap.visible ? 'On chart' : undefined
    if (entry.id === 'builtin:qvwap') return indicators.qvwap.visible ? 'On chart' : undefined
    if (kind === 'dominance') return indicators.dominance[key as DominanceKey] ? 'On chart' : undefined
    if (kind === 'study') {
      const count = indicators.studies.filter((study) => study.type === key).length
      return count ? `${count} on chart` : undefined
    }
    if (kind === 'script') {
      const count = indicators.scripts.filter((item) => item.scriptId === key).length
      return count ? `${count} on chart` : undefined
    }
    return undefined
  }

  const activate = (entry: Entry) => {
    const [kind, key] = entry.id.split(':') as [string, string]
    if (entry.id === 'builtin:volume') onToggleVolume()
    else if (kind === 'builtin' && (key === 'sma' || key === 'ema')) {
      onUpdate((current) => ({ ...current, [key]: { ...current[key], visible: !current[key].visible && current[key].periods.length > 0 } }))
    } else if (entry.id === 'builtin:vwap')
      onUpdate((current) => ({ ...current, vwap: { ...current.vwap, visible: !current.vwap.visible } }))
    else if (entry.id === 'builtin:qvwap') onUpdate((current) => ({ ...current, qvwap: { visible: !current.qvwap.visible } }))
    else if (kind === 'dominance')
      onUpdate((current) => ({ ...current, dominance: { ...current.dominance, [key]: !current.dominance[key as DominanceKey] } }))
    else if (kind === 'study') onAddStudy(key as StudyType)
    else if (kind === 'script') {
      const script = scripts.find((item) => item.id === key)
      if (script) onAddScript(script)
    }
  }

  const disabled = (entry: Entry): string | undefined => {
    if (entry.id.startsWith('study:') && indicators.studies.length >= MAX_STUDIES)
      return `Up to ${MAX_STUDIES} library indicators at a time`
    if (entry.id === 'study:volumeProfile' && market.kind === 'dominance') return 'Indices have no volume'
    if (
      entry.id.startsWith('script:') &&
      compiledScript(scripts.find((item) => `script:${item.id}` === entry.id)?.source ?? '') instanceof Error
    )
      return 'The script has a mistake: edit it first'
    return undefined
  }

  const addPeriod = (kind: MovingAverageKind) => {
    const period = parsePeriod(drafts[kind])
    if (period === undefined) {
      setMaError({ kind, message: `Enter a whole number from 1 to ${MAX_MOVING_AVERAGE_PERIOD}.` })
      return
    }
    if (!indicators[kind].periods.includes(period) && indicators[kind].periods.length >= MAX_MOVING_AVERAGE_PERIODS) {
      setMaError({ kind, message: `Up to ${MAX_MOVING_AVERAGE_PERIODS} lengths.` })
      return
    }
    setMaError(null)
    setDrafts((current) => ({ ...current, [kind]: '' }))
    onUpdate((current) => ({ ...current, [kind]: addMovingAveragePeriod(current[kind], period) }))
  }

  /** Extra controls under a row: moving-average lengths, VWAP restart, script actions. */
  const extra = (entry: Entry): ReactNode => {
    if (entry.id === 'builtin:sma' || entry.id === 'builtin:ema') {
      const kind = entry.id.slice('builtin:'.length) as MovingAverageKind
      return (
        <div className="indicator-periods">
          {indicators[kind].periods.map((period, index) => (
            <span
              className="period-chip"
              style={{ '--chip-color': MOVING_AVERAGE_COLORS[kind][index % MOVING_AVERAGE_COLORS[kind].length] } as CSSProperties}
              key={period}
            >
              {period}
              <button
                type="button"
                aria-label={`Remove ${MOVING_AVERAGE_LABELS[kind]} ${period}`}
                onClick={() => onUpdate((current) => ({ ...current, [kind]: removeMovingAveragePeriod(current[kind], period) }))}
              >
                ×
              </button>
            </span>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              addPeriod(kind)
            }}
          >
            <input
              type="number"
              min="1"
              max={MAX_MOVING_AVERAGE_PERIOD}
              placeholder="Length"
              aria-label={`${MOVING_AVERAGE_LABELS[kind]} length`}
              value={drafts[kind]}
              onChange={(event) => setDrafts((current) => ({ ...current, [kind]: event.target.value }))}
            />
            <button type="submit">Add</button>
          </form>
          {maError?.kind === kind && <small className="indicator-error">{maError.message}</small>}
        </div>
      )
    }
    if (entry.id === 'builtin:vwap') {
      return (
        <div className="indicator-periods">
          <select
            className="vwap-anchor"
            aria-label="VWAP restarts every"
            value={indicators.vwap.anchor}
            onChange={(event) => onUpdate((current) => ({ ...current, vwap: { visible: true, anchor: event.target.value as VwapAnchor } }))}
          >
            {VWAP_ANCHORS.map((anchor) => (
              <option value={anchor} key={anchor}>
                Restarts every {VWAP_ANCHOR_LABELS[anchor].toLowerCase()} (UTC)
              </option>
            ))}
          </select>
        </div>
      )
    }
    return undefined
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="indicators-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Indicators"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Indicators, metrics and scripts</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <label className="indicators-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search"
            aria-label="Search indicators"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="indicators-body">
          <nav aria-label="Indicator sections">
            {SECTIONS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={!needle && section === item.id ? 'active' : ''}
                aria-current={!needle && section === item.id}
                onClick={() => {
                  setSection(item.id)
                  setQuery('')
                }}
              >
                {item.id === 'favorites' && <StarIcon />}
                {item.label}
                {item.id === 'favorites' && favorites.length > 0 && <small>{favorites.length}</small>}
                {item.id === 'scripts' && scripts.length > 0 && <small>{scripts.length}</small>}
              </button>
            ))}
          </nav>
          <div className="indicators-list">
            {!needle && section === 'scripts' && (
              <div className="indicators-section-head">
                <span>
                  Write your own indicator in a few lines (moving averages, RSI, crossings …). Scripts are saved with your account.
                </span>
                <button type="button" className="primary" onClick={() => onEditScript()}>
                  <PlusIcon /> New script
                </button>
              </div>
            )}
            {!needle && section === 'favorites' && shown.length === 0 && (
              <p className="indicators-empty">Star an indicator to keep it here.</p>
            )}
            {!needle && section === 'scripts' && shown.length === 0 && <p className="indicators-empty">No scripts yet.</p>}
            {needle && shown.length === 0 && <p className="indicators-empty">Nothing matches “{query.trim()}”.</p>}
            {shown.map((entry) => {
              const blocked = disabled(entry)
              const onChart = status(entry)
              const favorite = favorites.includes(entry.id)
              const script = entry.id.startsWith('script:') ? scripts.find((item) => `script:${item.id}` === entry.id) : undefined
              return (
                <div className={onChart ? 'indicators-row on' : 'indicators-row'} key={entry.id}>
                  <button
                    type="button"
                    className={favorite ? 'indicators-star on' : 'indicators-star'}
                    aria-label={favorite ? `Remove ${entry.name} from favorites` : `Add ${entry.name} to favorites`}
                    aria-pressed={favorite}
                    onClick={() => onToggleFavorite(entry.id)}
                  >
                    <StarIcon />
                  </button>
                  <button
                    type="button"
                    className="indicators-main"
                    disabled={!!blocked}
                    title={blocked ?? entry.description}
                    onClick={() => activate(entry)}
                  >
                    <b>{entry.name}</b>
                    <small>{blocked ?? entry.description}</small>
                  </button>
                  {onChart && <em className="indicators-status">{onChart}</em>}
                  {script && (
                    <span className="indicators-actions">
                      <button type="button" aria-label={`Edit ${script.name}`} title="Edit" onClick={() => onEditScript(script)}>
                        <SettingsIcon />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${script.name}`}
                        title="Delete"
                        onClick={() => {
                          if (globalThis.confirm(`Delete the script "${script.name}"? It is also removed from your charts.`))
                            onDeleteScript(script.id)
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  )}
                  {extra(entry) && <div className="indicators-extra">{extra(entry)}</div>}
                </div>
              )
            })}
            {!needle && section === 'dominance' && props.dominanceNote && <p className="indicator-note">{props.dominanceNote}</p>}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
