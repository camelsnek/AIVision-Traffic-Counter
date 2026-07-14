import './App.css'

import { ActionBar } from './components/ActionBar'
import { ConfigPanel } from './components/ConfigPanel'
import { ExportPanel } from './components/ExportPanel'
import { FlowChart } from './components/FlowChart'
import { SessionPanel } from './components/SessionPanel'
import { TopBar } from './components/TopBar'
import { VideoStage } from './components/VideoStage'
import { ZoneEditor } from './components/ZoneEditor'
import { ZonesPanel } from './components/ZonesPanel'
import { useTrafficAnalysis } from './hooks/useTrafficAnalysis'

export default function App() {
  const analysis = useTrafficAnalysis()
  const busy = analysis.status === 'running' || analysis.status === 'loading'

  return (
    <div className="app">
      <TopBar status={analysis.status} engine={analysis.engine} progress={analysis.progress} />
      <main className="workspace">
        <section className="stage-column" aria-label="Video stage">
          <VideoStage
            videoRef={analysis.videoRef}
            overlayRef={analysis.overlayRef}
            videoUrl={analysis.videoUrl}
            fileName={analysis.fileName}
            videoSize={analysis.videoSize}
            status={analysis.status}
            progress={analysis.progress}
            loadFile={analysis.loadFile}
          >
            <ZoneEditor
              zones={analysis.config.zones}
              editing={analysis.zoneEditing}
              activeZoneId={analysis.activeZoneId}
              setActiveZone={analysis.setActiveZone}
              updateZoneRegion={analysis.updateZoneRegion}
              updateZoneLine={analysis.updateZoneLine}
            />
          </VideoStage>
        </section>
        <aside className="sidebar">
          {analysis.error !== null && (
            <div className="error-banner" role="alert">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M7 1.2 13.2 12H.8L7 1.2Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path d="M7 5.4v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="7" cy="10.4" r="0.7" fill="currentColor" />
              </svg>
              <span>{analysis.error}</span>
            </div>
          )}
          <ActionBar
            status={analysis.status}
            canStart={analysis.canStart}
            start={analysis.start}
            stop={analysis.stop}
            reset={analysis.reset}
          />
          <SessionPanel counts={analysis.counts} />
          <ZonesPanel
            zones={analysis.counts.zones}
            zoneEditing={analysis.zoneEditing}
            setZoneEditing={analysis.setZoneEditing}
            activeZoneId={analysis.activeZoneId}
            setActiveZone={analysis.setActiveZone}
            addZone={analysis.addZone}
            removeZone={analysis.removeZone}
            busy={busy}
            hasVideo={analysis.videoUrl !== null}
          />
          <FlowChart events={analysis.events} durationSeconds={analysis.progress.durationSeconds} />
          <ConfigPanel
            config={analysis.config}
            disabled={busy}
            setModelProfile={analysis.setModelProfile}
            setConfidence={analysis.setConfidence}
            setSamplingFps={analysis.setSamplingFps}
          />
          <ExportPanel
            eventCount={analysis.events.length}
            exportEventsCsv={analysis.exportEventsCsv}
            exportSummaryCsv={analysis.exportSummaryCsv}
            exportJson={analysis.exportJson}
          />
        </aside>
      </main>
      <footer className="footnote">
        Counting rule: one count per vehicle per zone, on counting-line crossing. Direction ↓/↑ follows
        screen motion.
      </footer>
    </div>
  )
}
