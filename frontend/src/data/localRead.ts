import type { IndividualDay, ServerData } from './types'
import {
  cloneDayData,
  compareDayKeys,
  defaultValueForAccomplishmentType,
  defaultValueForSample,
  getUsedAccomplishments,
  loadLocalState,
  normalizeAccomplishmentType,
  normalizeDayValueForAccomplishmentType,
  normalizeDayKey,
  parseDayKey,
  taskCompleted,
  type AccomplishmentItem,
  type DayData,
  type NoteEntry,
  type NoteSummary,
  type NoteTemplateResponse,
  type IndividualDayResponse,
  dayKey,
} from './localCore'

const buildDefaultDayDataForDate = (
  state: Awaited<ReturnType<typeof loadLocalState>>,
  dateKey: string,
  activeNames: Set<string>,
  useActiveFilter: boolean,
) => {
  const targetDate = parseDayKey(dateKey)
  if (!targetDate) return {}
  const sortedDates = Object.keys(state.days).sort(compareDayKeys)
  let defaults: DayData = {}
  for (const currentDate of sortedDates) {
    const parsed = parseDayKey(currentDate)
    if (!parsed) continue
    if (parsed.getTime() >= targetDate.getTime()) break
    const current = state.days[currentDate]
    if (!current) continue
    const template: DayData = {}
    for (const [key, value] of Object.entries(current.data ?? {})) {
      const normalized = key.trim()
      if (normalized === '') continue
      if (useActiveFilter && !activeNames.has(normalized)) continue
      template[normalized] = defaultValueForSample(value)
    }
    if (Object.keys(template).length > 0) defaults = template
  }
  return cloneDayData(defaults)
}

const getDayPayload = (state: Awaited<ReturnType<typeof loadLocalState>>, mode: IndividualDay): IndividualDayResponse => {
  const dateKey = dayKey.get(mode)
  const existing = state.days[dateKey]
  let data = cloneDayData(existing?.data ?? {})
  const note = existing?.note ?? ''
  const typeByName = new Map(
    state.accomplishments.map(item => [item.name.trim().toLowerCase(), normalizeAccomplishmentType(item.type)]),
  )

  for (const [key, value] of Object.entries(data)) {
    const expectedType = typeByName.get(key.trim().toLowerCase())
    if (expectedType == null) continue
    data[key] = normalizeDayValueForAccomplishmentType(value, expectedType)
  }

  if (mode === 'today') {
    const activeItems = state.accomplishments.filter(item => item.active)
    const activeNames = new Set(activeItems.map(item => item.name.trim()).filter(Boolean))
    const useActiveFilter = activeItems.length > 0

    if (useActiveFilter) {
      const filtered: DayData = {}
      for (const [key, value] of Object.entries(data)) {
        const normalized = key.trim()
        if (activeNames.has(normalized)) filtered[normalized] = value
      }
      data = filtered
    }

    const defaults = buildDefaultDayDataForDate(state, dateKey, activeNames, useActiveFilter)
    data = { ...defaults, ...data }
    for (const item of activeItems) {
      if (item.name in data) data[item.name] = normalizeDayValueForAccomplishmentType(data[item.name], item.type)
      else data[item.name] = defaultValueForAccomplishmentType(item.type)
    }
  } 
  else if (Object.keys(data).length === 0) {
    const defaults = buildDefaultDayDataForDate(state, dateKey, new Set<string>(), false)
    if (Object.keys(defaults).length > 0) data = defaults
  }
  return { date: dateKey, data, note }
}

const fillMissingDays = (dataByDate: Record<string, DayData>) => {
  const sorted = Object.keys(dataByDate).sort(compareDayKeys)
  if (sorted.length === 0) return
  const earliest = parseDayKey(sorted[0])
  const latestRaw = parseDayKey(sorted[sorted.length - 1])
  if (!earliest || !latestRaw) return

  const yesterday = parseDayKey(dayKey.yesterday())
  let end = latestRaw
  if (yesterday && yesterday.getTime() > end.getTime()) end = yesterday

  const cursor = new Date(earliest.getTime())
  let previousTemplate: DayData | null = null
  while (cursor.getTime() <= end.getTime()) {
    const key = dayKey.make(cursor)
    const current = dataByDate[key]
    if (current && Object.keys(current).length > 0) {
      const template: DayData = {}
      for (const [task, value] of Object.entries(current)) {
        const normalized = task.trim()
        if (normalized === '') continue
        template[normalized] = defaultValueForSample(value)
      }
      if (Object.keys(template).length > 0) previousTemplate = template
    } 
    else dataByDate[key] = previousTemplate ? cloneDayData(previousTemplate) : {}
    cursor.setDate(cursor.getDate() + 1)
  }
}

const calculateStats = (dayCount: number, dataByDate: Record<string, DayData>, sortedDatesAsc: string[]) => {
  const result = new Map<string, { chances: number; done: number; failed: number }>()
  const loopSize = Math.min(dayCount, sortedDatesAsc.length)
  const startIndex = sortedDatesAsc.length - loopSize
  for (let i = startIndex; i < sortedDatesAsc.length; i += 1) {
    const dateKey = sortedDatesAsc[i]
    const day = dataByDate[dateKey] ?? {}
    for (const [name, value] of Object.entries(day)) {
      const current = result.get(name) ?? { chances: 0, done: 0, failed: 0 }
      current.chances += 1
      if (taskCompleted(value)) current.done += 1
      else current.failed += 1
      result.set(name, current)
    }
  }
  let chances = 0
  let done = 0
  for (const stat of result.values()) {
    chances += stat.chances
    done += stat.done
  }
  const completionRatio = chances > 0 ? `${((done / chances) * 100).toFixed(2)}%` : '0.00%'
  const dailyAverage = done > 0 ? (chances / done).toFixed(2) : '0.00'
  return {
    dayCount,
    stats: [
      { text: 'Completion', value: `${done}/${chances}` },
      { text: 'Completion', value: completionRatio },
      { text: 'Daily avr.', value: dailyAverage },
    ],
  }
}

const buildServerData = (state: Awaited<ReturnType<typeof loadLocalState>>): ServerData => {
  const source: Record<string, DayData> = {}
  for (const [date, day] of Object.entries(state.days)) {
    source[date] = cloneDayData(day.data ?? {})
  }
  fillMissingDays(source)
  const sortedDates = Object.keys(source).sort(compareDayKeys)
  const graphStart = sortedDates[0] ?? ''
  const graphEnd = sortedDates[sortedDates.length - 1] ?? ''
  const data: ServerData['data'] = {}
  for (const date of sortedDates) {
    const day = source[date] ?? {}
    const values = Object.values(day)
    const total = values.length
    const done = values.reduce<number>((sum, value) => sum + (taskCompleted(value) ? 1 : 0), 0)
    data[date] = {
      data: day,
      percent: total > 0 ? Math.round((done * 100) / total) : 0,
    }
  }
  const yesterday = source[dayKey.yesterday()] ?? {}
  const yesterdayStats = Object.entries(yesterday).map(([text, value]) => {
    if (typeof value === 'number' || typeof value === 'string') return { text, value }
    if (typeof value === 'boolean') return { text, value: value ? 'Done' : 'Failed' }
    return { text, value: '' }
  })
  return {
    graph: { start: graphStart, end: graphEnd },
    data,
    stats: [
      calculateStats(7, source, sortedDates),
      calculateStats(30, source, sortedDates),
    ],
    yesterday: yesterdayStats,
  }
}

type ReadResponseMap = {
  '/yesterday': IndividualDayResponse
  '/today': IndividualDayResponse
  '/data': ServerData
  '/notes': NoteSummary[]
  '/note-template': NoteTemplateResponse
  '/accomplishments': AccomplishmentItem[]
}

export async function getIndividualDay(day: IndividualDay): Promise<IndividualDayResponse> {
  const state = await loadLocalState()
  return getDayPayload(state, day)
}

export async function getDashboardData(): Promise<ServerData> {
  const state = await loadLocalState()
  return buildServerData(state)
}

export async function listNotes(): Promise<NoteSummary[]> {
  const state = await loadLocalState()
  return Object.keys(state.days)
    .sort(compareDayKeys)
    .reverse()
    .map(date => ({
      date,
      hasNote: (state.days[date]?.note ?? '').trim() !== '',
    }))
}

export async function getNoteTemplate(): Promise<NoteTemplateResponse> {
  const state = await loadLocalState()
  return { template: state.noteTemplate ?? '' }
}

export async function listAccomplishments(): Promise<AccomplishmentItem[]> {
  const state = await loadLocalState()
  const used = getUsedAccomplishments(state)
  return [...state.accomplishments].map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    active: item.active,
    used: used.has(item.name.toLowerCase()),
  }))
}

export async function fetchData<P extends keyof ReadResponseMap>(path: P): Promise<ReadResponseMap[P]> {
  if (path === '/today') return await getIndividualDay("today") as ReadResponseMap[P]
  if (path === '/yesterday') return await getIndividualDay("yesterday") as ReadResponseMap[P]
  if (path === '/data') return await getDashboardData() as ReadResponseMap[P]
  if (path === '/notes') return await listNotes() as ReadResponseMap[P]
  if (path === '/note-template') return await getNoteTemplate() as ReadResponseMap[P]
  if (path === '/accomplishments') return await listAccomplishments() as ReadResponseMap[P]
  throw new Error(`Unsupported path: ${path}`)
}

export async function fetchNote(date: string): Promise<NoteEntry> {
  const state = await loadLocalState()
  const key = normalizeDayKey(date)
  const note = state.days[key]?.note ?? ''
  return { date: key, note }
}
