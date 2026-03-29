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

const saveDayPayload = async (
  state: Awaited<ReturnType<typeof loadLocalState>>,
  mode: IndividualDay,
  payload: SaveDayPayload,
) => {
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
  state.days[dateKey] = {
    note: nextNote,
    data: nextData,
  }
  await persistLocalState(state)
  return {
    date: dateKey,
    data: { ...nextData },
    note: nextNote,
  }
}

export async function saveNoteTemplate(template: string): Promise<NoteTemplateResponse> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    state.noteTemplate = template
    await persistLocalState(state)
    return { template }
  })
}

export async function saveIndividualDay(day: IndividualDay, payload: SaveDayPayload): Promise<IndividualDayResponse> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    return await saveDayPayload(state, day, payload)
  })
}

export async function saveFetch<P extends keyof SaveResponseMap>(
  path: P,
  data: unknown,
): Promise<SaveResponseMap[P]> {
  if (path === '/note-template') {
    const template = typeof data === 'object' && data && 'template' in data
      ? String((data as { template?: unknown }).template ?? '')
      : ''
    return await saveNoteTemplate(template) as SaveResponseMap[P]
  }

  const payload = (typeof data === 'object' && data ? data : {}) as SaveDayPayload
  if (path === '/today') return await saveIndividualDay("today", payload) as SaveResponseMap[P]
  return await saveIndividualDay("yesterday", payload) as SaveResponseMap[P]
}

export async function createAccomplishment(name: string, type = ''): Promise<AccomplishmentItem> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('Accomplishment name is required.')
    const duplicate = state.accomplishments.find(item => item.name.toLowerCase() === trimmed.toLowerCase())
    if (duplicate) throw new Error('Accomplishment already exists.')
    const normalizedType = normalizeAccomplishmentType(type)

    const id = state.nextAccomplishmentId
    state.nextAccomplishmentId += 1
    state.accomplishments.push({
      id,
      name: trimmed,
      type: normalizedType,
      active: true,
    })
    const todayKey = dayKey.today()
    const today = state.days[todayKey] ?? { note: '', data: {} }
    if (trimmed in today.data) today.data[trimmed] = normalizeDayValueForAccomplishmentType(today.data[trimmed], normalizedType)
    else today.data[trimmed] = defaultValueForAccomplishmentType(normalizedType)
    state.days[todayKey] = today
    await persistLocalState(state)
    return {
      id,
      name: trimmed,
      type: normalizedType,
      active: true,
      used: false,
    }
  })
}

export async function renameAccomplishment(id: number, name: string, type = ''): Promise<AccomplishmentItem> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    const item = state.accomplishments.find(entry => entry.id === id)
    if (!item) throw new Error('Accomplishment not found.')
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('Accomplishment name is required.')
    const duplicate = state.accomplishments.find(entry => entry.id !== id && entry.name.toLowerCase() === trimmed.toLowerCase())
    if (duplicate) throw new Error('Accomplishment already exists.')
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
    if (item.active) {
      const todayKey = dayKey.today()
      const today = state.days[todayKey] ?? { note: '', data: {} }
      if (item.name in today.data) {
        today.data[item.name] = normalizeDayValueForAccomplishmentType(today.data[item.name], item.type)
        state.days[todayKey] = today
      }
      else {
        today.data[item.name] = defaultValueForAccomplishmentType(item.type)
        state.days[todayKey] = today
      }
    }
    const used = getUsedAccomplishments(state).has(trimmed.toLowerCase())
    await persistLocalState(state)
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      active: item.active,
      used,
    }
  })
}

export async function setAccomplishmentActive(id: number, active: boolean): Promise<AccomplishmentItem> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    const item = state.accomplishments.find(entry => entry.id === id)
    if (!item) throw new Error('Accomplishment not found.')
    item.active = active

    if (active) {
      const todayKey = dayKey.today()
      const today = state.days[todayKey] ?? { note: '', data: {} }
      if (item.name in today.data) {
        today.data[item.name] = normalizeDayValueForAccomplishmentType(today.data[item.name], item.type)
        state.days[todayKey] = today
      }
      else {
        today.data[item.name] = defaultValueForAccomplishmentType(item.type)
        state.days[todayKey] = today
      }
    }

    const used = getUsedAccomplishments(state).has(item.name.toLowerCase())
    await persistLocalState(state)
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      active: item.active,
      used,
    }
  })
}

export async function deleteAccomplishment(id: number): Promise<AccomplishmentDeleteResponse> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    const index = state.accomplishments.findIndex(entry => entry.id === id)
    if (index < 0) throw new Error('Accomplishment not found.')
    const item = state.accomplishments[index]
    const used = getUsedAccomplishments(state).has(item.name.toLowerCase())
    if (used) {
      item.active = false
      await persistLocalState(state)
      return {
        id: item.id,
        deleted: false,
        active: false,
      }
    }

    state.accomplishments.splice(index, 1)
    for (const day of Object.values(state.days)) {
      if (item.name in day.data) delete day.data[item.name]
    }
    await persistLocalState(state)
    return {
      id,
      deleted: true,
      active: false,
    }
  })
}

export async function reorderAccomplishments(orderedIds: number[]): Promise<AccomplishmentItem[]> {
  return runWithLocalStateWriteLock(async () => {
    const state = await loadLocalState()
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      const used = getUsedAccomplishments(state)
      return state.accomplishments.map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        active: item.active,
        used: used.has(item.name.toLowerCase()),
      }))
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

    const used = getUsedAccomplishments(state)
    return state.accomplishments.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      active: item.active,
      used: used.has(item.name.toLowerCase()),
    }))
  })
}
