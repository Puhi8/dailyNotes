import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import type { DayEntry, ServerData } from '../data/types'
import graph, { type ChartPoint } from '../data/graph'
import { LineChart, XAxis, YAxis, Line, ResponsiveContainer, CartesianGrid, Tooltip } from 'recharts'
import { formatDateKey } from '../utils/functions'
import { dayKey } from '../data/localCore'
import { months } from '../data/data'

type HeatmapTooltip = {
  x: number
  y: number
  date: string
}

export default function HomeGraphs({ data }: { data: ServerData }) {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 })
  const [chartView, setChartView] = useState<'line' | 'heatmap'>('line')
  const lineMode = graph.settings.line.mode.get()
  const showRawLine = lineMode !== 'avg10_all_days'
  const showAverageLine = lineMode !== 'raw'
  const pointLimit = graph.line.pointLimit(chartSize.width, graph.settings.line.compactness.get())
  const rangeDates = graph.dates.range(data.graph.start, data.graph.end)
  const dateList = (rangeDates.length > 0 ? rangeDates : Object.keys(data.data)
    .filter(date => date !== formatDateKey(new Date())).sort(graph.dates.compareKeys))
  const rangeStart = dateList.length > 0 ? dateList[0] : ''
  const rangeEnd = dateList.length > 0 ? dateList[dateList.length - 1] : ''
  const averageAllDaysOnly = lineMode === 'avg10_all_days'
  const lineDates = pointLimit > 0 && dateList.length > pointLimit ? dateList.slice(-pointLimit) : dateList
  const shownLineDates = averageAllDaysOnly ? dateList : lineDates

  return <section className="chartCard">
    <div className="chartHeader">
      <div className="chartHeaderRow">
        <h2>Activity</h2>
        <div className="chartActions">
          <button
            className={chartView === 'line' ? 'active' : undefined}
            onClick={() => setChartView('line')}
          >
            Line
          </button>
          <button
            className={chartView === 'heatmap' ? 'active' : undefined}
            onClick={() => setChartView('heatmap')}
          >
            Heatmap
          </button>
        </div>
      </div>
      {chartView === 'line' && averageAllDaysOnly
        ? <p>10-day average across all {dateList.length} days</p>
        : <p>Last {shownLineDates.length} days{showAverageLine ? ' (raw + 10-day average)' : ''}</p>
      }
    </div>
    <div className={`chartArea ${chartView === 'heatmap' ? 'chartAreaCompact' : ''}`}>
      {chartView === 'line'
        ? <HomeGraph
          dates={shownLineDates}
          chartSize={chartSize}
          dataByDate={data.data}
          showRawLine={showRawLine}
          showAverageLine={showAverageLine}
          averageAllDaysOnly={averageAllDaysOnly}
          onResize={setChartSize}
        />
        : <Heatmap range={{ start: rangeStart, end: rangeEnd }} dataByDate={data.data} />
      }
    </div>
  </section>
}

type HomeGraphProps = {
  dates: string[]
  chartSize: { width: number, height: number }
  dataByDate: Record<string, DayEntry>
  showRawLine: boolean
  showAverageLine: boolean
  averageAllDaysOnly: boolean
  onResize: (size: { width: number; height: number }) => void
}

function HomeGraph({ dates, chartSize, dataByDate, showRawLine, showAverageLine, averageAllDaysOnly, onResize }: HomeGraphProps) {
  const safeMaxValue = 100
  const chartData = graph.line.build(dates, dataByDate)
  const isMobileChart = chartSize.width > 0 && chartSize.width <= 560
  const targetXTicks = isMobileChart ? 4 : 7
  return <ResponsiveContainer
    width="100%"
    height="100%"
    onResize={(width, height) => onResize({ width, height })}
  >
    <LineChart
      data={chartData}
      margin={{ top: 16, right: 24, bottom: 16 }}
    >
      <defs>
        <linearGradient
          id="lineGradient"
          x1="0"
          y1={0}
          x2="0"
          y2={chartSize.height || 300}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--good)" />
          <stop offset="50%" stopColor="var(--warn)" />
          <stop offset="100%" stopColor="var(--danger)" />
        </linearGradient>
      </defs>
      <CartesianGrid horizontal vertical={false} strokeDasharray="2 6" />
      <XAxis
        dataKey="date"
        tick={{ fill: 'var(--muted)', fontSize: isMobileChart ? 11 : 12 }}
        tickFormatter={graph.dates.axisLabel}
        interval={chartData.length > targetXTicks ? Math.ceil(chartData.length / targetXTicks) - 1 : 0}
        minTickGap={isMobileChart ? 24 : 12}
        tickMargin={8}
        padding={isMobileChart ? { left: 6, right: 6 } : { left: 10, right: 10 }}
      />
      <YAxis
        interval={0}
        width={8}
        tickCount={safeMaxValue > 10 ? 6 : safeMaxValue + 1}
        domain={[0, safeMaxValue]}
        tick={{ fill: 'var(--muted)', fontSize: 0 }}
      />
      <Tooltip content={<GraphTooltip dataByDate={dataByDate} />} />
      {showRawLine && <Line
        type="linear"
        dataKey="raw"
        stroke="url(#lineGradient)"
        strokeWidth={showAverageLine ? 2.4 : 3}
        strokeOpacity={showAverageLine ? 0.7 : 1}
        dot={({ cx, cy, value }) => {
          if (typeof value !== 'number' || cx == null || cy == null) return null
          return <circle
            cx={cx}
            cy={cy}
            r={4}
            fill={graph.colors.progress(value)}
            stroke="var(--panel)"
            strokeWidth={1}
          />
        }}
      ></Line>}
      {showAverageLine && <Line
        type="monotone"
        dataKey="smooth10"
        stroke="var(--warn)"
        strokeWidth={averageAllDaysOnly ? 3.2 : 3}
        dot={false}
      />}
    </LineChart>
  </ResponsiveContainer>
}

function Heatmap({ range, dataByDate }: { range: { start: string, end: string }, dataByDate: Record<string, DayEntry> }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<HeatmapTooltip | null>(null)
  const [splitByMonth, setSplitByMonth] = useState(false)
  const weeks = graph.heatmap.weeks(range.start, range.end)
  const useMultiColor = graph.settings.heatmap.multiColor.get()
  const monthBlocks = graph.heatmap.monthBlocks(range.start, range.end)
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const update = () => {
      const width = wrapper.clientWidth
      if (!width) return
      const cellSize = Number.parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--heatmap-cell')) || 12
      const gap = 4
      const weekCount = weeks.length
      const estimatedWidth = weekCount > 0 ? (weekCount * cellSize) + ((weekCount - 1) * gap) : 0
      const nextSplit = estimatedWidth > width
      setSplitByMonth(current => (current === nextSplit ? current : nextSplit))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [weeks.length])

  if (!(weeks && weeks.length > 0)) return <div className="heatmapEmpty">No heatmap data</div>

  const todayKey = dayKey.today()
  const combinedMonthLabels: string[] = []
  let lastMonthLabel = ''
  weeks.forEach(week => {
    const anchor = week.find(date => Boolean(dataByDate[date])) ?? week[0]
    if (!anchor) {
      combinedMonthLabels.push('')
      return
    }
    const parts = anchor.split('-')
    const month = parts.length === 3 ? Number.parseInt(parts[1], 10) : Number.NaN
    if (!Number.isFinite(month)) {
      combinedMonthLabels.push('')
      return
    }
    const label = months.short[month - 1] ?? ''
    if (label && label !== lastMonthLabel) {
      combinedMonthLabels.push(label)
      lastMonthLabel = label
    }
    else combinedMonthLabels.push('')
  })
  const tooltipEntries = tooltip ? Object.entries(dataByDate[tooltip.date]?.data ?? {}) : []
  const orderedBlocks = splitByMonth ? [...monthBlocks].reverse() : monthBlocks
  return <div className="heatmapWrapper" ref={wrapperRef} onMouseLeave={() => setTooltip(null)}>
    <div className="heatmapMonthGrid">
      {splitByMonth
        ? orderedBlocks.map((block, blockIndex) => (
          <div className="heatmapMonthBlock" key={`month-${blockIndex}-${block.label}`}>
            <div className="heatmapMonths">
              {block.weeks.map((_, labelIndex) => (
                <div className="heatmapMonth" key={`month-${blockIndex}-${labelIndex}`}>
                  {labelIndex === 0 ? block.label : ''}
                </div>
              ))}
            </div>
            <div className="heatmap">
              {block.weeks.map((week, weekIndex) => (
                <div className="heatmapWeek" key={`week-${blockIndex}-${weekIndex}`}>
                  {week.map((date, dayIndex) => {
                    if (!date) return <div key={`empty-${weekIndex}-${dayIndex}`} className="heatmapSpacer" />
                    return makeHeatmapWeek(dataByDate, date, todayKey, setTooltip, useMultiColor)
                  })}
                </div>
              ))}
            </div>
          </div>
        ))
        : <div className="heatmapMonthBlock">
          <div className="heatmapMonths">
            {combinedMonthLabels.map((label, labelIndex) => (
              <div className="heatmapMonth" key={`month-combined-${labelIndex}`}>{label}</div>
            ))}
          </div>
          <div className="heatmap">
            {weeks.map((week, weekIndex) => (
              <div className="heatmapWeek" key={`week-combined-${weekIndex}`}>
                {week.map(date => makeHeatmapWeek(dataByDate, date, todayKey, setTooltip, useMultiColor))}
              </div>
            ))}
          </div>
        </div>
      }
    </div>
    {tooltip && <div className="heatmapTooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <div className="heatmapTooltipTitle">{tooltip.date}</div>
      <div className="heatmapTooltipList">{(tooltipEntries.length === 0)
        ? <div className="heatmapTooltipEmpty">No checklist entries</div>
        : tooltipEntries.map(([key, value]) => (
          <div key={key} className="heatmapTooltipRow">
            <span>{key}</span>
            <span>{formatTooltipValue(value)}</span>
          </div>
        ))
      }</div>
    </div>}
  </div>
}

function makeHeatmapWeek(
  dataByDate: Record<string, DayEntry>,
  date: string,
  todayKey: string,
  setTooltip: Dispatch<SetStateAction<HeatmapTooltip | null>>,
  useMultiColor: boolean,
) {
  function heatmapMouseAction(event: MouseEvent, date: string) {
    const container = event.currentTarget.closest('.heatmapWrapper') as HTMLElement | null
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = rect.left - containerRect.left + rect.width + 8
    const y = rect.top - containerRect.top - 4
    setTooltip({ x, y, date })
  }
  const entry = dataByDate[date]
  if (!entry) return <div key={date} className="heatmapSpacer" />
  const heatColor = (useMultiColor ? graph.colors.progress : graph.heatmap.singleHueColor)(entry.percent)
  return <div
    key={date}
    className={`heatmapCell${date === todayKey ? ' heatmapCellToday' : ''}`}
    style={{ '--heat-color': heatColor } as CSSProperties}
    onMouseEnter={event => heatmapMouseAction(event, date)}
  />
}

type GraphTooltipProps = {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: ChartPoint }>
  dataByDate: Record<string, DayEntry>
}

function formatTooltipValue(value: string | number | boolean | null | undefined) {
  if (typeof value === 'boolean') return value ? 'Done' : 'Failed'
  if (value == null || value === "") return 'N/A'
  return String(value)
}

function GraphTooltip({ active, label, payload, dataByDate }: GraphTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload
  if (!point) return null
  const dateKey = typeof label === 'string' ? label : point.date
  const entries = Object.entries(dateKey ? (dataByDate[dateKey]?.data ?? {}) : {})
  return <div
    style={{
      background: 'var(--panel-strong)',
      borderRadius: 12,
      border: '1px solid var(--panel-edge)',
      boxShadow: '0 12px 30px rgba(58, 64, 75, 0.55)',
      color: 'var(--text)',
      padding: '10px 12px',
      minWidth: 180,
    }}
  >
    <div style={{ fontWeight: 600, marginBottom: 6 }}>{dateKey || label || ''}</div>
    {entries.length === 0
      ? <div style={{ color: 'var(--muted)' }}>No checklist entries</div>
      : entries.map(([key, value]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{key}</span>
          <span style={{ color: 'var(--muted)' }}>{formatTooltipValue(value)}</span>
        </div>
      ))
    }
  </div>
}
