import { getBackupSyncStatus, isBackupAutoSyncEnabled, setBackupAutoSyncEnabled, subscribeBackupSyncStatus, syncBackupNow } from './backupSync'
import { applyBackupPull, previewBackupPull } from './backupPull'
import { fetchNote, getDashboardData, getIndividualDay, getNoteTemplate, listAccomplishments, listNotes } from './localRead'
import { createAccomplishment, deleteAccomplishment, renameAccomplishment, reorderAccomplishments, saveIndividualDay, saveNoteTemplate, setAccomplishmentActive } from './localWrite'
import { DEFAULT_API_BASE_URL, apiBaseUrl, login, logout, subscribeAuthChanges, updateRemoteCredentials, authSession } from './remoteAuth'
export type { SaveDayPayload } from './localWrite'
export type { BackupSyncStatus } from './backupSync'
export type { BackupConflictChoice, BackupPullConflict, BackupPullPreview, BackupPullResult } from './backupPull'

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
} as const
