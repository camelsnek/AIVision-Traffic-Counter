import { formatDuration } from '../lib/format'
import { flowBuckets } from '../lib/stats'
import type { CountEvent } from '../types'

const VIEW_WIDTH = 600
const VIEW_HEIGHT = 120
const BAR_GAP = 2
const TOP_PAD = 8

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

export function FlowChart({ events, durationSeconds }: FlowChartProps) {
  const duration =
    durationSeconds > 0 ? durationSeconds : events.length > 0 ? events[events.length - 1].videoTime : 0
  const buckets = flowBuckets(events, duration, 30)
  const hasData = events.length > 0 && buckets.length > 0
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const barWidth = buckets.length > 0 ? (VIEW_WIDTH - BAR_GAP * (buckets.length - 1)) / buckets.length : 0
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
            {bucketLabel} buckets · peak {maxCount}
          </span>
        )}
      </header>
      {hasData ? (
        <>
          <svg
            className="flow-svg"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Vehicles counted per ${bucketLabel} bucket, peak ${maxCount}`}
          >
            <line className="flow-grid" x1={0} y1={TOP_PAD} x2={VIEW_WIDTH} y2={TOP_PAD} strokeDasharray="3 5" />
            <line className="flow-baseline" x1={0} y1={baseline + 0.5} x2={VIEW_WIDTH} y2={baseline + 0.5} />
            {buckets.map((bucket, index) => {
              const x = index * (barWidth + BAR_GAP)
              if (bucket.count === 0) {
                return (
                  <rect
                    key={bucket.start}
                    className="flow-bar-empty"
                    x={x}
                    y={baseline - 2}
                    width={barWidth}
                    height={2}
                  />
                )
              }
              const height = bucket.count * scale
              return (
                <path
                  key={bucket.start}
                  className="flow-bar"
                  d={roundedBarPath(x, baseline - height, barWidth, height, 3)}
                />
              )
            })}
          </svg>
          <div className="flow-axis" aria-hidden="true">
            <span>{formatDuration(0)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </>
      ) : (
        <p className="flow-empty">No crossings yet. Counts per time bucket appear here during analysis.</p>
      )}
    </section>
  )
}
