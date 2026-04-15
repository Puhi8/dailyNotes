import { manageLocalStorage } from "../utils/localProcessing"
import type { DayEntry } from './types'
import { formatDateKey } from "../utils/functions"
import { months } from "./data"
import { getAccentColorRgb } from './theme'

const GRAPH_SETTINGS_KEY = 'dailynotes.graphSettings'

export const GRAPH_COMPACTNESS_MIN = 1
export const GRAPH_COMPACTNESS_MAX = 15
const GRAPH_COMPACTNESS_DEFAULT = 8
export type GraphLineMode = 'raw' | 'raw_plus_10' | 'avg10_all_days'
export type ChartPoint = {
  date: string
  raw: number
  smooth10: number
}

type HeatmapMonthBlock = {
  label: string
  weeks: Array<Array<string | null>>
}

const clampCompactness = (value: number) => Math.min(GRAPH_COMPACTNESS_MAX, Math.max(GRAPH_COMPACTNESS_MIN, value))
const isGraphLineMode = (value: string | null): value is GraphLineMode => value === 'raw' || value === 'raw_plus_10' || value === 'avg10_all_days'

type GraphSettingsStorage = {
  compactness: number
  lineMode: GraphLineMode
  heatmapUseMultiColor: boolean
}

const DEFAULT_GRAPH_SETTINGS: GraphSettingsStorage = {
  compactness: GRAPH_COMPACTNESS_DEFAULT,
  lineMode: 'raw',
  heatmapUseMultiColor: true,
}

const normalizeGraphSettings = (value: Partial<GraphSettingsStorage> | null | undefined): GraphSettingsStorage => {
  const compactnessParsed = Number(value?.compactness)
  const lineModeRaw = typeof value?.lineMode === 'string' ? value.lineMode : null
  return {
    compactness: Number.isFinite(compactnessParsed) ? clampCompactness(compactnessParsed) : DEFAULT_GRAPH_SETTINGS.compactness,
    lineMode: isGraphLineMode(lineModeRaw) ? lineModeRaw : DEFAULT_GRAPH_SETTINGS.lineMode,
    heatmapUseMultiColor: typeof value?.heatmapUseMultiColor === 'boolean' ? value.heatmapUseMultiColor : DEFAULT_GRAPH_SETTINGS.heatmapUseMultiColor,
  }
}

const readGraphSettings = (): GraphSettingsStorage => {
  if (typeof window === 'undefined') return DEFAULT_GRAPH_SETTINGS
  const raw = manageLocalStorage.get(GRAPH_SETTINGS_KEY, null)
  if (raw == null) {
    manageLocalStorage.set({ key: GRAPH_SETTINGS_KEY, value: JSON.stringify(DEFAULT_GRAPH_SETTINGS) })
    return DEFAULT_GRAPH_SETTINGS
  }
  try { return normalizeGraphSettings(JSON.parse(raw) as Partial<GraphSettingsStorage>) }
  catch {
    manageLocalStorage.set({ key: GRAPH_SETTINGS_KEY, value: JSON.stringify(DEFAULT_GRAPH_SETTINGS) })
    return DEFAULT_GRAPH_SETTINGS
  }
}

const calculateGraphPointLimit = (width: number, compactness: number) => {
  if (!Number.isFinite(width) || width <= 0) return 0
  const ratio = 1 - (clampCompactness(compactness) - GRAPH_COMPACTNESS_MIN) / (GRAPH_COMPACTNESS_MAX - GRAPH_COMPACTNESS_MIN)
  const maxSpacing = 40
  const minSpacing = 4
  const spacing = maxSpacing - (maxSpacing - minSpacing) * ratio
  return Math.max(7, Math.floor(width / spacing))
}

function graphSetting<K extends keyof GraphSettingsStorage>(key: K): GraphSettingsStorage[K]
function graphSetting<K extends keyof GraphSettingsStorage>(key: K, value: GraphSettingsStorage[K]): GraphSettingsStorage[K]
function graphSetting<K extends keyof GraphSettingsStorage>(key: K, value?: GraphSettingsStorage[K]) {
  if (value === undefined) return readGraphSettings()[key]
  const normalizedValue = key === 'compactness' ? (clampCompactness(value as number) as GraphSettingsStorage[K]) : value
  manageLocalStorage.set({ key: GRAPH_SETTINGS_KEY, value: JSON.stringify({ ...readGraphSettings(), [key]: normalizedValue } as GraphSettingsStorage) })
  return normalizedValue
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

const getMonth = (date: Date, extra = 0, day = 1) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + extra, day))

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
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + 86400000)) { // 86400000 = 1 day
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

const alignDate = (date: Date, type: "start" | "end") => {
  const d = new Date(date.getTime())
  const day = d.getUTCDay()
  const offset = type === "start" ? (day === 0 ? -6 : 1 - day) : (7 - day) % 7
  return (d.setUTCDate(d.getUTCDate() + offset), d)
}

const buildWeeks = (start: Date, end: Date, map: (d: Date) => string | null) => {
  const alignedStart = alignDate(start, "start")
  const alignedEnd = alignDate(end, "end")
  const weeks: Array<Array<string | null>> = []
  let week: Array<string | null> = []
  for (const d = new Date(alignedStart); d <= alignedEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    week.push(map(d))
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  return weeks
}

const buildHeatmapWeeks = (startKey: string, endKey: string) => {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)
  if (!start || !end || start > end) return []
  return buildWeeks(start, end, (d) => formatDateKey(d)) as string[][]
}

const buildHeatmapMonthBlocks = (startKey: string, endKey: string) => {
  const rangeStart = parseDateKey(startKey)
  const rangeEnd = parseDateKey(endKey)
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return []
  const blocks: HeatmapMonthBlock[] = []
  for (let cursor = getMonth(rangeStart); cursor <= getMonth(rangeEnd); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const monthStart = getMonth(cursor)
    const monthEnd = getMonth(cursor, 1, 0)
    const visibleStart = new Date(Math.max(monthStart.getTime(), rangeStart.getTime()))
    const visibleEnd = new Date(Math.min(monthEnd.getTime(), rangeEnd.getTime()))
    if (visibleStart > visibleEnd) continue
    blocks.push({
      label: months.short[cursor.getUTCMonth()],
      weeks: buildWeeks(visibleStart, visibleEnd,
        (day) => {
          const t = day.getTime()
          return t >= visibleStart.getTime() && t <= visibleEnd.getTime() ? formatDateKey(day) : null
        }
      )
    })
  }
  return blocks
}

const buildLineChartData = (dates: string[], dataByDate: Record<string, DayEntry>): ChartPoint[] => (
  dates.map((date, index) => {
    const raw = dataByDate[date]?.percent ?? 0
    const startIndex = Math.max(0, index - 9)
    const windowDates = dates.slice(startIndex, index + 1)
    const total = windowDates.reduce((sum, day) => sum + (dataByDate[day]?.percent ?? 0), 0)
    return { date, raw, smooth10: Number((total / Math.max(1, windowDates.length)).toFixed(1)) }
  })
)

const getProgressColor = (value: number) => {
  const ratio = Math.max(0, Math.min(1, value / 100))
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

const getSingleHueHeatmapColor = (value: number) => {
  const ratio = Math.max(0, Math.min(1, value / 100))
  const minAlpha = 0.14
  const maxAlpha = 0.92
  const alpha = minAlpha + (maxAlpha - minAlpha) * ratio
  const { r, g, b } = getAccentColorRgb()
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}

export default {
  settings: {
    line: {
      compactness: {
        get: () => graphSetting('compactness'),
        set: (value: number) => graphSetting('compactness', value)
      },
      mode: {
        get: () => graphSetting('lineMode'),
        set: (mode: GraphLineMode) => graphSetting('lineMode', mode)
      }
    },
    heatmap: {
      multiColor: {
        get: () => graphSetting('heatmapUseMultiColor'),
        set: (enabled: boolean) => graphSetting('heatmapUseMultiColor', enabled)
      }
    }
  },
  line: {
    pointLimit: calculateGraphPointLimit,
    build: buildLineChartData
  },
  heatmap: {
    weeks: buildHeatmapWeeks,
    monthBlocks: buildHeatmapMonthBlocks,
    singleHueColor: getSingleHueHeatmapColor
  },
  colors: { progress: getProgressColor },
  dates: {
    compareKeys: compareDateKeys,
    range: buildDateRange,
    axisLabel: formatAxisDate
  }
} as const
