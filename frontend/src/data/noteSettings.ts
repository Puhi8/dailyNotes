import { manageLocalStorage } from '../utils/localProcessing'
import { api } from './api'

const NOTE_TEMPLATE_KEY = 'dailynotes.noteTemplate'

export const getNoteTemplate = () => manageLocalStorage.get(NOTE_TEMPLATE_KEY, "", String)

export const applyNoteTemplate = (note: string, templateOverride?: string) => {
  const trimmed = note.trim()
  const template = templateOverride ?? getNoteTemplate()
  if (trimmed === '' && template.trim() !== '') return { note: template, applied: true }
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
