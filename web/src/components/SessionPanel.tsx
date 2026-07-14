import { classColors } from '../lib/palette'
import { vehicleClasses } from '../types'
import type { SessionCounts } from '../types'

interface SessionPanelProps {
  counts: SessionCounts
}

export function SessionPanel({ counts }: SessionPanelProps) {
  return (
    <section className="card" aria-label="Session totals">
      <header className="card-head">
        <h2 className="card-title">Session</h2>
      </header>
      <div className="session-total">
        <span className="session-total-value">{counts.total}</span>
        <span className="session-total-label">vehicles counted</span>
      </div>
      <div className="session-directions">
        <span>
          <span className="dir-arrow" aria-hidden="true">
            ↓
          </span>
          <span className="sr-only">Downward crossings: </span>
          {counts.byDirection.down}
        </span>
        <span>
          <span className="dir-arrow" aria-hidden="true">
            ↑
          </span>
          <span className="sr-only">Upward crossings: </span>
          {counts.byDirection.up}
        </span>
      </div>
      <ul className="class-list">
        {vehicleClasses.map((vehicleClass) => (
          <li key={vehicleClass}>
            <span className="class-dot" style={{ background: classColors[vehicleClass] }} aria-hidden="true" />
            <span className="class-name">{vehicleClass}</span>
            <span className="class-count">{counts.byClass[vehicleClass]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
