import { makeDayKey } from '../utils/functions'
import { getDeviceValue, setDeviceValue } from './deviceStore'
import { isPersistentRuntime } from '../utils/localProcessing'
import type { IndividualDay } from './types'

const LOCAL_DATA_KEY = 'dailynotes.localData.v1'

type LocalDay = {
  note: string
  data: DayData
}

export type LocalState = {
  version: number
  noteTemplate: string
  nextAccomplishmentId: number
  accomplishments: Array<{
    id: number
    name: string
    type: string
    active: boolean
  }>
  days: Record<string, LocalDay>
}

export type DayData = Record<string, string | number | boolean | null>

export type IndividualDayResponse = {
  date: string
  data: DayData
  note: string
}

export type NoteSummary = {
  date: string
  hasNote: boolean
}

export type NoteEntry = {
  date: string
  note: string
}

export type NoteTemplateResponse = {
  template: string
}

export type AccomplishmentItem = {
  id: number
  name: string
  type: string
  active: boolean
  used: boolean
}

export type AccomplishmentDeleteResponse = {
  id: number
  deleted: boolean
  active: boolean
}

export type BackupSnapshot = {
  version: number
  exportedAt: string
  noteTemplate: string
  accomplishments: Array<{
    name: string
    type: string
    active: boolean
  }>
  days: Array<{
    date: string
    note: string
    data: DayData
  }>
}

const defaultLocalState = (): LocalState => ({
  version: 1,
  noteTemplate: '',
  nextAccomplishmentId: 1,
  accomplishments: [],
  days: {},
})

export const parseDayKey = (key: string) => {
  const trimmed = key.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 3) return null
  const yearRaw = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(yearRaw) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const year = parts[0].length === 4 ? yearRaw : 2000 + yearRaw
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null
  return parsed
}

export const compareDayKeys = (a: string, b: string) => {
  const left = parseDayKey(a)
  const right = parseDayKey(b)
  if (!left || !right) return a.localeCompare(b)
  return left.getTime() - right.getTime()
}

export const normalizeDayKey = (key: string) => {
  const parsed = parseDayKey(key)
  if (!parsed) return key.trim()
  return dayKey.make(parsed)
}

export const cloneDayData = (data: DayData): DayData => {
  const clone: DayData = {}
  for (const [key, value] of Object.entries(data ?? {})) { clone[key] = value }
  return clone
}

const cloneLocalState = (state: LocalState): LocalState => ({
  version: 1,
  noteTemplate: state.noteTemplate ?? '',
  nextAccomplishmentId: Number.isFinite(state.nextAccomplishmentId) && state.nextAccomplishmentId > 0
    ? state.nextAccomplishmentId
    : 1,
  accomplishments: (state.accomplishments ?? []).map(item => ({
    id: Number(item.id),
    name: String(item.name ?? ''),
    type: String(item.type ?? ''),
    active: Boolean(item.active),
  })),
  days: Object.fromEntries(Object.entries(state.days ?? {}).map(([date, day]) => [
    normalizeDayKey(date),
    { note: String(day?.note ?? ''), data: cloneDayData((day?.data ?? {}) as DayData) }
  ])),
})

const normalizeLoadedLocalState = (input: Partial<LocalState>): LocalState => {
  const cloned = cloneLocalState({
    version: 1,
    noteTemplate: String(input.noteTemplate ?? ''),
    nextAccomplishmentId: Number(input.nextAccomplishmentId ?? 1),
    accomplishments: Array.isArray(input.accomplishments) ? input.accomplishments : [],
    days: typeof input.days === 'object' && input.days ? input.days as Record<string, LocalDay> : {},
  })
  const byName = new Set<string>()
  let maxID = 0
  const accomplishments = cloned.accomplishments
    .filter(item => {
      const name = item.name.trim()
      if (name === '') return false
      const key = name.toLowerCase()
      if (byName.has(key)) return false
      byName.add(key)
      return true
    })
    .map(item => {
      maxID = Math.max(maxID, item.id)
      return { ...item, name: item.name.trim() }
    })
  cloned.accomplishments = accomplishments
  cloned.nextAccomplishmentId = Math.max(Number(cloned.nextAccomplishmentId) || 1, maxID + 1, 1)
  return cloned
}

let localDataChangeHandler: (() => void) | null = null
let localStateCache: LocalState | null = null
let localStateWriteQueue: Promise<void> = Promise.resolve()

export const setLocalDataChangeHandler = (handler: (() => void) | null) => { localDataChangeHandler = handler }

export const runWithLocalStateWriteLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = localStateWriteQueue
  let release = () => { }
  localStateWriteQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  try { return await work() }
  finally { release() }
}

export const loadLocalState = async (): Promise<LocalState> => {
  if (typeof window === 'undefined') return defaultLocalState()
  if (localStateCache) return cloneLocalState(localStateCache)
  if (!isPersistentRuntime()) {
    const next = defaultLocalState()
    localStateCache = cloneLocalState(next)
    return next
  }

  const raw = await getDeviceValue(LOCAL_DATA_KEY)
  if (!raw) {
    const next = defaultLocalState()
    localStateCache = cloneLocalState(next)
    return next
  }

  try {
    const normalized = normalizeLoadedLocalState(JSON.parse(raw) as Partial<LocalState>)
    localStateCache = cloneLocalState(normalized)
    return normalized
  }
  catch {
    const fallback = defaultLocalState()
    localStateCache = cloneLocalState(fallback)
    return fallback
  }
}

export const persistLocalState = async (state: LocalState, options?: { scheduleBackup?: boolean }) => {
  if (typeof window === 'undefined') return
  const next = cloneLocalState(state)
  localStateCache = next
  if (isPersistentRuntime()) await setDeviceValue(LOCAL_DATA_KEY, JSON.stringify(next))
  if (options?.scheduleBackup !== false) localDataChangeHandler?.()
}

export const taskCompleted = (value: unknown) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim() !== ''
  return false
}

export const defaultValueForSample = (value: unknown): DayData[string] => {
  if (typeof value === 'string') return ''
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  return false
}

export const defaultValueForAccomplishmentType = (kind: string): DayData[string] => kind.trim().toLowerCase() === "text" ? "" : false

export const normalizeAccomplishmentType = (kind: string) => kind.trim().toLowerCase() === "text" ? "text" : ""

export const normalizeDayValueForAccomplishmentType = (value: DayData[string], kind: string): DayData[string] => {
  if (normalizeAccomplishmentType(kind) === 'text') {
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'Done' : ''
    return ''
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return value !== 0
  return false
}

export const dayKey = {
  make: makeDayKey,
  today: () => dayKey.make(new Date()),
  yesterday: () => {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    return dayKey.make(date)
  },
  get: (day: IndividualDay) => day === "today" ? dayKey.today() : dayKey.yesterday()
}

export const ensureAccomplishmentExists = (state: LocalState, name: string, type: string, active = true) => {
  const normalized = name.trim()
  if (normalized === '') return
  const existing = state.accomplishments.find(item => item.name.toLowerCase() === normalized.toLowerCase())
  if (existing) return
  state.accomplishments.push({
    id: state.nextAccomplishmentId,
    name: normalized,
    type: type.trim(),
    active,
  })
  state.nextAccomplishmentId += 1
}

export const getUsedAccomplishments = (state: LocalState) => {
  const used = new Set<string>()
  for (const day of Object.values(state.days)) {
    for (const key of Object.keys(day.data ?? {})) {
      const normalized = key.trim()
      if (normalized !== '') used.add(normalized.toLowerCase())
    }
  }
  return used
}

const buildBackupSnapshot = (state: LocalState): BackupSnapshot => {
  const days = Object.keys(state.days)
    .sort(compareDayKeys)
    .map(date => ({
      date,
      note: state.days[date]?.note ?? '',
      data: cloneDayData(state.days[date]?.data ?? {}),
    }))
  const accomplishments = [...state.accomplishments].map(item => ({
    name: item.name,
    type: item.type,
    active: item.active,
  }))
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    noteTemplate: state.noteTemplate,
    accomplishments,
    days,
  }
}

export const createBackupSnapshot = async (): Promise<BackupSnapshot> => buildBackupSnapshot(await loadLocalState())
