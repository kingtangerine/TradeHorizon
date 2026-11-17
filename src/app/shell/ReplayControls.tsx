import type { KLineChartController } from '../../chart/KLineChartController'
import { REPLAY_SPEEDS } from '../../chart/replay'
import type { ReplayState } from '../../chart/types'
import { CloseIcon, PauseIcon, PlayIcon, ReplayIcon, StepForwardIcon } from '../Icons'
import { formatReplayTime } from './workspaceHelpers'

/** Bar replay over the chart: the "pick a start bar" hint, then the play, step, speed and exit controls. */
export function ReplayControls({
  replay,
  replayActive,
  controller,
}: {
  replay: ReplayState | null
  replayActive: boolean
  controller: KLineChartController | null
}) {
  return (
    <>
      {replay?.status === 'picking' && (
        <div className="drawing-hint" role="status">
          <ReplayIcon />
          Click the candle to start the replay from
          <kbd>Esc</kbd>
        </div>
      )}

      {replayActive && replay && (
        <div className="replay-bar" role="toolbar" aria-label="Bar replay">
          <button
            type="button"
            className="replay-primary"
            aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
            title={replay.playing ? 'Pause (Shift+↓)' : 'Play (Shift+↓)'}
            onClick={() => controller?.setReplayPlaying(!replay.playing)}
            disabled={replay.atEnd}
          >
            {replay.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            aria-label="Forward one bar"
            title="Forward one bar (Shift+→)"
            onClick={() => controller?.stepReplay()}
            disabled={replay.atEnd}
          >
            <StepForwardIcon />
          </button>
          <select
            aria-label="Replay speed"
            title="Replay speed"
            value={replay.speedMs}
            onChange={(event) => controller?.setReplaySpeed(Number(event.target.value))}
          >
            {REPLAY_SPEEDS.map((speed) => (
              <option value={speed.ms} key={speed.ms}>
                {speed.label}
              </option>
            ))}
          </select>
          <span className="replay-time">{replay.atEnd ? 'Reached the latest bar' : formatReplayTime(replay.timeMs)}</span>
          <button type="button" title="Choose a different starting bar" onClick={() => controller?.startReplaySelection()}>
            <ReplayIcon /> Jump to…
          </button>
          <button type="button" className="replay-exit" title="Exit replay and return to live" onClick={() => controller?.exitReplay()}>
            <CloseIcon /> Exit
          </button>
        </div>
      )}
    </>
  )
}
