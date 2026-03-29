import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import type { DayEntry, ServerData } from '../data/types'
import { calculateGraphPointLimit, getGraphCompactness } from '../data/graphSettings'
import { LineChart, XAxis, YAxis, Line, ResponsiveContainer, CartesianGrid, Tooltip } from 'recharts'
import { formatDateKey, pad2 } from '../utils/functions'

type ChartPoint = {
  date: string
  value: number
}

type HeatmapMonthBlock = {
  label: string
  weeks: Array<Array<string | null>>
}

type HeatmapTooltip = {
  x: number
  y: number
  date: string
}

const parseDateKey = (key: string) => {
  const parts = key.split('-')
  if (parts.length !== 3) return null
  const year = Number.parseInt(parts[0], 10)
  const month = Number.parseInt(parts[1], 10)
  const day = Number.parseInt(parts[2], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const fullYear = 2000 + year
  const date = new Date(Date.UTC(fullYear, month - 1, day))
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

const formatAxisDate = (key: string) => {
  const parts = key.split('-')
  if (parts.length !== 3) return key
  return `${parts[1]}-${parts[2]}`
}

const buildDateRange = (startKey: string, endKey: string) => {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)
  if (!start || !end || start.getTime() > end.getTime()) return []
  const dates: string[] = []
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(formatDateKey(cursor))
  }
  return dates
}

const compareDateKeys = (a: string, b: string) => {
  const first = parseDateKey(a)
  const second = parseDateKey(b)
  if (!first || !second) return a.localeCompare(b)
  return first.getTime() - second.getTime()
}

const buildHeatmapWeeks = (startKey: string, endKey: string) => {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)
  if (!start || !end || start.getTime() > end.getTime()) return []
  const alignedStart = new Date(start.getTime())
  while (alignedStart.getUTCDay() !== 1) {
    alignedStart.setUTCDate(alignedStart.getUTCDate() - 1)
  }
  const alignedEnd = new Date(end.getTime())
  while (alignedEnd.getUTCDay() !== 0) {
    alignedEnd.setUTCDate(alignedEnd.getUTCDate() + 1)
  }
  const weeks: string[][] = []
  let currentWeek: string[] = []
  for (let cursor = new Date(alignedStart.getTime()); cursor.getTime() <= alignedEnd.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    currentWeek.push(formatDateKey(cursor))
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  return weeks
}

const getMonth = (date: Date, extra = 0, day = 1) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + extra, day))

const buildHeatmapMonthBlocks = (startKey: string, endKey: string) => {
  const rangeStart = parseDateKey(startKey)
  const rangeEnd = parseDateKey(endKey)
  if (!rangeStart || !rangeEnd || rangeStart.getTime() > rangeEnd.getTime()) return []
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const startMonth = getMonth(rangeStart)
  const endMonth = getMonth(rangeEnd)
  const blocks: HeatmapMonthBlock[] = []
  for (let cursor = new Date(startMonth.getTime()); cursor.getTime() <= endMonth.getTime(); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const monthStart = getMonth(cursor)
    const monthEnd = getMonth(cursor, 1, 0)
    const visibleStart = new Date(Math.max(monthStart.getTime(), rangeStart.getTime()))
    const visibleEnd = new Date(Math.min(monthEnd.getTime(), rangeEnd.getTime()))
    if (visibleStart.getTime() > visibleEnd.getTime()) continue
    const alignedStart = new Date(visibleStart.getTime())
    while (alignedStart.getUTCDay() !== 1) {
      alignedStart.setUTCDate(alignedStart.getUTCDate() - 1)
    }
    const alignedEnd = new Date(visibleEnd.getTime())
    while (alignedEnd.getUTCDay() !== 0) {
      alignedEnd.setUTCDate(alignedEnd.getUTCDate() + 1)
    }
    const weeks: Array<Array<string | null>> = []
    let currentWeek: Array<string | null> = []
    for (let day = new Date(alignedStart.getTime()); day.getTime() <= alignedEnd.getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
      const inRange = day.getTime() >= visibleStart.getTime() && day.getTime() <= visibleEnd.getTime()
      currentWeek.push(inRange ? formatDateKey(day) : null)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
    }
    blocks.push({ label: monthNames[cursor.getUTCMonth()], weeks })
  }
  return blocks
}

export default function HomeGraphs({ data }: { data: ServerData }) {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 })
  const [chartView, setChartView] = useState<'line' | 'heatmap'>('line')
  const compactness = getGraphCompactness()
  const pointLimit = calculateGraphPointLimit(chartSize.width, compactness)
  const dataByDate = data.data
  const rangeDates = buildDateRange(data.graph.start, data.graph.end)
  const dateList = rangeDates.length > 0 ? rangeDates : Object.keys(dataByDate).sort(compareDateKeys)
  const rangeStart = dateList.length > 0 ? dateList[0] : ''
  const rangeEnd = dateList.length > 0 ? dateList[dateList.length - 1] : ''
  const lineDates = pointLimit > 0 && dateList.length > pointLimit
    ? dateList.slice(-pointLimit)
    : dateList

  return <section className="chartCard">
    <div className="chartHeader">
      <div>
        <h2>Activity</h2>
        {chartView === 'line' && <p>Last {lineDates.length} days</p>}
      </div>
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
    <div className={`chartArea ${chartView === 'heatmap' ? 'chartAreaCompact' : ''}`}>
      {chartView === 'line'
        ? <HomeGraph
          dates={lineDates}
          chartHeight={chartSize.height}
          dataByDate={dataByDate}
          onResize={setChartSize}
        />
        : <Heatmap weeks={buildHeatmapWeeks(rangeStart, rangeEnd)} monthBlocks={buildHeatmapMonthBlocks(rangeStart, rangeEnd)} dataByDate={dataByDate} />
      }
    </div>
  </section>
}

type HomeGraphProps = {
  dates: string[]
  chartHeight: number
  dataByDate: Record<string, DayEntry>
  onResize: (size: { width: number; height: number }) => void
}

function HomeGraph({ dates, chartHeight, dataByDate, onResize }: HomeGraphProps) {
  const safeMaxValue = 100
  const gradientHeight = chartHeight || 300
  const tickCount = safeMaxValue > 10 ? 6 : safeMaxValue + 1
  const chartData: ChartPoint[] = dates.map(date => ({ date, value: dataByDate[date]?.percent ?? 0 }))
  const getPointColor = (value: number) => {
    const ratio = Math.max(0, Math.min(1, value / safeMaxValue))
    const danger = '#e05d4e'
    const warn = '#f29f58'
    const good = '#2fb890'
    const toRgb = (hex: string) => {
      const normalized = hex.replace('#', '')
      const r = parseInt(normalized.slice(0, 2), 16)
      const g = parseInt(normalized.slice(2, 4), 16)
      const b = parseInt(normalized.slice(4, 6), 16)
      return { r, g, b }
    }
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
    const blend = (from: string, to: string, t: number) => {
      const a = toRgb(from)
      const b = toRgb(to)
      return `rgb(${lerp(a.r, b.r, t)}, ${lerp(a.g, b.g, t)}, ${lerp(a.b, b.b, t)})`
    }
    if (ratio <= 0.5) return blend(danger, warn, ratio / 0.5)
    return blend(warn, good, (ratio - 0.5) / 0.5)
  }
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
          y2={gradientHeight}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="50%" stopColor="var(--warn)" />
          <stop offset="100%" stopColor="var(--danger)" />
        </linearGradient>
      </defs>
      <CartesianGrid horizontal vertical={false} strokeDasharray="2 6" />
      <XAxis
        dataKey="date"
        tick={{ fill: 'var(--muted)', fontSize: 12 }}
        tickFormatter={formatAxisDate}
        interval="preserveStartEnd"
      />
      <YAxis
        interval={0}
        width={8}
        tickCount={tickCount}
        domain={[0, safeMaxValue]}
        tick={{ fill: 'var(--muted)', fontSize: 0 }}
      />
      <Tooltip content={<GraphTooltip dataByDate={dataByDate} />} />
      <Line
        dataKey="value"
        stroke="url(#lineGradient)"
        strokeWidth={3}
        dot={({ cx, cy, value }) => {
          if (typeof value !== 'number' || cx == null || cy == null) return null
          return <circle
            cx={cx}
            cy={cy}
            r={4}
            fill={getPointColor(value)}
            stroke="var(--panel)"
            strokeWidth={1}
          />
        }}
      ></Line>
    </LineChart>
  </ResponsiveContainer>
}

function Heatmap({ weeks, monthBlocks, dataByDate }: { weeks: string[][]; monthBlocks: HeatmapMonthBlock[]; dataByDate: Record<string, DayEntry> }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<HeatmapTooltip | null>(null)
  const [splitByMonth, setSplitByMonth] = useState(false)
  const hasData = Boolean(weeks && weeks.length > 0)
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

  if (!hasData) return <div className="heatmapEmpty">No heatmap data</div>

  const now = new Date()
  const todayKey = `${pad2(now.getFullYear() % 100)}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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
    const label = monthNames[month - 1] ?? ''
    if (label && label !== lastMonthLabel) {
      combinedMonthLabels.push(label)
      lastMonthLabel = label
    } else combinedMonthLabels.push('')
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
                    return makeHeatmapWeek(dataByDate, date, todayKey, setTooltip)
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
                {week.map(date => makeHeatmapWeek(dataByDate, date, todayKey, setTooltip))}
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
  setTooltip: Dispatch<SetStateAction<HeatmapTooltip | null>>
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
  return <div
    key={date}
    className={`heatmapCell${date === todayKey ? ' heatmapCellToday' : ''}`}
    style={{ '--heat': `${entry.percent}%` } as CSSProperties}
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
