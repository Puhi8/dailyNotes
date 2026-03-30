import { addMyEventListener, manageLocalStorage } from '../utils/localProcessing'
import { createBackupSnapshot, setLocalDataChangeHandler } from './localCore'
import { fetchRemoteWithAuth } from './remoteAuth'

const BACKUP_ENABLED_KEY = 'dailynotes.backup.enabled'
const BACKUP_STATUS_EVENT = 'dailynotes.backup.status'

const AUTO_SYNC_DEBOUNCE_MS = 12000
const AUTO_SYNC_MIN_INTERVAL_MS = 60000

const notifyBackupStatusChange = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BACKUP_STATUS_EVENT))
}

export type BackupSyncStatus = {
  state: 'disabled' | 'idle' | 'syncing' | 'error'
  lastSyncedAt: number | null
  message: string | null
}

let backupStatus: BackupSyncStatus = {
  state: 'disabled',
  lastSyncedAt: null,
  message: null,
}
let backupTimer: number | null = null
let backupSyncInFlight = false
let backupSyncQueued = false
let lastBackupAttemptAt = 0

const getBackupEnabled = () => (manageLocalStorage.get(BACKUP_ENABLED_KEY, null) === "1")

const setBackupStatus = (status: BackupSyncStatus) => {
  backupStatus = status
  notifyBackupStatusChange()
}

const ensureBackupStatus = () => {
  if (!getBackupEnabled()) {
    if (backupStatus.state !== 'disabled') setBackupStatus({ state: 'disabled', lastSyncedAt: backupStatus.lastSyncedAt, message: null })
    return
  }
  if (backupStatus.state === 'disabled') setBackupStatus({ state: 'idle', lastSyncedAt: backupStatus.lastSyncedAt, message: null })
}

const runBackupSync = async () => {
  ensureBackupStatus()
  if (!getBackupEnabled()) return
  if (backupSyncInFlight) {
    backupSyncQueued = true
    return
  }
  backupSyncInFlight = true
  backupSyncQueued = false
  if (backupTimer != null && typeof window !== 'undefined') {
    window.clearTimeout(backupTimer)
    backupTimer = null
  }
  setBackupStatus({
    state: 'syncing',
    lastSyncedAt: backupStatus.lastSyncedAt,
    message: 'Syncing backup...',
  })
  lastBackupAttemptAt = Date.now()

  try {
    await fetchRemoteWithAuth('/backup/snapshot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await createBackupSnapshot()),
    })
    setBackupStatus({
      state: 'idle',
      lastSyncedAt: Date.now(),
      message: null,
    })
  }
  catch (err) {
    setBackupStatus({
      state: 'error',
      lastSyncedAt: backupStatus.lastSyncedAt,
      message: err instanceof Error ? err.message : 'Backup sync failed.',
    })
  }
  finally {
    backupSyncInFlight = false
    if (backupSyncQueued && getBackupEnabled()) scheduleBackupSync()
  }
}

const scheduleBackupSync = () => {
  ensureBackupStatus()
  if (!getBackupEnabled() || typeof window === 'undefined') return
  if (backupSyncInFlight) {
    backupSyncQueued = true
    return
  }

  const now = Date.now()
  const waitForMinInterval = Math.max(0, AUTO_SYNC_MIN_INTERVAL_MS - (now - lastBackupAttemptAt))
  const delay = Math.max(AUTO_SYNC_DEBOUNCE_MS, waitForMinInterval)

  if (backupTimer != null) window.clearTimeout(backupTimer)
  backupTimer = window.setTimeout(() => {
    backupTimer = null
    void runBackupSync()
  }, delay)
}

setLocalDataChangeHandler(() => { scheduleBackupSync() })

export const isBackupAutoSyncEnabled = () => getBackupEnabled()

export const setBackupAutoSyncEnabled = (enabled: boolean) => {
  if (enabled) {
    manageLocalStorage.set({ key: BACKUP_ENABLED_KEY, value: "1" })
    setBackupStatus({ state: 'idle', lastSyncedAt: backupStatus.lastSyncedAt, message: null })
    scheduleBackupSync()
  }
  else {
    manageLocalStorage.remove(BACKUP_ENABLED_KEY)
    if (backupTimer != null) {
      window.clearTimeout(backupTimer)
      backupTimer = null
    }
    backupSyncQueued = false
    setBackupStatus({ state: 'disabled', lastSyncedAt: backupStatus.lastSyncedAt, message: null })
  }
}

export const getBackupSyncStatus = (): BackupSyncStatus => {
  ensureBackupStatus()
  return backupStatus
}

export const subscribeBackupSyncStatus = (handler: () => void) => (addMyEventListener(BACKUP_STATUS_EVENT, handler))

export const syncBackupNow = async () => { await runBackupSync() }
