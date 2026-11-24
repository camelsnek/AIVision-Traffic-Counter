import './App.css'

import { ActionBar } from './components/ActionBar'
import { ConfigPanel } from './components/ConfigPanel'
import { CountBoard } from './components/CountBoard'
import { ExportPanel } from './components/ExportPanel'
import { FlowChart } from './components/FlowChart'
import { AppHeader } from './components/AppHeader'
import { VideoLibrary } from './components/VideoLibrary'
import { VideoStage } from './components/VideoStage'
import { ZoneEditor } from './components/ZoneEditor'
import { ZonesPanel } from './components/ZonesPanel'
import { useTrafficAnalysis } from './hooks/useTrafficAnalysis'

export default function App() {
  const analysis = useTrafficAnalysis()

  return (
    <div className="app">
      <AppHeader
        connected={analysis.connected}
        status={analysis.status}
        engine={analysis.engine}
        models={analysis.models}
      />
      <main className="workspace">
        <section className="stage-column" aria-label="Video">
          <VideoStage
            frameRef={analysis.frameRef}
            overlayRef={analysis.overlayRef}
            video={analysis.video}
            videoSize={analysis.videoSize}
            status={analysis.status}
            progress={analysis.progress}
            uploadProgress={analysis.uploadProgress}
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
          <VideoLibrary
            videos={analysis.videos}
            selectedId={analysis.video?.id ?? null}
            disabled={analysis.busy || analysis.status === 'uploading'}
            selectVideo={analysis.selectVideo}
            deleteVideo={analysis.deleteVideo}
            loadFile={analysis.loadFile}
          />
        </section>
        <aside className="rail" aria-label="Analysis">
          {analysis.error !== null && (
            <div className="alert" role="alert">
              {analysis.error}
            </div>
          )}
          <ActionBar
            status={analysis.status}
            canStart={analysis.canStart}
            hasVideo={analysis.video !== null}
            connected={analysis.connected}
            start={analysis.start}
            pause={analysis.pause}
            resume={analysis.resume}
            stop={analysis.stop}
            reset={analysis.reset}
          />
          <CountBoard counts={analysis.counts} status={analysis.status} />
          <ZonesPanel
            zones={analysis.counts.zones}
            zoneEditing={analysis.zoneEditing}
            setZoneEditing={analysis.setZoneEditing}
            activeZoneId={analysis.activeZoneId}
            setActiveZone={analysis.setActiveZone}
            addZone={analysis.addZone}
            removeZone={analysis.removeZone}
            updateZoneOrientation={analysis.updateZoneOrientation}
            busy={analysis.busy}
            hasVideo={analysis.video !== null}
          />
          <FlowChart events={analysis.events} durationSeconds={analysis.progress.durationSeconds} />
          <ConfigPanel
            config={analysis.config}
            models={analysis.models}
            gpuAvailable={analysis.gpuAvailable}
            providers={analysis.providers}
            disabled={analysis.busy}
            setModel={analysis.setModel}
            setDevice={analysis.setDevice}
            setConfidence={analysis.setConfidence}
            setSamplingFps={analysis.setSamplingFps}
          />
          <ExportPanel eventCount={analysis.events.length} exportUrl={analysis.exportUrl} />
        </aside>
      </main>
    </div>
  )
}
