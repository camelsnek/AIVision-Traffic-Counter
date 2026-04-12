import { formatDuration } from '../lib/format'
import { vehicleClasses, type AnalysisSummary, type VehicleClass, type ZoneSummary } from '../types'

interface ResultsPanelProps {
  summary: AnalysisSummary | null
  counts: Record<VehicleClass, number>
  analyzerLabel: string
  elapsedSeconds: number
  currentTime: number
  zoneSummaries: ZoneSummary[]
}

export function ResultsPanel({
  summary,
  counts,
  analyzerLabel,
  elapsedSeconds,
  currentTime,
  zoneSummaries,
}: ResultsPanelProps) {
  const totalVehicles = Object.values(counts).reduce((sum, count) => sum + count, 0)

  return (
    <aside className="results-panel">
      <div className="metric-card accent">
        <p className="eyebrow">Session</p>
        <h2>{totalVehicles}</h2>
        <span>Total vehicles counted</span>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <p className="eyebrow">Analyzer</p>
          <strong>{analyzerLabel}</strong>
        </div>
        <div className="metric-card">
          <p className="eyebrow">Runtime</p>
          <strong>{formatDuration(elapsedSeconds)}</strong>
        </div>
        <div className="metric-card">
          <p className="eyebrow">Video Time</p>
          <strong>{formatDuration(currentTime)}</strong>
        </div>
      </div>

      <div className="results-card">
        <div className="section-heading">
          <h3>Vehicle Classes</h3>
          <span>Live totals</span>
        </div>
        <div className="count-list">
          {vehicleClasses.map((vehicleClass) => (
            <div key={vehicleClass} className="count-row">
              <span>{vehicleClass}</span>
              <strong>{counts[vehicleClass]}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="results-card">
        <div className="section-heading">
          <h3>Run Summary</h3>
          <span>{summary ? 'Last completed scan' : 'Not finished yet'}</span>
        </div>
        {summary ? (
          <dl className="summary-list">
            <div>
              <dt>File</dt>
              <dd>{summary.fileName}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{new Date(summary.startedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Ended</dt>
              <dd>{new Date(summary.endedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Analyzer</dt>
              <dd>{summary.analyzerKind.toUpperCase()}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted-copy">Finish or stop the scan to freeze a shareable result snapshot.</p>
        )}
      </div>

      <div className="results-card">
        <div className="section-heading">
          <h3>Zones</h3>
          <span>Independent totals</span>
        </div>
        <div className="zone-summary-list">
          {zoneSummaries.map((zone) => (
            <div key={zone.zoneId} className="zone-summary-card">
              <div className="count-row">
                <span>{zone.label}</span>
                <strong>{zone.totalVehicles}</strong>
              </div>
              <div className="zone-chip-row">
                {vehicleClasses.map((vehicleClass) => (
                  <span key={`${zone.zoneId}-${vehicleClass}`} className="mini-chip">
                    {vehicleClass}: {zone.counts[vehicleClass]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
