import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type BackupConflictChoice, type BackupPullPreview, type BackupSyncStatus } from '../data/api'
import { GRAPH_COMPACTNESS_MAX, GRAPH_COMPACTNESS_MIN, getGraphCompactness, setGraphCompactness } from '../data/graphSettings'
import { getNoteTemplate, loadNoteTemplateFromApi, saveNoteTemplateToApi } from '../data/noteSettings'
import { useSecurity } from '../security'
import type { StatusOptions } from '../data/types'
import { toUpperCase, useObjectState } from '../utils/functions'

type errorsType = {
  template: string | null
  server: string | null
  pin: string | null
  remoteCredentials: string | null
  backupPull: string | null
}

type pinType = {
  current: string
  draft: string
  confirm: string
}

type stateType = {
  editingServer: boolean
  syncingNow: boolean
  editingPin: boolean
  editingRemote: boolean
  pulling: boolean
  editingPull: boolean
  applyingPull: boolean
}

type statusType = {
  template: StatusOptions
  remoteCredentials: StatusOptions
}

type serverCredentials = {
  password: string
  passwordConfirm: string
  currentServerPassword: string
}

const formatServerDisplay = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return 'Not set'
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return withoutScheme || trimmed
}

export default function Settings() {
  const navigate = useNavigate()
  const { hasDevicePin, biometricAvailable, biometricEnabled, setBiometricEnabled, verifyPin, setDevicePin, lock } = useSecurity()
  const [errors, setErrors] = useObjectState<errorsType>({ template: null, server: null, pin: null, remoteCredentials: null, backupPull: null })
  const [noteTemplate, setNoteTemplateState] = useState(() => getNoteTemplate())
  const [apiBaseUrl, setApiBaseUrlState] = useState(() => api.config.baseUrl.get())
  const [serverDraft, setServerDraft] = useState(apiBaseUrl)
  const [backupEnabled, setBackupEnabledState] = useState(() => api.backup.isAutoSyncEnabled())
  const [backupStatus, setBackupStatus] = useState<BackupSyncStatus>(() => api.backup.getStatus())
  const [remoteSessionConnected, setRemoteSessionConnected] = useState(() => api.auth.session.hasSession())
  const [graphCompactness, setGraphCompactnessState] = useState(() => getGraphCompactness())
  const [status, setStatus] = useObjectState<statusType>({ template: 'idle', remoteCredentials: 'idle' })
  const [state, setState] = useObjectState<stateType>({
    editingServer: false, syncingNow: false, editingPin: false, editingRemote: false, pulling: false, editingPull: false, applyingPull: false
  })
  const [pin, setPin] = useObjectState<pinType>({ current: "", draft: "", confirm: "" })
  const [serverCredentials, setServerCredentials] = useObjectState<serverCredentials>({ password: "", passwordConfirm: "", currentServerPassword: "", })
  const [pullPreview, setPullPreview] = useState<BackupPullPreview | null>(null)
  const [pullChoices, setPullChoices] = useState<Record<string, BackupConflictChoice | ''>>({})
  useEffect(() => {
    let active = true
    loadNoteTemplateFromApi()
      .then(template => {
        if (!active) return
        setNoteTemplateState(template)
        setErrors({ template: null })
      })
      .catch(err => { if (active) setErrors({ template: err instanceof Error ? err.message : 'Failed to load note template.' }) })
    return () => { active = false }
  }, [setErrors])

  useEffect(() => {
    const sync = () => {
      setBackupEnabledState(api.backup.isAutoSyncEnabled())
      setBackupStatus(api.backup.getStatus())
      setRemoteSessionConnected(api.auth.session.hasSession())
    }
    sync()
    const unsubscribeBackup = api.backup.subscribeStatus(sync)
    const unsubscribeAuth = api.auth.subscribe(sync)
    return () => { unsubscribeBackup(); unsubscribeAuth() }
  }, [])

  const handleEditApiBase = () => {
    setServerDraft(apiBaseUrl)
    setErrors({ server: null })
    setState({ editingServer: true, editingRemote: false })
  }

  const handleSaveServerEdit = (event: FormEvent) => {
    event.preventDefault()
    const saved = api.config.baseUrl.set(serverDraft)
    setApiBaseUrlState(saved)
    setState({ editingServer: false })
  }

  const handleGraphCompactnessChange = (value: number) => {
    const saved = setGraphCompactness(value)
    setGraphCompactnessState(saved)
  }

  const handleToggleBackup = () => {
    const next = !backupEnabled
    api.backup.setAutoSyncEnabled(next)
    setBackupEnabledState(next)
    setBackupStatus(api.backup.getStatus())
  }

  const handleSyncNow = async () => {
    setState({ syncingNow: true })
    try {
      await api.backup.sync()
      setBackupStatus(api.backup.getStatus())
    }
    finally { setState({ syncingNow: false }) }
  }

  const closePullModal = () => {
    setState({ editingPull: false, applyingPull: false })
    setPullPreview(null)
    setPullChoices({})
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
      setPullPreview(preview)
      setPullChoices(nextChoices)
      setState({ editingPull: true })
    }
    catch (err) { setErrors({ backupPull: err instanceof Error ? err.message : 'Failed to fetch server snapshot.' }) }
    finally { setState({ pulling: false }) }
  }

  const unresolvedPullConflicts = pullPreview
    ? pullPreview.conflicts.filter(conflict => pullChoices[conflict.date] !== 'local' && pullChoices[conflict.date] !== 'remote').length
    : 0

  const summarizeConflictDay = (source: { note: string; data: Record<string, unknown> }) => {
    const taskCount = Object.keys(source.data ?? {}).length
    return `${taskCount} tasks, ${source.note.trim() ? 'has note' : 'no note'}`
  }

  const handleApplyPull = async () => {
    if (!pullPreview) return
    if (unresolvedPullConflicts > 0) {
      setErrors({ backupPull: 'Choose local or server data for each conflict day.' })
      return
    }
    const decisions: Record<string, BackupConflictChoice> = {}
    for (const conflict of pullPreview.conflicts) decisions[conflict.date] = pullChoices[conflict.date] as BackupConflictChoice
    setErrors({ backupPull: null })
    setState({ applyingPull: true })
    try {
      const result = await api.backup.applyPull(pullPreview.remoteSnapshot, decisions)
      setNoteTemplateState(result.noteTemplate)
      closePullModal()
    }
    catch (err) { setErrors({ backupPull: err instanceof Error ? err.message : 'Failed to apply server pull.' }) }
    finally { setState({ applyingPull: false }) }
  }

  const handleEditPin = () => {
    setPin({ current: "", draft: "", confirm: "" })
    setErrors({ pin: null })
    setState({ editingPin: true })
  }

  const handleEditRemoteCredentials = () => {
    if (!remoteSessionConnected) {
      navigate('/login', { state: { from: '/settings' } })
      return
    }
    setServerCredentials({ currentServerPassword: "", password: "", passwordConfirm: "" })
    setErrors({ remoteCredentials: null })
    setStatus({ remoteCredentials: "idle" })
    setState({ editingRemote: true, editingServer: false })
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
    setStatus({ remoteCredentials: "saving" })
    try {
      await api.auth.updateRemoteCredentials(currentPassword, password)
      setStatus({ remoteCredentials: "saved" })
      setState({ editingRemote: false })
    }
    catch (err) {
      setErrors({ remoteCredentials: err instanceof Error ? err.message : 'Failed to update credentials.' })
      setStatus({ remoteCredentials: "idle" })
    }
  }

  const handleSavePin = (event: FormEvent) => {
    event.preventDefault()
    if (hasDevicePin && !verifyPin(pin.current.trim())) {
      setErrors({ pin: "Current PIN is incorrect." })
      return
    }
    const normalized = pin.draft.trim()
    if (!/^\d+$/.test(normalized)) {
      setErrors({ pin: "PIN should contain only numbers." })
      return
    }
    if (normalized !== pin.confirm.trim()) {
      setErrors({ pin: "PINs do not match." })
      return
    }
    setState({ editingPin: false })
    setDevicePin(normalized)
  }

  const saveTemplateValue = async (value: string) => {
    setErrors({ template: null })
    setStatus({ template: "saving" })
    try {
      await saveNoteTemplateToApi(value)
      setStatus({ template: "saved" })
      setTimeout(() => setStatus({ template: "idle" }), 1500)
    }
    catch (err) {
      setErrors({ template: err instanceof Error ? err.message : 'Failed to save note template.' })
      setStatus({ template: "idle" })
    }
  }

  const handleSaveTemplate = async () => { await saveTemplateValue(noteTemplate) }

  const handleClearTemplate = async () => {
    setNoteTemplateState('')
    await saveTemplateValue('')
  }

  return (
    <div className="page">
      <section className="panelCard panelStack">
        <div className="panelSection">
          <h2 className="panelTitle">Graph compactness</h2>
          <div className="rangeRow">
            <span className="rangeLabel">Compact</span>
            <input
              id="graph-compactness"
              className="rangeInput rangeInputInline"
              type="range"
              min={GRAPH_COMPACTNESS_MIN}
              max={GRAPH_COMPACTNESS_MAX}
              step={1}
              value={graphCompactness}
              onChange={event => handleGraphCompactnessChange(Number(event.target.value))}
            />
            <span className="rangeLabel">Spread out</span>
          </div>
        </div>
        <div className="panelSection">
          <h2 className="panelTitle">Backup <span>{toUpperCase(backupStatus.state)}</span></h2>
          <div className="panelRow">
            <span>Server</span>
            <span className="panelRowValue panelRowValueServerWrap">
              <span className="panelRowValueServerText" title={apiBaseUrl}>
                {formatServerDisplay(apiBaseUrl)}
              </span>
              <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleEditApiBase}>
                Edit
              </button>
            </span>
          </div>
          <div className="panelRow">
            <span>Remote credentials</span>
            <span className="panelRowValue">
              {remoteSessionConnected ? 'Connected' : 'Sign in required'}
              <button
                className="stateButton stateButtonSecondary panelInlineButton"
                type="button"
                onClick={handleEditRemoteCredentials}
              >
                Change
              </button>
            </span>
          </div>
          <div className="panelRow">
            <span>Auto sync</span>
            <span className="panelRowValue">
              {backupEnabled ? 'Enabled' : 'Disabled'}
              <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleToggleBackup}>
                {backupEnabled ? 'Disable' : 'Enable'}
              </button>
            </span>
          </div>
          <div className="panelRow">
            {backupStatus.lastSyncedAt
              ? <span className="panelHint">Last synced: {new Date(backupStatus.lastSyncedAt).toLocaleString()}.</span>
              : <span className="panelHint">No successful backup sync yet.</span>
            }
            {backupStatus.message && <p className="panelHint">({backupStatus.message})</p>}
            <span className="panelRowValue">
              <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleSyncNow} disabled={state.syncingNow || !backupEnabled}>
                {state.syncingNow ? 'Syncing...' : 'Sync now'}
              </button>
            </span>
          </div>
          <div className="panelRow">
            <span>Pull from server</span>
            <span className="panelRowValue">
              <button
                className="stateButton stateButtonSecondary panelInlineButton"
                type="button"
                onClick={handlePreparePull}
                disabled={state.pulling || state.applyingPull}
              >
                {state.pulling ? 'Checking...' : 'Pull'}
              </button>
            </span>
          </div>
          {errors.backupPull && !state.editingPull && <div className="stateMeta stateMetaError">{errors.backupPull}</div>}
        </div>
        <div className="panelSection">
          <h2 className="panelTitle">Security</h2>
          <div className="panelRow">
            <span>Device PIN</span>
            <span className="panelRowValue">
              {hasDevicePin ? 'Set' : 'Not set'}
              <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleEditPin}>
                {hasDevicePin ? 'Change' : 'Set'}
              </button>
            </span>
          </div>
          <div className="panelRow">
            <span>Biometric</span>
            <span className="panelRowValue">
              {biometricAvailable ? (biometricEnabled ? 'Enabled' : 'Disabled') : 'Unavailable'}
              {biometricEnabled && <button
                className="stateButton stateButtonSecondary panelInlineButton"
                type="button"
                onClick={() => setBiometricEnabled(false)}
              >
                Disable
              </button>
              }
            </span>
          </div>
          <button className="stateButton" onClick={() => lock()}>Lock now</button>
        </div>
        <div className="panelSection">
          <h2 className="panelTitle">Notes</h2>
          <label className="panelLabel" htmlFor="note-template">Default note style</label>
          <p className="panelHint">Used to prefill empty notes.</p>
          <textarea
            id="note-template"
            className="editorTextarea"
            placeholder="Example: ## Highlights&#10;- item one&#10;- item two"
            value={noteTemplate}
            onChange={event => { setNoteTemplateState(event.target.value); setStatus({ template: "idle" }) }}
          />
          <div className="editorActions">
            <button className="stateButton" type="button" onClick={handleSaveTemplate} disabled={status.template === 'saving'}>
              {status.template === 'saving' ? 'Saving...' : 'Save template'}
            </button>
            <button
              className="stateButton stateButtonSecondary"
              type="button"
              onClick={handleClearTemplate}
              disabled={status.template === 'saving'}
            >
              Clear
            </button>
            {status.template === 'saved' && <span className="editorStatus editorStatusSuccess">Saved.</span>}
            {errors.template && <span className="editorStatus editorStatusError">{errors.template}</span>}
          </div>
        </div>
      </section>
      {state.editingServer && <div className="modalBackdrop" role="presentation">
        <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="server-edit-title">
          <h2 id="server-edit-title">Server address</h2>
          <p>Optional remote backup server. Leave blank to use default.</p>
          <form className="lockForm" onSubmit={handleSaveServerEdit}>
            <input
              className="lockInput"
              type="text"
              value={serverDraft}
              onChange={event => { setServerDraft(event.target.value); setErrors({ server: null }) }}
              autoFocus
            />
            <div className="lockActions">
              <button className="stateButton" type="submit">Save</button>
              <button className="stateButton stateButtonSecondary" type="button" onClick={() => setState({ editingServer: false })}>Go back</button>
            </div>
          </form>
          {errors.server && <div className="stateMeta stateMetaError">{errors.server}</div>}
        </div>
      </div>
      }
      {state.editingPin && <div className="modalBackdrop" role="presentation">
        <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="pin-edit-title">
          <h2 id="pin-edit-title">Device PIN</h2>
          <p>Set a new PIN for this device.</p>
          <form className="lockForm" onSubmit={handleSavePin}>
            {hasDevicePin && <input
              className="lockInput"
              type="password"
              placeholder="Current PIN"
              value={pin.current}
              onChange={event => { setPin({ current: event.target.value }); setErrors({ pin: null }) }}
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
            />}
            <input
              className="lockInput"
              type="password"
              placeholder="New PIN"
              value={pin.draft}
              onChange={event => { setPin({ draft: event.target.value }); setErrors({ pin: null }) }}
              inputMode="numeric"
              autoComplete="new-password"
              autoFocus={!hasDevicePin}
            />
            <input
              className="lockInput"
              type="password"
              placeholder="Confirm PIN"
              value={pin.confirm}
              onChange={event => { setPin({ confirm: event.target.value }); setErrors({ pin: null }) }}
              inputMode="numeric"
              autoComplete="new-password"
            />
            <div className="lockActions">
              <button className="stateButton" type="submit">Save</button>
              <button className="stateButton stateButtonSecondary" type="button" onClick={() => setState({ editingPin: false })}>Go back</button>
            </div>
          </form>
          {errors.pin && <div className="stateMeta stateMetaError">{errors.pin}</div>}
        </div>
      </div>}
      {state.editingRemote && <div className="modalBackdrop" role="presentation">
        <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="remote-credentials-title">
          <h2 id="remote-credentials-title">Remote credentials</h2>
          <p>Use the current server password, then set your new server password.</p>
          <form className="lockForm" onSubmit={handleSaveRemoteCredentials}>
            <input
              className="lockInput"
              type="password"
              placeholder="Current server password"
              value={serverCredentials.currentServerPassword}
              onChange={event => { setServerCredentials({ currentServerPassword: event.target.value }); setErrors({ remoteCredentials: null }) }}
              autoComplete="current-password"
              autoFocus
            />
            <input
              className="lockInput"
              type="password"
              placeholder="New password"
              value={serverCredentials.password}
              onChange={event => { setServerCredentials({ password: event.target.value }); setErrors({ remoteCredentials: null }) }}
              autoComplete="new-password"
            />
            <input
              className="lockInput"
              type="password"
              placeholder="Confirm new password"
              value={serverCredentials.passwordConfirm}
              onChange={event => { setServerCredentials({ passwordConfirm: event.target.value }); setErrors({ remoteCredentials: null }) }}
              autoComplete="new-password"
            />
            <div className="lockActions">
              <button className="stateButton" type="submit" disabled={status.remoteCredentials === 'saving'}>
                {status.remoteCredentials === 'saving' ? 'Saving...' : 'Save'}
              </button>
              <button className="stateButton stateButtonSecondary" type="button" onClick={() => setState({ editingRemote: false })}>Go back</button>
            </div>
          </form>
          {errors.remoteCredentials && <div className="stateMeta stateMetaError">{errors.remoteCredentials}</div>}
        </div>
      </div>}
      {state.editingPull && pullPreview && <div className="modalBackdrop" role="presentation">
        <div className="stateCard modalCard backupPullCard" role="dialog" aria-modal="true" aria-labelledby="backup-pull-title">
          <h2 id="backup-pull-title">Pull from server</h2>
          <p>For conflict days, choose which version to keep. Non-conflicting days merge automatically.</p>
          <div className="stateMeta">
            Conflicts: {pullPreview.conflicts.length}, Local-only: {pullPreview.localOnlyDays}, Server-only: {pullPreview.remoteOnlyDays}, Identical: {pullPreview.identicalDays}
          </div>
          {pullPreview.conflicts.length > 0
            ? <div className="backupConflictList">
              {pullPreview.conflicts.map(conflict => (
                <div key={conflict.date} className="backupConflictItem">
                  <div className="backupConflictHeader">{conflict.date}</div>
                  <div className="backupConflictMeta">Local: {summarizeConflictDay(conflict.local)}</div>
                  <div className="backupConflictMeta">Server: {summarizeConflictDay(conflict.remote)}</div>
                  <select
                    className="lockInput"
                    value={pullChoices[conflict.date] ?? ''}
                    onChange={event => setPullChoices(previous => ({ ...previous, [conflict.date]: event.target.value as BackupConflictChoice | '' }))}
                  >
                    <option value="">Choose what to keep</option>
                    <option value="local">Keep local</option>
                    <option value="remote">Keep server</option>
                  </select>
                </div>
              ))}
            </div>
            : <div className="stateMeta">No conflicts found. Pull will merge in server data.</div>
          }
          {unresolvedPullConflicts > 0 && <div className="stateMeta">Unresolved conflicts: {unresolvedPullConflicts}</div>}
          {errors.backupPull && <div className="stateMeta stateMetaError">{errors.backupPull}</div>}
          <div className="lockActions">
            <button className="stateButton" type="button" onClick={handleApplyPull} disabled={state.applyingPull || unresolvedPullConflicts > 0}>
              {state.applyingPull ? 'Applying...' : 'Apply pull'}
            </button>
            <button className="stateButton stateButtonSecondary" type="button" onClick={closePullModal}>Go back</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
