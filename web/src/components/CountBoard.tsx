import { memo } from 'react'

import type { AnalysisStatus } from '../hooks/useTrafficAnalysis'
import { classColors } from '../lib/palette'
import { vehicleClasses } from '../types'
import type { SessionCounts } from '../types'

const classLabels = { car: 'Cars', truck: 'Trucks', bus: 'Buses', motorcycle: 'Motorcycles' } as const

interface CountBoardProps {
  counts: SessionCounts
  status: AnalysisStatus
}

/** The live tally: one large number, then direction and class splits. */
export const CountBoard = memo(function CountBoard({ counts, status }: CountBoardProps) {
  const hasHorizontal = counts.zones.some((zone) => zone.lineOrientation === 'horizontal')
  const hasVertical = counts.zones.some((zone) => zone.lineOrientation === 'vertical')
  const largest = Math.max(1, ...vehicleClasses.map((vehicleClass) => counts.byClass[vehicleClass]))

  return (
    <section className="board" aria-label="Vehicle counts" data-live={status === 'running'}>
      <div className="board-total">
        <span className="board-number" aria-live="polite">
          {counts.total}
        </span>
        <span className="board-caption">{counts.total === 1 ? 'vehicle counted' : 'vehicles counted'}</span>
      </div>
      <div className="board-directions">
        {hasHorizontal && (
          <>
            <Direction arrow="↓" label="Down" value={counts.byDirection.down} />
            <Direction arrow="↑" label="Up" value={counts.byDirection.up} />
          </>
        )}
        {hasVertical && (
          <>
            <Direction arrow="←" label="Left" value={counts.byDirection.left} />
            <Direction arrow="→" label="Right" value={counts.byDirection.right} />
          </>
        )}
      </div>
      <ul className="board-classes">
        {vehicleClasses.map((vehicleClass) => (
          <li key={vehicleClass}>
            <span className="board-class-name">{classLabels[vehicleClass]}</span>
            <span className="board-class-bar" aria-hidden="true">
              <span
                style={{
                  width: `${(counts.byClass[vehicleClass] / largest) * 100}%`,
                  background: classColors[vehicleClass],
                }}
              />
            </span>
            <span className="board-class-count">{counts.byClass[vehicleClass]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
})

function Direction({ arrow, label, value }: { arrow: string; label: string; value: number }) {
  return (
    <div className="board-direction">
      <span className="board-arrow" aria-hidden="true">
        {arrow}
      </span>
      <span className="sr-only">{label}: </span>
      <span className="board-direction-value">{value}</span>
    </div>
  )
}
