interface ExportPanelProps {
  eventCount: number
  exportEventsCsv(): void
  exportSummaryCsv(): void
  exportJson(): void
}

export function ExportPanel({ eventCount, exportEventsCsv, exportSummaryCsv, exportJson }: ExportPanelProps) {
  const empty = eventCount === 0
  return (
    <section className="card" aria-label="Export session data">
      <header className="card-head">
        <h2 className="card-title">Export</h2>
        <span className="card-meta">
          {eventCount} {eventCount === 1 ? 'event' : 'events'}
        </span>
      </header>
      <div className="export-row">
        <button type="button" className="btn" disabled={empty} onClick={exportEventsCsv}>
          Events CSV
        </button>
        <button type="button" className="btn" disabled={empty} onClick={exportSummaryCsv}>
          Summary CSV
        </button>
        <button type="button" className="btn" disabled={empty} onClick={exportJson}>
          JSON
        </button>
      </div>
    </section>
  )
}
