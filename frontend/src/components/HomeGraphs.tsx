import { useEffect, useState, type CSSProperties } from 'react'
import type { DayEntry, ServerData } from '../data/types'
import graph from '../data/graph'
import { LineChart, XAxis, YAxis, Line, ResponsiveContainer, CartesianGrid, Tooltip } from 'recharts'
import { dayKey } from '../data/localCore'
import { months } from '../data/data'
import { eventListener } from '../utils/functions'

type SelectDay = (date: string | null) => void
type ChartView = 'line' | 'heatmap'

const ACTIVE_DOT = { r: 6, fill: 'var(--text)', stroke: 'var(--panel)', strokeWidth: 2 }

export default function HomeGraphs({ data }: { data: ServerData }) {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 })
  const [chartView, setChartView] = useState<ChartView>('line')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const lineMode = graph.settings.line.mode.get()
  const showRawLine = lineMode !== 'avg10_all_days'
  const showAverageLine = lineMode !== 'raw'
  const pointLimit = graph.line.pointLimit(chartSize.width, graph.settings.line.compactness.get())
  const todayKey = dayKey.today()
  const rangeDates = graph.dates.range(data.graph.start, data.graph.end)
  const dateList = (rangeDates.length > 0 ? rangeDates : Object.keys(data.data))
    .filter(date => date !== todayKey)
    .sort(graph.dates.compareKeys)
  const rangeStart = dateList.length > 0 ? dateList[0] : ''
  const rangeEnd = dateList.length > 0 ? dateList[dateList.length - 1] : ''
  const averageAllDaysOnly = lineMode === 'avg10_all_days'
  const lineDates = pointLimit > 0 && dateList.length > pointLimit ? dateList.slice(-pointLimit) : dateList
  const shownLineDates = averageAllDaysOnly ? dateList : lineDates
  const showView = (view: ChartView) => {
    setChartView(view)
    setSelectedDate(null)
  }

  return <section className="chartCard">
    <div className="chartHeader">
      <div className="chartHeaderRow">
        <h2>Activity</h2>
        <div className="chartActions">
          <button
            className={chartView === 'line' ? 'active' : undefined}
            onClick={() => showView('line')}
          >
            Line
          </button>
          <button
            className={chartView === 'heatmap' ? 'active' : undefined}
            onClick={() => showView('heatmap')}
          >
            Heatmap
          </button>
        </div>
      </div>
      {chartView === 'line' && averageAllDaysOnly
        ? <p>10-day average across all {dateList.length} days</p>
        : <p>Last {shownLineDates.length} days{showAverageLine ? ' (raw + 10-day average)' : ''}</p>
      }
      {selectedDate && <DayPopup date={selectedDate} entry={data.data[selectedDate]} />}
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
          onSelect={setSelectedDate}
        />
        : <Heatmap
          range={{ start: rangeStart, end: rangeEnd }}
          dataByDate={data.data}
          todayKey={todayKey}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />
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
  onSelect: SelectDay
}

function HomeGraph({ dates, chartSize, dataByDate, showRawLine, showAverageLine, averageAllDaysOnly, onResize, onSelect }: HomeGraphProps) {
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
      <Tooltip content={<TooltipSelection onSelect={onSelect} />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
      {showRawLine && <Line
        type="linear"
        dataKey="raw"
        stroke="url(#lineGradient)"
        strokeWidth={showAverageLine ? 2.4 : 3}
        strokeOpacity={showAverageLine ? 0.7 : 1}
        activeDot={ACTIVE_DOT}
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
        activeDot={showRawLine ? false : ACTIVE_DOT}
      />}
    </LineChart>
  </ResponsiveContainer>
}

function Heatmap({ range, dataByDate, todayKey, selectedDate, onSelect }: {
  range: { start: string, end: string }
  dataByDate: Record<string, DayEntry>
  todayKey: string
  selectedDate: string | null
  onSelect: SelectDay
}) {
  // Newest week first, so it is on the left and a wide heatmap opens on it without scrolling.
  const weeks = graph.heatmap.weeks(range.start, range.end).reverse()
  const useMultiColor = graph.settings.heatmap.multiColor.get()

  useEffect(() => {
    if (!selectedDate) return
    return eventListener.document(['pointerdown'], event => {
      if (!(event.target as Element | null)?.closest?.('.heatmapWrapper')) onSelect(null)
    })
  }, [onSelect, selectedDate])

  if (!(weeks && weeks.length > 0)) return <div className="heatmapEmpty">No heatmap data</div>

  const renderContext = { dataByDate, todayKey, selectedDate, onSelect, useMultiColor }
  // Only a real mouse leaving clears the day; a lifted finger also "leaves", so on a phone the day stays until another tap.
  return <div className="heatmapWrapper" onPointerLeave={event => { if (event.pointerType === 'mouse') onSelect(null) }}>
    <div className="heatmapScroll">
      <div className="heatmapGrid">
        <div className="heatmapMonths">
          {heatmapMonthLabels(weeks).map((label, weekIndex) => <div className="heatmapMonth" key={`month-${weekIndex}`}>{label}</div>)}
        </div>
        <div className="heatmap">{weeks.map((week, weekIndex) => renderHeatmapWeekColumn(week, weeks[weekIndex + 1], String(weekIndex), renderContext))}</div>
      </div>
    </div>
  </div>
}

type HeatmapWeek = Array<string | null>

type HeatmapRenderContext = {
  dataByDate: Record<string, DayEntry>
  todayKey: string
  selectedDate: string | null
  onSelect: SelectDay
  useMultiColor: boolean
}

const monthKey = (date: string | null | undefined) => date?.slice(0, 5)

// The month line runs in the gaps, right of a day whose same weekday in the older column is in another month,
// and below a day whose next day is; those pieces join into one line that steps where a month starts mid-week.
const monthEdges = (date: string, olderDate: string | null | undefined, nextDate: string | null | undefined) => [
  olderDate && monthKey(olderDate) !== monthKey(date) ? ' heatmapEdgeRight' : '',
  nextDate && monthKey(nextDate) !== monthKey(date) ? ' heatmapEdgeBottom' : ''
].join('')

const renderHeatmapWeekColumn = (week: HeatmapWeek, olderWeek: HeatmapWeek | undefined, keyPrefix: string, context: HeatmapRenderContext) => (
  <div className="heatmapWeek" key={`week-${keyPrefix}`}>
    {week.map((date, dayIndex) => {
      if (!date) return <div key={`empty-${keyPrefix}-${dayIndex}`} className="heatmapSpacer" />
      const edges = monthEdges(date, olderWeek?.[dayIndex], week[dayIndex + 1])
      return makeHeatmapWeek(date, edges, context)
    })}
  </div>
)

const monthLabel = (date: string) => months.short[Number(date.split('-')[1]) - 1] ?? ''

// A week belongs to the month of its Thursday, the month holding most of its days; each month is named above its leftmost (newest) week.
function heatmapMonthLabels(weeks: HeatmapWeek[]) {
  const weekMonths = weeks.map(week => monthLabel(week[3] ?? ''))
  const labels = weekMonths.map((month, weekIndex) => month !== weekMonths[weekIndex - 1] ? month : '')
  // The current month can be only a week old; its name then gives way instead of overlapping the next one.
  const nextLabelIndex = labels.findIndex((label, weekIndex) => weekIndex > 0 && label !== '')
  if (nextLabelIndex !== -1 && nextLabelIndex < 2) labels[0] = ''
  return labels
}

function makeHeatmapWeek(date: string, edges: string, { dataByDate, todayKey, selectedDate, onSelect, useMultiColor }: HeatmapRenderContext) {
  const entry = dataByDate[date]
  if (!entry) return <div key={date} className={`heatmapSpacer${edges}`} />
  const heatColor = (useMultiColor ? graph.colors.progress : graph.heatmap.singleHueColor)(entry.percent)
  return <div
    key={date}
    className={`heatmapCell${date === todayKey ? ' heatmapCellToday' : ''}${date === selectedDate ? ' heatmapCellSelected' : ''}${edges}`}
    style={{ '--heat-color': heatColor } as CSSProperties}
    onMouseEnter={() => onSelect(date)}
    // A tap on a phone does not always count as the mouse entering, but it is always a click.
    onClick={() => onSelect(date)}
  />
}

// Recharts still tracks which day the mouse or finger is on; this passes it up instead of drawing a floating box.
function TooltipSelection({ active, label, onSelect }: { active?: boolean, label?: string, onSelect: SelectDay }) {
  useEffect(() => onSelect(active && typeof label === 'string' ? label : null), [active, label, onSelect])
  return null
}

// Covers the card header, never the graph, so the selected day stays visible; it grows upward when a day has many entries.
function DayPopup({ date, entry }: { date: string, entry?: DayEntry }) {
  const entries = Object.entries(entry?.data ?? {})
  return <div className="chartDayPopup" role="status">
    <div className="chartDayPopupTitle">{date}</div>
    {entries.length === 0
      ? <div className="chartDayPopupEmpty">No checklist entries</div>
      : <div className="chartDayPopupList">
        {entries.map(([key, value]) => <span key={key}>{key}: <span className="chartDayPopupValue">{formatTooltipValue(value)}</span></span>)}
      </div>
    }
  </div>
}

function formatTooltipValue(value: string | number | boolean | null | undefined) {
  if (typeof value === 'boolean') return value ? 'Done' : 'Failed'
  if (value == null || value === "") return 'N/A'
  return String(value)
}
