import { useState } from 'react'
import graph, { GRAPH_COMPACTNESS_MAX, GRAPH_COMPACTNESS_MIN, type GraphLineMode } from '../../data/graph'
import { SettingsSection } from './SettingsShared'

export default function GraphSettings() {
  const [graphCompactness, setGraphCompactnessState] = useState(() => graph.settings.line.compactness.get())
  const [graphLineMode, setGraphLineModeState] = useState<GraphLineMode>(() => graph.settings.line.mode.get())
  const [graphHeatmapUseMultiColor, setGraphHeatmapUseMultiColorState] = useState(() => graph.settings.heatmap.multiColor.get())

  return <SettingsSection title="Graphs settings">
    <div className="rangeRow">
      <span className="rangeLabel">Compact</span>
      <input
        id="graph-compactness"
        className="rangeInput rangeInputInline"
        type="range"
        min={GRAPH_COMPACTNESS_MIN}
        max={GRAPH_COMPACTNESS_MAX}
        step={1}
        value={graphCompactness}
        onChange={event => setGraphCompactnessState(graph.settings.line.compactness.set(Number(event.target.value)))}
      />
      <span className="rangeLabel">Spread out</span>
    </div>
    <div className="panelRow">
      <span>Line style</span>
      <span className="panelRowValue">
        <select
          className="lockInput panelInlineSelect"
          value={graphLineMode}
          onChange={event => setGraphLineModeState(graph.settings.line.mode.set(event.target.value as GraphLineMode))}
        >
          <option value="raw">Raw daily line</option>
          <option value="raw_plus_10">Raw + 10-day avg</option>
          <option value="avg10_all_days">10-day avg all days</option>
        </select>
      </span>
    </div>
    <div className="panelRow">
      <span>Heatmap colors</span>
      <span className="panelRowValue">
        <select
          className="lockInput panelInlineSelect"
          value={graphHeatmapUseMultiColor ? 'multi' : 'single'}
          onChange={event => setGraphHeatmapUseMultiColorState(graph.settings.heatmap.multiColor.set(event.target.value === 'multi'))}
        >
          <option value="multi">Colored</option>
          <option value="single">Faded</option>
        </select>
      </span>
    </div>
  </SettingsSection>
}
