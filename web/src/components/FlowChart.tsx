import { memo } from 'react'

import { formatDuration } from '../lib/format'
import { flowBuckets } from '../lib/stats'
import type { CountEvent, Direction } from '../types'

const VIEW_WIDTH = 600
const VIEW_HEIGHT = 120
const BUCKET_GAP = 3
const SERIES_GAP = 1
const TOP_PAD = 8

const directionMeta: Record<Direction, { arrow: string; label: string; ariaLabel: string }> = {
  down: { arrow: '↓', label: 'Down', ariaLabel: 'downward' },
  up: { arrow: '↑', label: 'Up', ariaLabel: 'upward' },
  left: { arrow: '←', label: 'Left', ariaLabel: 'leftward' },
  right: { arrow: '→', label: 'Right', ariaLabel: 'rightward' },
}

/** Bar with a rounded top and square base, sitting on the baseline. */
function roundedBarPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height)
  const right = x + width
  const bottom = y + height
  return `M${x.toFixed(2)} ${bottom.toFixed(2)}V${(y + r).toFixed(2)}Q${x.toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)}H${(right - r).toFixed(2)}Q${right.toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + r).toFixed(2)}V${bottom.toFixed(2)}Z`
}

interface FlowChartProps {
  events: CountEvent[]
  durationSeconds: number
}

export const FlowChart = memo(function FlowChart({ events, durationSeconds }: FlowChartProps) {
  const duration =
    durationSeconds > 0 ? durationSeconds : events.length > 0 ? events[events.length - 1].videoTime : 0
  const buckets = flowBuckets(events, duration, 30)
  const directions = visibleDirections(events)
  const hasData = events.length > 0 && buckets.length > 0 && directions.length > 0
  const maxCount = Math.max(
    1,
    ...buckets.flatMap((bucket) => directions.map((direction) => bucket.byDirection[direction])),
  )
  const bucketWidth = buckets.length > 0 ? VIEW_WIDTH / buckets.length : 0
  const groupWidth = Math.max(1, bucketWidth - BUCKET_GAP)
  const barWidth =
    directions.length > 0
      ? Math.max(0.5, (groupWidth - SERIES_GAP * (directions.length - 1)) / directions.length)
      : 0
  const baseline = VIEW_HEIGHT - 1
  const scale = (baseline - TOP_PAD) / maxCount
  const bucketSeconds = buckets[0]?.length ?? 0
  const bucketLabel = bucketSeconds >= 60 ? formatDuration(bucketSeconds) : `${bucketSeconds}s`

  return (
    <section className="card" aria-label="Traffic flow over time">
      <header className="card-head">
        <h2 className="card-title">Traffic flow</h2>
        {hasData && (
          <span className="card-meta">
            {bucketLabel} buckets · directional peak {maxCount}
          </span>
        )}
      </header>
      {hasData ? (
        <>
          <ul className="flow-legend" aria-label="Traffic direction totals">
            {directions.map((direction) => {
              const meta = directionMeta[direction]
              const total = buckets.reduce((sum, bucket) => sum + bucket.byDirection[direction], 0)
              return (
                <li key={direction}>
                  <span className="flow-legend-swatch" data-direction={direction} aria-hidden="true" />
                  <span>
                    {meta.arrow} {meta.label}
                  </span>
                  <strong>{total}</strong>
                </li>
              )
            })}
          </ul>
          <svg
            className="flow-svg"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Directional vehicle crossings per ${bucketLabel} bucket, peak ${maxCount}`}
          >
            <line className="flow-grid" x1={0} y1={TOP_PAD} x2={VIEW_WIDTH} y2={TOP_PAD} strokeDasharray="3 5" />
            <line className="flow-baseline" x1={0} y1={baseline + 0.5} x2={VIEW_WIDTH} y2={baseline + 0.5} />
            {buckets.map((bucket, bucketIndex) => {
              const groupX = bucketIndex * bucketWidth + BUCKET_GAP / 2
              if (bucket.count === 0) {
                return (
                  <rect
                    key={bucket.start}
                    className="flow-bar-empty"
                    x={groupX}
                    y={baseline - 2}
                    width={groupWidth}
                    height={2}
                  />
                )
              }

              return directions.map((direction, directionIndex) => {
                const count = bucket.byDirection[direction]
                if (count === 0) {
                  return null
                }
                const height = count * scale
                const x = groupX + directionIndex * (barWidth + SERIES_GAP)
                const meta = directionMeta[direction]
                const barLabel = `${formatDuration(bucket.start)}–${formatDuration(
                  bucket.start + bucket.length,
                )}: ${count} ${meta.ariaLabel} crossing${count === 1 ? '' : 's'}`
                return (
                  <path
                    key={`${bucket.start}-${direction}`}
                    className="flow-bar"
                    data-direction={direction}
                    aria-label={barLabel}
                    d={roundedBarPath(x, baseline - height, barWidth, height, 3)}
                  >
                    <title>{barLabel}</title>
                  </path>
                )
              })
            })}
          </svg>
          <div className="flow-axis" aria-hidden="true">
            <span>{formatDuration(0)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </>
      ) : (
        <p className="flow-empty">No crossings yet. Directional counts appear here during analysis.</p>
      )}
    </section>
  )
})

function visibleDirections(events: readonly CountEvent[]): Direction[] {
  const hasHorizontal = events.some((event) => event.direction === 'down' || event.direction === 'up')
  const hasVertical = events.some((event) => event.direction === 'left' || event.direction === 'right')
  return [
    ...(hasHorizontal ? (['down', 'up'] as const) : []),
    ...(hasVertical ? (['left', 'right'] as const) : []),
  ]
}
