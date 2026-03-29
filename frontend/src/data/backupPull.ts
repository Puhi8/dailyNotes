import { manageLocalStorage } from '../utils/localProcessing'
import {
  cloneDayData,
  compareDayKeys,
  loadLocalState,
  normalizeAccomplishmentType,
  normalizeDayKey,
  persistLocalState,
  runWithLocalStateWriteLock,
  type BackupSnapshot,
  type DayData,
  type LocalState,
} from './localCore'
import { fetchRemoteWithAuth } from './remoteAuth'

const NOTE_TEMPLATE_KEY = 'dailynotes.noteTemplate'

export type BackupConflictChoice = 'local' | 'remote'

export type BackupSnapshotDay = {
  date: string
  note: string
  data: DayData
}

export type BackupPullConflict = {
  date: string
  local: BackupSnapshotDay
  remote: BackupSnapshotDay
}

export type BackupPullPreview = {
  remoteSnapshot: BackupSnapshot
  conflicts: BackupPullConflict[]
  localOnlyDays: number
  remoteOnlyDays: number
  identicalDays: number
}

export type BackupPullResult = {
  noteTemplate: string
  dayCount: number
  conflictCount: number
}

const normalizeDayData = (value: unknown): DayData => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: DayData = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim()
    if (!key) continue
    if (
      rawValue === null ||
      typeof rawValue === 'string' ||
      typeof rawValue === 'boolean' ||
      (typeof rawValue === 'number' && Number.isFinite(rawValue))
    ) output[key] = rawValue
  }
  return output
}

const normalizeSnapshot = (raw: unknown): BackupSnapshot => {
  const source = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const noteTemplate = String(source.noteTemplate ?? '')
  const accomplishmentsSource = Array.isArray(source.accomplishments) ? source.accomplishments : []
  const daysSource = Array.isArray(source.days) ? source.days : []

  const accomplishmentByName = new Map<string, { name: string; type: string; active: boolean }>()
  for (const itemRaw of accomplishmentsSource) {
    if (!itemRaw || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) continue
    const item = itemRaw as Record<string, unknown>
    const name = String(item.name ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (accomplishmentByName.has(key)) continue
    accomplishmentByName.set(key, {
      name,
      type: normalizeAccomplishmentType(String(item.type ?? '')),
      active: item.active !== false,
    })
  }

  const dayByDate = new Map<string, BackupSnapshotDay>()
  for (const dayRaw of daysSource) {
    if (!dayRaw || typeof dayRaw !== 'object' || Array.isArray(dayRaw)) continue
    const day = dayRaw as Record<string, unknown>
    const date = normalizeDayKey(String(day.date ?? ''))
    if (!date) continue
    dayByDate.set(date, {
      date,
      note: String(day.note ?? ''),
      data: normalizeDayData(day.data),
    })
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    noteTemplate,
    accomplishments: [...accomplishmentByName.values()],
    days: [...dayByDate.values()].sort((a, b) => compareDayKeys(a.date, b.date)),
  }
}

const createSnapshotFromLocalState = (state: LocalState): BackupSnapshot => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  noteTemplate: state.noteTemplate ?? '',
  accomplishments: state.accomplishments.map(item => ({
    name: item.name,
    type: normalizeAccomplishmentType(item.type),
    active: item.active,
  })),
  days: Object.keys(state.days)
    .sort(compareDayKeys)
    .map(date => ({
      date,
      note: state.days[date]?.note ?? '',
      data: cloneDayData(state.days[date]?.data ?? {}),
    })),
})

const dayEquals = (left: BackupSnapshotDay, right: BackupSnapshotDay) => {
  if (left.note !== right.note) return false
  const leftKeys = Object.keys(left.data).sort()
  const rightKeys = Object.keys(right.data).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false
    if (left.data[leftKeys[index]] !== right.data[rightKeys[index]]) return false
  }
  return true
}

const buildPreview = (localSnapshot: BackupSnapshot, remoteSnapshot: BackupSnapshot): BackupPullPreview => {
  const localDays = new Map(localSnapshot.days.map(day => [day.date, day]))
  const remoteDays = new Map(remoteSnapshot.days.map(day => [day.date, day]))
  const allDates = new Set<string>([...localDays.keys(), ...remoteDays.keys()])

  const conflicts: BackupPullConflict[] = []
  let localOnlyDays = 0
  let remoteOnlyDays = 0
  let identicalDays = 0

  for (const date of [...allDates].sort(compareDayKeys)) {
    const localDay = localDays.get(date)
    const remoteDay = remoteDays.get(date)
    if (localDay && remoteDay) {
      if (dayEquals(localDay, remoteDay)) identicalDays += 1
      else conflicts.push({ date, local: localDay, remote: remoteDay })
      continue
    }
    if (localDay) localOnlyDays += 1
    else remoteOnlyDays += 1
  }

  return {
    remoteSnapshot,
    conflicts,
    localOnlyDays,
    remoteOnlyDays,
    identicalDays,
  }
}

const mergeSnapshots = (
  localSnapshot: BackupSnapshot,
  remoteSnapshot: BackupSnapshot,
  choices: Record<string, BackupConflictChoice>,
): BackupSnapshot => {
  const localDays = new Map(localSnapshot.days.map(day => [day.date, day]))
  const remoteDays = new Map(remoteSnapshot.days.map(day => [day.date, day]))
  const allDates = new Set<string>([...localDays.keys(), ...remoteDays.keys()])
  const mergedDays: BackupSnapshot['days'] = []

  for (const date of [...allDates].sort(compareDayKeys)) {
    const localDay = localDays.get(date)
    const remoteDay = remoteDays.get(date)
    if (localDay && remoteDay) {
      if (dayEquals(localDay, remoteDay)) {
        mergedDays.push({ date, note: remoteDay.note, data: cloneDayData(remoteDay.data) })
        continue
      }
      const selected = choices[date]
      if (selected !== 'local' && selected !== 'remote') throw new Error(`Choose local or server data for ${date}.`)
      const source = selected === 'local' ? localDay : remoteDay
      mergedDays.push({ date, note: source.note, data: cloneDayData(source.data) })
      continue
    }
    if (remoteDay) {
      mergedDays.push({ date, note: remoteDay.note, data: cloneDayData(remoteDay.data) })
      continue
    }
    if (localDay) mergedDays.push({ date, note: localDay.note, data: cloneDayData(localDay.data) })
  }

  const byName = new Map<string, { name: string; type: string; active: boolean }>()
  const saveAccomplishment = (rawName: string, rawType: string, active: boolean) => {
    const name = rawName.trim()
    if (!name) return
    const key = name.toLowerCase()
    if (byName.has(key)) return
    byName.set(key, { name, type: normalizeAccomplishmentType(rawType), active })
  }

  for (const item of remoteSnapshot.accomplishments) saveAccomplishment(item.name, item.type, item.active)
  for (const item of localSnapshot.accomplishments) saveAccomplishment(item.name, item.type, item.active)
  for (const day of mergedDays) {
    for (const [task, value] of Object.entries(day.data ?? {})) {
      const inferredType = typeof value === 'string' ? 'text' : ''
      saveAccomplishment(task, inferredType, true)
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    noteTemplate: remoteSnapshot.noteTemplate ?? '',
    accomplishments: [...byName.values()],
    days: mergedDays,
  }
}

const snapshotToLocalState = (snapshot: BackupSnapshot): LocalState => {
  const accomplishments = snapshot.accomplishments.map((item, index) => ({
    id: index + 1,
    name: item.name.trim(),
    type: normalizeAccomplishmentType(item.type),
    active: item.active !== false,
  }))
  const days = Object.fromEntries(snapshot.days.map(day => [
    normalizeDayKey(day.date),
    {
      note: String(day.note ?? ''),
      data: cloneDayData(day.data),
    },
  ]))
  return {
    version: 1,
    noteTemplate: String(snapshot.noteTemplate ?? ''),
    nextAccomplishmentId: accomplishments.length + 1,
    accomplishments,
    days,
  }
}

export const previewBackupPull = async (): Promise<BackupPullPreview> => {
  const response = await fetchRemoteWithAuth('/backup/snapshot', { method: 'GET' })
  const remoteSnapshot = normalizeSnapshot(await response.json())
  const localSnapshot = createSnapshotFromLocalState(await loadLocalState())
  return buildPreview(localSnapshot, remoteSnapshot)
}

export const applyBackupPull = async (remoteSnapshotRaw: BackupSnapshot, choices: Record<string, BackupConflictChoice>): Promise<BackupPullResult> => {
  const remoteSnapshot = normalizeSnapshot(remoteSnapshotRaw)
  return runWithLocalStateWriteLock(async () => {
    const localSnapshot = createSnapshotFromLocalState(await loadLocalState())
    const preview = buildPreview(localSnapshot, remoteSnapshot)
    const mergedSnapshot = mergeSnapshots(localSnapshot, remoteSnapshot, choices)
    const nextState = snapshotToLocalState(mergedSnapshot)
    await persistLocalState(nextState)
    manageLocalStorage.set({ key: NOTE_TEMPLATE_KEY, value: nextState.noteTemplate })
    return {
      noteTemplate: nextState.noteTemplate,
      dayCount: Object.keys(nextState.days).length,
      conflictCount: preview.conflicts.length,
    }
  })
}

