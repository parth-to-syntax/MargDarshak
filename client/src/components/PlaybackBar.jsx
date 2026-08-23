const PHASES = [
  { ts: [0,  19], label: 'Normal flow',      color: '#20c060' },
  { ts: [20, 24], label: 'Build-up',         color: '#f0a020' },
  { ts: [25, 25], label: 'INCIDENT 1',       color: '#e84040' },
  { ts: [26, 34], label: 'Ripple × 1',       color: '#e84040' },
  { ts: [35, 35], label: 'INCIDENT 2',       color: '#e84040' },
  { ts: [36, 49], label: 'Ripple × 2',       color: '#e84040' },
  { ts: [50, 50], label: 'INCIDENT 3',       color: '#e84040' },
  { ts: [51, 60], label: 'Ripple × 3',       color: '#e84040' },
  { ts: [61, 65], label: 'Recovery',         color: '#f0a020' },
  { ts: [66, 75], label: 'Improving',        color: '#f0a020' },
  { ts: [76, 79], label: 'Cleared',          color: '#20c060' },
]

function getPhase(idx) {
  return PHASES.find(p => idx >= p.ts[0] && idx <= p.ts[1])
    || { label: 'Unknown', color: '#6a8ca8' }
}

export default function PlaybackBar({
  frameIdx,
  totalFrames,
  currentTs,
  isPlaying,
  setIsPlaying,
  playSpeed,
  setPlaySpeed,
  goToFrame,
  resetPlayback,
  incidentCount,
  congestedCount,
  avgSpeed,
  networkHealth,
}) {
  const phase    = getPhase(frameIdx)
  const progress = totalFrames > 1 ? (frameIdx / (totalFrames - 1)) * 100 : 0
  const timeStr  = currentTs?.split(' ')[1]?.slice(0, 5) || '--:--'

  return (
    <div style={{
      background: 'var(--bg1)',
      borderTop: '1px solid var(--border)',
      padding: '0 20px',
      flexShrink: 0,
      userSelect: 'none',
    }}>

      {/* Top row — metrics */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        height: 36,
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}>
        <Metric label="INCIDENTS" value={incidentCount}
          color={incidentCount > 0 ? 'var(--red)' : 'var(--green)'} />
        <Metric label="CONGESTED" value={congestedCount}
          color={congestedCount > 20 ? 'var(--amber)' : 'var(--text)'} />
        <Metric label="NETWORK HEALTH" value={`${avgSpeed}%`} />

        {/* Phase badge */}
        <div style={{
          marginLeft: 'auto',
          padding: '3px 12px',
          background: phase.color + '22',
          border: `1px solid ${phase.color}55`,
          color: phase.color,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          animation: phase.color === '#e84040' ? 'blink 1.5s ease-in-out infinite' : 'none',
        }}>
          {phase.label}
        </div>

        <div style={{ color: 'var(--text)', fontWeight: 500, letterSpacing: '0.06em' }}>
          {timeStr}
        </div>

        <div style={{ color: 'var(--text2)', fontSize: 11 }}>
          T{frameIdx + 1} / {totalFrames}
        </div>
      </div>

      {/* Bottom row — controls + slider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 44,
      }}>

        {/* Buttons */}
        <button className="btn-sm" onClick={() => setIsPlaying(!isPlaying)}
          style={{ minWidth: 72, color: isPlaying ? 'var(--amber)' : 'var(--cyan)',
            borderColor: isPlaying ? 'var(--amber-dim)' : 'var(--cyan-dim)' }}>
          {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
        </button>

        <button className="btn-sm" onClick={resetPlayback}>
          ↺ RESET
        </button>

        {/* Speed selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text2)' }}>
          SPEED
          <SpeedBtn label="0.5×" ms={1600} current={playSpeed} setSpeed={setPlaySpeed} />
          <SpeedBtn label="1×"   ms={800}  current={playSpeed} setSpeed={setPlaySpeed} />
          <SpeedBtn label="2×"   ms={400}  current={playSpeed} setSpeed={setPlaySpeed} />
          <SpeedBtn label="5×"   ms={160}  current={playSpeed} setSpeed={setPlaySpeed} />
        </div>

        {/* Progress bar + segment markers */}
        <div style={{ flex: 1, position: 'relative', cursor: 'pointer' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct  = (e.clientX - rect.left) / rect.width
            goToFrame(Math.round(pct * (totalFrames - 1)))
          }}>

          {/* Track */}
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: 'var(--cyan)', borderRadius: 2,
              transition: 'width 0.3s',
            }} />
          </div>

          {/* Phase segment markers on the track */}
          {PHASES.map((p, i) => {
            const left = totalFrames > 1
              ? ((p.ts[0] / (totalFrames - 1)) * 100) : 0
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${left}%`,
                top: -3,
                width: 2,
                height: 10,
                background: p.color + '88',
                pointerEvents: 'none',
              }} />
            )
          })}

          {/* Scrubber handle */}
          <div style={{
            position: 'absolute',
            left: `calc(${progress}% - 6px)`,
            top: -4,
            width: 12,
            height: 12,
            background: 'var(--cyan)',
            borderRadius: '50%',
            border: '2px solid var(--bg1)',
            transition: 'left 0.3s',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Frame jump buttons */}
        <button className="btn-sm"
          onClick={() => goToFrame(Math.max(0, frameIdx - 5))}>
          ← 5
        </button>
        <button className="btn-sm"
          onClick={() => goToFrame(Math.min(totalFrames - 1, frameIdx + 5))}>
          5 →
        </button>

        {/* Jump to incident */}
        <button className="btn-sm"
          style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}
          onClick={() => goToFrame(25)}>
          ⚠ INC 1
        </button>
        <button className="btn-sm"
          style={{ color: 'var(--amber)', borderColor: 'var(--amber-dim)' }}
          onClick={() => goToFrame(35)}>
          ⚠ INC 2
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text3)' }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: color || 'var(--text)' }}>
        {value}
      </span>
    </div>
  )
}

function SpeedBtn({ label, ms, current, setSpeed }) {
  return (
    <button className="btn-sm"
      onClick={() => setSpeed(ms)}
      style={{
        padding: '2px 8px', fontSize: 10,
        color:       current === ms ? 'var(--cyan)' : 'var(--text2)',
        borderColor: current === ms ? 'var(--cyan-dim)' : 'var(--border2)',
      }}>
      {label}
    </button>
  )
}