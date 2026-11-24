interface ExportPanelProps {
  eventCount: number
  exportUrl(kind: 'events.csv' | 'summary.csv' | 'session.json'): string
}

const exports = [
  { kind: 'events.csv', label: 'Events', note: 'One row per counted vehicle' },
  { kind: 'summary.csv', label: 'Summary', note: 'Totals per zone, direction and class' },
  { kind: 'session.json', label: 'Session', note: 'Everything, including settings and speed' },
] as const

export function ExportPanel({ eventCount, exportUrl }: ExportPanelProps) {
  const empty = eventCount === 0
  return (
    <section className="panel" aria-label="Export">
      <header className="panel-head">
        <h2>Export</h2>
        <span className="panel-meta">
          {eventCount} {eventCount === 1 ? 'event' : 'events'}
        </span>
      </header>
      <ul className="export-list">
        {exports.map((item) => (
          <li key={item.kind}>
            <a
              className={empty ? 'export-link is-disabled' : 'export-link'}
              href={empty ? undefined : exportUrl(item.kind)}
              aria-disabled={empty}
              download
            >
              <span className="export-label">{item.label}</span>
              <span className="export-note">{item.note}</span>
              <span className="export-format">{item.kind.split('.')[1].toUpperCase()}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
