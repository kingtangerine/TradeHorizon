import { useEffect, useRef, useState } from 'react'
import type { KLineChartController, ScaleMode } from '../chart/KLineChartController'
import { DATE_RANGES, rangeStart, zonedInputToTime } from '../chart/dateRanges'
import { localTime } from '../chart/timeAxis'
import type { MarketInterval } from '../market'
import { useBackHandler } from '../platform/backStack'

// TradingView's bar under the chart: date ranges and Go to date on the left, scale toggles and fullscreen on the right.

interface BottomBarProps {
  controller: KLineChartController | null
  interval: MarketInterval
  timeZone: string
  scaleMode: ScaleMode
  onScaleMode(mode: ScaleMode): void
  onInterval(interval: MarketInterval): void
}

/** The date range buttons and Go to date under the chart; picking a range may also switch the timeframe. */
export function BottomBar({ controller, interval, timeZone, onInterval }: BottomBarProps) {
  return (
    <>
      <div className="bottom-ranges" role="group" aria-label="Date range">
        {DATE_RANGES.map((range) => (
          <button
            type="button"
            key={range.key}
            title={range.title}
            disabled={!controller}
            onClick={() => {
              // The range is stored first so the controller fits it once the new timeframe's candles arrive.
              controller?.showRange(rangeStart(range, Date.now()), range.interval)
              if (range.interval !== interval) onInterval(range.interval)
            }}
          >
            {range.key}
          </button>
        ))}
      </div>
      <GoToDate controller={controller} timeZone={timeZone} interval={interval} />
    </>
  )
}

function inputValue(ms: number, timeZone: string): string {
  const t = localTime(ms, timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${t.year}-${two(t.month + 1)}-${two(t.day)}T${two(t.hour)}:${two(t.minute)}`
}

function GoToDate({
  controller,
  timeZone,
  interval,
}: {
  controller: KLineChartController | null
  timeZone: string
  interval: MarketInterval
}) {
  const [open, setOpen] = useState(false)
  useBackHandler(open, () => setOpen(false))
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    globalThis.addEventListener('mousedown', close)
    globalThis.addEventListener('keydown', escape)
    return () => {
      globalThis.removeEventListener('mousedown', close)
      globalThis.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="goto-date" ref={ref}>
      <button
        type="button"
        title="Go to date"
        aria-label="Go to date"
        aria-expanded={open}
        disabled={!controller}
        onClick={() => {
          setValue(inputValue(Date.now() - 7 * 86_400_000, timeZone))
          setError('')
          setOpen((current) => !current)
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 10h16M9 3v4M15 3v4M12 13v4M10 15h4" />
        </svg>
      </button>
      {open && (
        <form
          className="goto-date-form"
          role="dialog"
          aria-label="Go to date"
          onSubmit={(event) => {
            event.preventDefault()
            const time = zonedInputToTime(value, timeZone)
            if (time === undefined) {
              setError('Enter a date and time')
              return
            }
            if (time > Date.now()) {
              setError('That moment is in the future')
              return
            }
            if (controller && !controller.goToTime(time)) {
              setError(`Too far back for ${interval} candles. Pick a larger timeframe and try again.`)
              return
            }
            setOpen(false)
          }}
        >
          <strong>Go to</strong>
          <input
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            aria-label="Date and time"
          />
          {error && <small>{error}</small>}
          <div>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit">Go to</button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Percent and logarithmic scale toggles (clicking the active one returns to normal) and the fullscreen button. */
export function ScaleToggles({ scaleMode, onScaleMode }: { scaleMode: ScaleMode; onScaleMode(mode: ScaleMode): void }) {
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  const toggle = (mode: ScaleMode) => onScaleMode(scaleMode === mode ? 'normal' : mode)
  return (
    <div className="scale-toggles" role="group" aria-label="Price scale">
      <button
        type="button"
        className={scaleMode === 'percent' ? 'active' : ''}
        aria-pressed={scaleMode === 'percent'}
        title="Percent scale: change from the first candle on screen"
        onClick={() => toggle('percent')}
      >
        %
      </button>
      <button
        type="button"
        className={scaleMode === 'log' ? 'active' : ''}
        aria-pressed={scaleMode === 'log'}
        title="Logarithmic scale: equal distances for equal % moves"
        onClick={() => toggle('log')}
      >
        log
      </button>
      {typeof document !== 'undefined' && document.fullscreenEnabled && (
        <button
          type="button"
          className={fullscreen ? 'active' : ''}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen()
            else void document.documentElement.requestFullscreen()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
        </button>
      )}
    </div>
  )
}
