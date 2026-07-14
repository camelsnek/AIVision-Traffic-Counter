import type { LineOrientation, ZoneCounts } from '../types'

interface ZonesPanelProps {
  zones: ZoneCounts[]
  zoneEditing: boolean
  setZoneEditing(editing: boolean): void
  activeZoneId: string | null
  setActiveZone(zoneId: string): void
  addZone(): void
  removeZone(zoneId: string): void
  updateZoneOrientation(zoneId: string, lineOrientation: LineOrientation): void
  /** True while the engine is loading or running; zone edits are locked. */
  busy: boolean
  hasVideo: boolean
}

export function ZonesPanel({
  zones,
  zoneEditing,
  setZoneEditing,
  activeZoneId,
  setActiveZone,
  addZone,
  updateZoneOrientation,
  removeZone,
  busy,
  hasVideo,
}: ZonesPanelProps) {
  const activeZone = zones.find((zone) => zone.zoneId === activeZoneId) ?? null
  return (
    <section className="card" aria-label="Counting zones">
      <header className="card-head">
        <h2 className="card-title">Zones</h2>
        <span className="card-meta">
          {zones.length} {zones.length === 1 ? 'zone' : 'zones'}
        </span>
      </header>
      <div className="zone-controls">
        <button
          type="button"
          className={zoneEditing ? 'btn is-on' : 'btn'}
          aria-pressed={zoneEditing}
          disabled={busy || !hasVideo}
          onClick={() => setZoneEditing(!zoneEditing)}
        >
          Edit zones
        </button>
        <button type="button" className="btn" disabled={busy} onClick={addZone}>
          Add zone
        </button>
      </div>
      {zoneEditing && activeZone && (
        <div className="zone-orientation-control" aria-label={`${activeZone.label} counting line`}>
          <span>Counting line</span>
          <div className="zone-orientation-options">
            <button
              type="button"
              className={activeZone.lineOrientation === 'horizontal' ? 'btn is-on' : 'btn'}
              aria-pressed={activeZone.lineOrientation === 'horizontal'}
              disabled={busy}
              onClick={() => updateZoneOrientation(activeZone.zoneId, 'horizontal')}
            >
              Horizontal
            </button>
            <button
              type="button"
              className={activeZone.lineOrientation === 'vertical' ? 'btn is-on' : 'btn'}
              aria-pressed={activeZone.lineOrientation === 'vertical'}
              disabled={busy}
              onClick={() => updateZoneOrientation(activeZone.zoneId, 'vertical')}
            >
              Vertical
            </button>
          </div>
        </div>
      )}
      {zoneEditing && (
        <p className="zone-edit-hint">
          Drag a zone to move it, use the corner to resize it, and drag the highlighted line grip to
          place the crossing.
        </p>
      )}
      <ul className="zone-list">
        {zones.map((zone) => (
          <li key={zone.zoneId} className="zone-row">
            <button
              type="button"
              className={zone.zoneId === activeZoneId ? 'zone-chip is-active' : 'zone-chip'}
              onClick={() => setActiveZone(zone.zoneId)}
            >
              <span className="zone-chip-dot" aria-hidden="true" />
              {zone.label}
            </button>
            <span className="zone-row-total">{zone.total}</span>
            <span className="zone-row-split">
              {zone.lineOrientation === 'vertical'
                ? `← ${zone.byDirection.left} / → ${zone.byDirection.right}`
                : `↓ ${zone.byDirection.down} / ↑ ${zone.byDirection.up}`}
            </span>
            <button
              type="button"
              className="btn btn-icon"
              aria-label={`Remove ${zone.label}`}
              disabled={busy || zones.length === 1}
              onClick={() => removeZone(zone.zoneId)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
