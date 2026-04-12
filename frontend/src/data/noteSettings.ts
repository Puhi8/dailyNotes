import { manageLocalStorage } from '../utils/localProcessing'
import { api } from './api'

const NOTE_TEMPLATE_KEY = 'dailynotes.noteTemplate'
const NOTE_HEADER_COLORS_KEY = 'dailynotes.noteHeaderColors'

export const getNoteTemplate = () => manageLocalStorage.get(NOTE_TEMPLATE_KEY, "", String)
export const getNoteHeaderColors = () => manageLocalStorage.get(NOTE_HEADER_COLORS_KEY, true, value => value !== 'false')
export const setNoteHeaderColors = (enabled: boolean) => {
  manageLocalStorage.set({ key: NOTE_HEADER_COLORS_KEY, value: enabled })
  return enabled
}

const ensureEditableTemplateEnd = (template: string) => template.endsWith('\n') ? template : `${template}\n`
export const applyNoteTemplate = (note: string, templateOverride?: string) => {
  const trimmed = note.trim()
  const template = templateOverride ?? getNoteTemplate()
  if (trimmed === '' && template.trim() !== '') return { note: ensureEditableTemplateEnd(template), applied: true }
  return { note, applied: false }
}

export const loadNoteTemplateFromApi = async () => {
  const template = (await api.notes.getTemplate()).template ?? ''
  manageLocalStorage.set({ key: NOTE_TEMPLATE_KEY, value: template })
  return template
}

export const saveNoteTemplateToApi = async (template: string) => {
  const savedTemplate = (await api.notes.saveTemplate(template)).template ?? ''
  manageLocalStorage.set({ key: NOTE_TEMPLATE_KEY, value: savedTemplate })
  return savedTemplate
}

export const resolveNoteTemplate = async () => {
  try { return await loadNoteTemplateFromApi() }
  catch { return getNoteTemplate() }
}
