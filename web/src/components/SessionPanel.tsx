import { memo } from 'react'

import { classColors } from '../lib/palette'
import { vehicleClasses } from '../types'
import type { SessionCounts } from '../types'

interface SessionPanelProps {
  counts: SessionCounts
}

export const SessionPanel = memo(function SessionPanel({ counts }: SessionPanelProps) {
  const hasHorizontal = counts.zones.some((zone) => zone.lineOrientation === 'horizontal')
  const hasVertical = counts.zones.some((zone) => zone.lineOrientation === 'vertical')
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
        {hasHorizontal && (
          <>
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
          </>
        )}
        {hasVertical && (
          <>
            <span>
              <span className="dir-arrow" aria-hidden="true">
                ←
              </span>
              <span className="sr-only">Leftward crossings: </span>
              {counts.byDirection.left}
            </span>
            <span>
              <span className="dir-arrow" aria-hidden="true">
                →
              </span>
              <span className="sr-only">Rightward crossings: </span>
              {counts.byDirection.right}
            </span>
          </>
        )}
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
})
