import { getBackupSyncStatus, isBackupAutoSyncEnabled, setBackupAutoSyncEnabled, subscribeBackupSyncStatus, syncBackupNow } from './backupSync'
import { applyBackupPull, previewBackupPull } from './backupPull'
import { fetchNote, getDashboardData, getIndividualDay, getNoteTemplate, listAccomplishments, listDayQuotes, listNotes, listQuotes } from './localRead'
import { createAccomplishment, deleteAccomplishment, deleteQuote, editQuote, renameAccomplishment, reorderAccomplishments, saveDayQuotes, saveIndividualDay, saveNoteTemplate, setAccomplishmentActive, setNoteMarked, setQuoteStatus } from './localWrite'
import { DEFAULT_API_BASE_URL, apiBaseUrl, login, logout, subscribeAuthChanges, updateRemoteCredentials, authSession } from './remoteAuth'
export type { SaveDayPayload } from './localWrite'
export type { BackupSyncStatus } from './backupSync'
export type { BackupConflictChoice, BackupAccomplishmentChoice, BackupQuoteChoice, BackupPullConflict, BackupPullPreview, BackupPullResult } from './backupPull'
export type { Quote, QuoteStatus } from './quotes'

export type {
  DayData,
  NoteSummary,
  NoteEntry,
  NoteTemplateResponse,
  AccomplishmentItem,
  AccomplishmentDeleteResponse,
  IndividualDayResponse
} from './localCore'


export const api = {
  config: {
    DEFAULT_API_BASE_URL,
    baseUrl: apiBaseUrl,
  },
  auth: {
    session: authSession,
    subscribe: subscribeAuthChanges,
    login,
    logout,
    updateRemoteCredentials,
  },
  backup: {
    isAutoSyncEnabled: isBackupAutoSyncEnabled,
    setAutoSyncEnabled: setBackupAutoSyncEnabled,
    getStatus: getBackupSyncStatus,
    subscribeStatus: subscribeBackupSyncStatus,
    sync: syncBackupNow,
    previewPull: previewBackupPull,
    applyPull: applyBackupPull,
  },
  dashboard: {
    get: getDashboardData,
  },
  day: {
    getIndividual: getIndividualDay,
    saveIndividual: saveIndividualDay,
  },
  notes: {
    list: listNotes,
    get: fetchNote,
    setMarked: setNoteMarked,
    getTemplate: getNoteTemplate,
    saveTemplate: saveNoteTemplate,
  },
  accomplishments: {
    list: listAccomplishments,
    create: createAccomplishment,
    rename: renameAccomplishment,
    setActive: setAccomplishmentActive,
    delete: deleteAccomplishment,
    reorder: reorderAccomplishments,
  },
  quotes: {
    list: listQuotes,
    listForDay: listDayQuotes,
    saveForDay: saveDayQuotes,
    edit: editQuote,
    setStatus: setQuoteStatus,
    delete: deleteQuote,
  },
} as const
