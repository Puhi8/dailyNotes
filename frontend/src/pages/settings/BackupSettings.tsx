import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type BackupAccomplishmentChoice, type BackupConflictChoice, type BackupPullPreview, type BackupSyncStatus } from '../../data/api'
import { notifyNoteTemplateChanged } from '../../data/noteSettings'
import type { StatusOptions } from '../../data/types'
import { toUpperCase, useObjectState } from '../../utils/functions'
import { registerCloseOnBack } from '../../utils/hardwareBack'
import { Button, ToggleSwitch } from '../../utils/simplifyReact'
import { PullPopup, RemoteCredentialsPopup, ServerPopup } from './SettingsPopups'
import { SettingsSection } from './SettingsShared'

type BackupPopupKey = 'server' | 'remote' | 'pull' | null

type BackupErrors = {
  server: string | null
  remoteCredentials: string | null
  backupPull: string | null
}

type BackupState = {
  syncingNow: boolean
  pulling: boolean
  applyingPull: boolean
}

type PullState = {
  preview: BackupPullPreview | null
  choices: Record<string, BackupConflictChoice | ''>
  accomplishmentChoice: BackupAccomplishmentChoice | ''
}

type RemoteCredentialsState = {
  password: string
  passwordConfirm: string
  currentServerPassword: string
}

function formatServerDisplay(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return 'Not set'
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return withoutScheme || trimmed
}

function summarizeConflictDay(source: { note: string; data: Record<string, unknown> }) {
  return `${Object.keys(source.data ?? {}).length} tasks, ${source.note.trim() ? 'has' : 'no'} note`
}

export default function BackupSettings() {
  const navigate = useNavigate()
  const [apiBaseUrl, setApiBaseUrlState] = useState(() => api.config.baseUrl.get())
  const [serverDraft, setServerDraft] = useState(apiBaseUrl)
  const [backup, setBackup] = useObjectState<{ enabled: boolean, status: BackupSyncStatus }>({ enabled: api.backup.isAutoSyncEnabled(), status: api.backup.getStatus() })
  const [remoteSessionConnected, setRemoteSessionConnected] = useState(() => api.auth.session.hasSession())
  const [errors, setErrors] = useObjectState<BackupErrors>({ server: null, remoteCredentials: null, backupPull: null })
  const [status, setStatus] = useObjectState<{ remoteCredentials: StatusOptions }>({ remoteCredentials: 'idle' })
  const [state, setState] = useObjectState<BackupState>({ syncingNow: false, pulling: false, applyingPull: false })
  const [activePopup, setActivePopup] = useState<BackupPopupKey>(null)
  const [serverCredentials, setServerCredentials, resetServerCredentials] = useObjectState<RemoteCredentialsState>({
    password: '', passwordConfirm: '', currentServerPassword: '',
  })
  const [pull, setPull, resetPull] = useObjectState<PullState>({ preview: null, choices: {}, accomplishmentChoice: '' })

  useEffect(() => {
    if (!activePopup) return
    return registerCloseOnBack(() => {
      if (activePopup === 'pull') {
        setState({ applyingPull: false })
        resetPull()
        setErrors({ backupPull: null })
      }
      setActivePopup(null)
    })
  }, [activePopup, resetPull, setErrors, setState])

  useEffect(() => {
    const sync = () => {
      setBackup({ enabled: api.backup.isAutoSyncEnabled(), status: api.backup.getStatus() })
      setRemoteSessionConnected(api.auth.session.hasSession())
    }
    sync()
    const unsubscribeBackup = api.backup.subscribeStatus(sync)
    const unsubscribeAuth = api.auth.subscribe(sync)
    return () => { unsubscribeBackup(); unsubscribeAuth() }
  }, [setBackup])

  const handleEditApiBase = () => {
    setServerDraft(apiBaseUrl)
    setErrors({ server: null })
    setActivePopup('server')
  }

  const handleSaveServerEdit = (event: FormEvent) => {
    event.preventDefault()
    setApiBaseUrlState(api.config.baseUrl.set(serverDraft))
    setActivePopup(null)
  }

  const handleToggleBackup = () => {
    const next = !backup.enabled
    api.backup.setAutoSyncEnabled(next)
    setBackup({ enabled: next, status: api.backup.getStatus() })
  }

  const handleSyncNow = async () => {
    setState({ syncingNow: true })
    try {
      await api.backup.sync()
      setBackup({ status: api.backup.getStatus() })
    }
    finally { setState({ syncingNow: false }) }
  }

  const closePullModal = () => {
    setActivePopup(null)
    setState({ applyingPull: false })
    resetPull()
    setErrors({ backupPull: null })
  }

  const handlePreparePull = async () => {
    if (!remoteSessionConnected) {
      navigate('/login', { state: { from: '/settings' } })
      return
    }
    setErrors({ backupPull: null })
    setState({ pulling: true })
    try {
      const preview = await api.backup.previewPull()
      const nextChoices: Record<string, BackupConflictChoice | ''> = {}
      for (const conflict of preview.conflicts) nextChoices[conflict.date] = ''
      setPull({ preview, choices: nextChoices, accomplishmentChoice: '' })
      setActivePopup('pull')
    }
    catch (err) { setErrors({ backupPull: err instanceof Error ? err.message : 'Failed to fetch server snapshot.' }) }
    finally { setState({ pulling: false }) }
  }

  const unresolvedPullConflicts = pull.preview
    ? pull.preview.conflicts.filter(conflict => pull.choices[conflict.date] !== 'local' && pull.choices[conflict.date] !== 'remote').length
    : 0
  const unresolvedAccomplishmentChoice = pull.preview ? pull.accomplishmentChoice === '' : false

  const handleApplyPull = async () => {
    if (!pull.preview) return
    if (unresolvedPullConflicts > 0) {
      setErrors({ backupPull: 'Choose local or server data for each conflict day.' })
      return
    }
    if (unresolvedAccomplishmentChoice) {
      setErrors({ backupPull: 'Choose which accomplishments to keep.' })
      return
    }
    const decisions: Record<string, BackupConflictChoice> = {}
    for (const conflict of pull.preview.conflicts) decisions[conflict.date] = pull.choices[conflict.date] as BackupConflictChoice
    setErrors({ backupPull: null })
    setState({ applyingPull: true })
    try {
      await api.backup.applyPull(pull.preview.remoteSnapshot, decisions, pull.accomplishmentChoice as BackupAccomplishmentChoice)
      notifyNoteTemplateChanged()
      closePullModal()
    }
    catch (err) { setErrors({ backupPull: err instanceof Error ? err.message : 'Failed to apply server pull.' }) }
    finally { setState({ applyingPull: false }) }
  }

  const handleEditRemoteCredentials = () => {
    if (!remoteSessionConnected) {
      navigate('/login', { state: { from: '/settings' } })
      return
    }
    resetServerCredentials()
    setErrors({ remoteCredentials: null })
    setStatus({ remoteCredentials: 'idle' })
    setActivePopup('remote')
  }

  const handleSaveRemoteCredentials = async (event: FormEvent) => {
    event.preventDefault()
    setErrors({ remoteCredentials: null })
    const currentPassword = serverCredentials.currentServerPassword
    const password = serverCredentials.password
    const confirm = serverCredentials.passwordConfirm

    if (!remoteSessionConnected) {
      setErrors({ remoteCredentials: 'Sign in on the Login page first.' })
      return
    }
    if (!currentPassword || !password || !confirm) {
      setErrors({ remoteCredentials: 'Fill in all fields.' })
      return
    }
    if (password.length > 1024) {
      setErrors({ remoteCredentials: 'Password is too long.' })
      return
    }
    if (password !== confirm) {
      setErrors({ remoteCredentials: 'New passwords do not match.' })
      return
    }
    setStatus({ remoteCredentials: 'saving' })
    try {
      await api.auth.updateRemoteCredentials(currentPassword, password)
      setStatus({ remoteCredentials: 'saved' })
      setActivePopup(null)
    }
    catch (err) {
      setErrors({ remoteCredentials: err instanceof Error ? err.message : 'Failed to update credentials.' })
      setStatus({ remoteCredentials: 'idle' })
    }
  }

  return <>
    <SettingsSection title="Backup" titleMeta={toUpperCase(backup.status.state)}>
      <div className="panelRow">
        <span>Server</span>
        <span className="panelRowValue panelRowValueServerWrap">
          <span className="panelRowValueServerText" title={apiBaseUrl}>
            {formatServerDisplay(apiBaseUrl)}
          </span>
          <Button.secondaryInline onClick={handleEditApiBase}>
            Edit
          </Button.secondaryInline>
        </span>
      </div>
      <div className="panelRow">
        <span>Remote credentials</span>
        <span className="panelRowValue">
          {remoteSessionConnected ? 'Connected' : 'Sign in required'}
          <Button.secondaryInline onClick={handleEditRemoteCredentials}>
            Change
          </Button.secondaryInline>
        </span>
      </div>
      <div className="panelRow">
        <span>Auto sync</span>
        <span className="panelRowValue panelRowValueToggle">
          {backup.enabled ? 'Enabled' : 'Disabled'}
          <ToggleSwitch ariaLabel="Toggle auto sync" checked={backup.enabled} onChange={handleToggleBackup} />
        </span>
      </div>
      <div className="panelRow panelRowTopAlign">
        <div className="panelRowLabelGroup">
          {backup.status.lastSyncedAt
            ? <span className="panelHint">Last synced: {new Date(backup.status.lastSyncedAt).toLocaleString()}.</span>
            : <span className="panelHint">No successful backup sync yet.</span>
          }
          {backup.status.message && <p className="panelHint">({backup.status.message})</p>}
        </div>
        <span className="panelRowValue">
          <Button.secondaryInline onClick={handleSyncNow} disabled={state.syncingNow || !backup.enabled}>
            {state.syncingNow ? 'Syncing...' : 'Sync now'}
          </Button.secondaryInline>
        </span>
      </div>
      <div className="panelRow">
        <span>Pull from server</span>
        <span className="panelRowValue">
          <Button.secondaryInline
            onClick={handlePreparePull}
            disabled={state.pulling || state.applyingPull}
          >
            {state.pulling ? 'Checking...' : 'Pull'}
          </Button.secondaryInline>
        </span>
      </div>
      {activePopup !== 'pull' && errors.backupPull && <div className="stateMeta stateMetaError">{errors.backupPull}</div>}
    </SettingsSection>
    {activePopup === 'server' && <ServerPopup
      draft={serverDraft}
      error={errors.server}
      onDraftChange={value => { setServerDraft(value); setErrors({ server: null }) }}
      onSave={handleSaveServerEdit}
      onClose={() => setActivePopup(null)}
    />}
    {activePopup === 'remote' && <RemoteCredentialsPopup
      values={serverCredentials}
      status={status.remoteCredentials}
      error={errors.remoteCredentials}
      onChange={(field, value) => { setServerCredentials({ [field]: value } as Partial<RemoteCredentialsState>); setErrors({ remoteCredentials: null }) }}
      onSave={handleSaveRemoteCredentials}
      onClose={() => setActivePopup(null)}
    />}
    {activePopup === 'pull' && pull.preview && <PullPopup
      values={{
        preview: pull.preview,
        choices: pull.choices,
        accomplishmentChoice: pull.accomplishmentChoice,
      }}
      unresolvedConflicts={unresolvedPullConflicts}
      unresolvedAccomplishmentChoice={unresolvedAccomplishmentChoice}
      applying={state.applyingPull}
      error={errors.backupPull}
      onAccomplishmentChoiceChange={value => setPull({ accomplishmentChoice: value })}
      onConflictChoiceChange={(date, value) => setPull(previous => ({ choices: { ...previous.choices, [date]: value } }))}
      onApply={handleApplyPull}
      onClose={closePullModal}
      summarizeConflictDay={summarizeConflictDay}
    />}
  </>
}
