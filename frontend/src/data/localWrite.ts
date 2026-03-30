import {
  defaultValueForAccomplishmentType,
  ensureAccomplishmentExists,
  getUsedAccomplishments,
  loadLocalState,
  normalizeAccomplishmentType,
  normalizeDayValueForAccomplishmentType,
  persistLocalState,
  runWithLocalStateWriteLock,
  type AccomplishmentDeleteResponse,
  type AccomplishmentItem,
  type DayData,
  type LocalState,
  type NoteTemplateResponse,
  type IndividualDayResponse,
  dayKey,
} from './localCore'
import type { IndividualDay } from './types'

type SaveResponseMap = {
  '/yesterday': IndividualDayResponse
  '/today': IndividualDayResponse
  '/note-template': NoteTemplateResponse
}

export type SaveDayPayload = Partial<Pick<IndividualDayResponse, 'data' | 'note'>>

type LoadedLocalState = Awaited<ReturnType<typeof loadLocalState>>

const withLocalStateWrite = async <T>(work: (state: LoadedLocalState) => Promise<T>): Promise<T> => {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    return await work(state)
  })
}

const getNormalizedAccomplishmentName = (state: LocalState, name: string, excludeId?: number) => {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Accomplishment name is required.')
  const duplicate = state.accomplishments.find(item => item.id !== excludeId && item.name.toLowerCase() === trimmed.toLowerCase())
  if (duplicate) throw new Error('Accomplishment already exists.')
  return trimmed
}

const ensureTodayAccomplishmentValue = (state: LocalState, name: string, type: string) => {
  const todayKey = dayKey.today()
  const today = state.days[todayKey] ?? { note: '', data: {} }
  if (name in today.data) today.data[name] = normalizeDayValueForAccomplishmentType(today.data[name], type)
  else today.data[name] = defaultValueForAccomplishmentType(type)
  state.days[todayKey] = today
}

const toAccomplishmentItems = (state: LocalState): AccomplishmentItem[] => {
  const used = getUsedAccomplishments(state)
  return state.accomplishments.map(item => ({ ...item, used: used.has(item.name.toLowerCase()) }))
}

const saveDayPayload = async (state: LoadedLocalState, mode: IndividualDay, payload: SaveDayPayload) => {
  const dateKey = dayKey.get(mode)
  const nextData: DayData = {}
  const typeByName = new Map(
    state.accomplishments.map(item => [item.name.trim().toLowerCase(), normalizeAccomplishmentType(item.type)]),
  )
  for (const [key, value] of Object.entries(payload.data ?? {})) {
    const normalized = key.trim()
    if (normalized === '') continue
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      const inferredType = typeByName.get(normalized.toLowerCase()) ?? (typeof value === 'string' ? 'text' : '')
      nextData[normalized] = normalizeDayValueForAccomplishmentType(value, inferredType)
      ensureAccomplishmentExists(state, normalized, inferredType, true)
    }
  }
  const nextNote = String(payload.note ?? '')
  state.days[dateKey] = { note: nextNote, data: nextData }
  await persistLocalState(state)
  return { date: dateKey, data: { ...nextData }, note: nextNote }
}

export async function saveNoteTemplate(template: string): Promise<NoteTemplateResponse> {
  return withLocalStateWrite(async state => {
    state.noteTemplate = template
    await persistLocalState(state)
    return { template }
  })
}

export async function saveIndividualDay(day: IndividualDay, payload: SaveDayPayload): Promise<IndividualDayResponse> {
  return withLocalStateWrite(async state => (await saveDayPayload(state, day, payload)))
}

export async function saveFetch<P extends keyof SaveResponseMap>(path: P, data: unknown): Promise<SaveResponseMap[P]> {
  if (path === '/note-template') {
    const template = (typeof data === 'object' && data && 'template' in data)
      ? String((data as { template?: unknown }).template ?? '')
      : ''
    return await saveNoteTemplate(template) as SaveResponseMap[P]
  }

  const payload = (typeof data === 'object' && data ? data : {}) as SaveDayPayload
  if (path === '/today') return await saveIndividualDay("today", payload) as SaveResponseMap[P]
  return await saveIndividualDay("yesterday", payload) as SaveResponseMap[P]
}

export async function createAccomplishment(name: string, type = ''): Promise<AccomplishmentItem> {
  return withLocalStateWrite(async state => {
    const trimmed = getNormalizedAccomplishmentName(state, name)
    const normalizedType = normalizeAccomplishmentType(type)
    const id = state.nextAccomplishmentId
    state.nextAccomplishmentId += 1
    const item = { id, name: trimmed, type: normalizedType, active: true }
    state.accomplishments.push(item)
    ensureTodayAccomplishmentValue(state, trimmed, normalizedType)
    await persistLocalState(state)
    return { ...item, used: false }
  })
}

export async function renameAccomplishment(id: number, name: string, type = ''): Promise<AccomplishmentItem> {
  return withLocalStateWrite(async state => {
    const item = state.accomplishments.find(entry => entry.id === id)
    if (!item) throw new Error('Accomplishment not found.')
    const trimmed = getNormalizedAccomplishmentName(state, name, id)
    const normalizedType = normalizeAccomplishmentType(type)

    const oldName = item.name
    const oldType = normalizeAccomplishmentType(item.type)
    item.name = trimmed
    item.type = normalizedType
    const typeChanged = oldType !== normalizedType
    for (const day of Object.values(state.days)) {
      if (oldName !== trimmed && oldName in day.data) {
        day.data[trimmed] = day.data[oldName]
        delete day.data[oldName]
      }
      if (typeChanged && trimmed in day.data) day.data[trimmed] = normalizeDayValueForAccomplishmentType(day.data[trimmed], normalizedType)
    }
    if (item.active) ensureTodayAccomplishmentValue(state, item.name, item.type)
    const used = getUsedAccomplishments(state).has(item.name.toLowerCase())
    await persistLocalState(state)
    return { ...item, used }
  })
}

export async function setAccomplishmentActive(id: number, active: boolean): Promise<AccomplishmentItem> {
  return withLocalStateWrite(async state => {
    const item = state.accomplishments.find(entry => entry.id === id)
    if (!item) throw new Error('Accomplishment not found.')
    item.active = active

    if (active) ensureTodayAccomplishmentValue(state, item.name, item.type)
    const used = getUsedAccomplishments(state).has(item.name.toLowerCase())
    await persistLocalState(state)
    return { ...item, used }
  })
}

export async function deleteAccomplishment(id: number, options?: { force?: boolean }): Promise<AccomplishmentDeleteResponse> {
  return withLocalStateWrite(async state => {
    const index = state.accomplishments.findIndex(entry => entry.id === id)
    if (index < 0) throw new Error('Accomplishment not found.')
    const item = state.accomplishments[index]
    const used = getUsedAccomplishments(state).has(item.name.toLowerCase())
    if (used && !options?.force === true) {
      item.active = false
      await persistLocalState(state)
      return { id: item.id, deleted: false, active: false }
    }

    state.accomplishments.splice(index, 1)
    for (const day of Object.values(state.days)) {
      if (item.name in day.data) delete day.data[item.name]
    }
    await persistLocalState(state)
    return { id, deleted: true, active: false }
  })
}

export async function reorderAccomplishments(orderedIds: number[]): Promise<AccomplishmentItem[]> {
  return withLocalStateWrite(async state => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return toAccomplishmentItems(state)
    }

    const byId = new Map(state.accomplishments.map(item => [item.id, item]))
    const seen = new Set<number>()
    const reordered: typeof state.accomplishments = []

    for (const rawId of orderedIds) {
      const id = Number(rawId)
      if (!Number.isFinite(id) || seen.has(id)) continue
      const item = byId.get(id)
      if (!item) continue
      reordered.push(item)
      seen.add(id)
    }

    for (const item of state.accomplishments) {
      if (!seen.has(item.id)) reordered.push(item)
    }

    state.accomplishments = reordered
    await persistLocalState(state)
    return toAccomplishmentItems(state)
  })
}
