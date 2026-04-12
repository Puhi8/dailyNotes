import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import MarkdownEditor from '../components/MarkdownEditor'
import { api, type BackupConflictChoice, type BackupAccomplishmentChoice, type BackupPullPreview, type BackupSyncStatus } from '../data/api'
import graph, { GRAPH_COMPACTNESS_MAX, GRAPH_COMPACTNESS_MIN, type GraphLineMode } from '../data/graph'
import { getNoteHeaderColors, getNoteTemplate, loadNoteTemplateFromApi, saveNoteTemplateToApi, setNoteHeaderColors } from '../data/noteSettings'
import theme, { DEFAULT_ACCENT_COLOR } from '../data/theme'
import SettingsPopups, { type SettingsPopupKey } from './SettingsPopups'
import { useSecurity } from '../security'
import type { StatusOptions } from '../data/types'
import { toUpperCase, useObjectState } from '../utils/functions'
import { registerCloseOnBack } from '../utils/hardwareBack'

type errorsType = {
  template: string | null
  server: string | null
  pin: string | null
  biometric: string | null
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
  confirmingBiometric: boolean
  editingRemote: boolean
  pulling: boolean
  editingPull: boolean
  applyingPull: boolean
}

type pullItems = {
  preview: BackupPullPreview | null
  choices: Record<string, BackupConflictChoice | "">
  accomplishmentChoice: BackupAccomplishmentChoice | ""
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

function formatServerDisplay(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return 'Not set'
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return withoutScheme || trimmed
}
function convertStateObjectToText(state: stateType, pullPreview: BackupPullPreview | null) {
  if (state.editingPull && pullPreview) return "pull"
  if (state.editingRemote) return "remote"
  if (state.editingPin) return "pin"
  if (state.editingServer) return "server"
  return null
}

function summarizeConflictDay(source: { note: string; data: Record<string, unknown> }) {
  return `${Object.keys(source.data ?? {}).length} tasks, ${source.note.trim() ? 'has' : 'no'} note`
}

export default function Settings() {
  const navigate = useNavigate()
  const { hasDevicePin, biometricAvailable, biometricReady, biometricEnabled, setBiometricEnabled, confirmBiometricIdentity, verifyPin, setDevicePin, lock } = useSecurity()
  const [errors, setErrors] = useObjectState<errorsType>({ template: null, server: null, pin: null, biometric: null, remoteCredentials: null, backupPull: null })
  const [noteTemplate, setNoteTemplateState] = useState(() => getNoteTemplate())
  const [colorNoteHeadings, setColorNoteHeadingsState] = useState(() => getNoteHeaderColors())
  const [apiBaseUrl, setApiBaseUrlState] = useState(() => api.config.baseUrl.get())
  const [serverDraft, setServerDraft] = useState(apiBaseUrl)
  const [backup, setBackup] = useObjectState<{ enabled: boolean, status: BackupSyncStatus }>({ enabled: api.backup.isAutoSyncEnabled(), status: api.backup.getStatus() })
  const [remoteSessionConnected, setRemoteSessionConnected] = useState(() => api.auth.session.hasSession())
  const [graphCompactness, setGraphCompactnessState] = useState(() => graph.settings.line.compactness.get())
  const [graphLineMode, setGraphLineModeState] = useState<GraphLineMode>(() => graph.settings.line.mode.get())
  const [graphHeatmapUseMultiColor, setGraphHeatmapUseMultiColorState] = useState(() => graph.settings.heatmap.multiColor.get())
  const [accentColor, setAccentColorState] = useState(() => theme.settings.accent.get())
  const [status, setStatus] = useObjectState<statusType>({ template: 'idle', remoteCredentials: 'idle' })
  const [state, setState] = useObjectState<stateType>({
    editingServer: false, syncingNow: false, editingPin: false, confirmingBiometric: false, editingRemote: false, pulling: false, editingPull: false, applyingPull: false
  })
  const [pin, setPin, resetPin] = useObjectState<pinType>({ current: "", draft: "", confirm: "" })
  const [serverCredentials, setServerCredentials, resetServerCredentials] = useObjectState<serverCredentials>({ password: "", passwordConfirm: "", currentServerPassword: "", })
  const [pull, setPull, resetPull] = useObjectState<pullItems>({ preview: null, choices: {}, accomplishmentChoice: "" })
  const activePopup: SettingsPopupKey = convertStateObjectToText(state, pull.preview)

  useEffect(() => {
    if (activePopup) return registerCloseOnBack(() => {
      switch (activePopup) {
        case "pull":
          setState({ editingPull: false, applyingPull: false })
          resetPull()
          setErrors({ backupPull: null })
          return
        case "remote":
          setState({ editingRemote: false })
          return
        case "pin":
          setState({ editingPin: false })
          return
      }
      setState({ editingServer: false })
    })
  }, [activePopup, resetPull, setErrors, setState])

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
      setBackup({ enabled: api.backup.isAutoSyncEnabled(), status: api.backup.getStatus() })
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
    setApiBaseUrlState(api.config.baseUrl.set(serverDraft))
    setState({ editingServer: false })
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
    setState({ editingPull: false, applyingPull: false })
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
      setPull({ preview, choices: nextChoices, accomplishmentChoice: "" })
      setState({ editingPull: true })
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
      const result = await api.backup.applyPull(pull.preview.remoteSnapshot, decisions, pull.accomplishmentChoice as BackupAccomplishmentChoice)
      setNoteTemplateState(result.noteTemplate)
      closePullModal()
    }
    catch (err) { setErrors({ backupPull: err instanceof Error ? err.message : 'Failed to apply server pull.' }) }
    finally { setState({ applyingPull: false }) }
  }

  const handleEditPin = () => {
    resetPin()
    setErrors({ pin: null })
    setState({ editingPin: true })
  }

  const handleEditRemoteCredentials = () => {
    if (!remoteSessionConnected) {
      navigate('/login', { state: { from: '/settings' } })
      return
    }
    resetServerCredentials()
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

  const handleToggleBiometric = async () => {
    if (state.confirmingBiometric) return
    setErrors({ biometric: null })
    if (!biometricReady) {
      setErrors({ biometric: 'Checking biometric availability.' })
      return
    }
    if (!biometricAvailable) {
      setErrors({ biometric: 'Biometric unlock is not available on this device.' })
      return
    }
    const nextEnabled = !biometricEnabled
    setState({ confirmingBiometric: true })
    try {
      const confirmed = await confirmBiometricIdentity(nextEnabled ? 'Enable biometric unlock' : 'Disable biometric unlock')
      if (!confirmed) {
        setErrors({ biometric: 'Biometric confirmation failed.' })
        return
      }
      setBiometricEnabled(nextEnabled)
    }
    finally { setState({ confirmingBiometric: false }) }
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

  const handleClearTemplate = async () => {
    setNoteTemplateState('')
    await saveTemplateValue('')
  }

  return <div className="page">
    <section className="panelCard panelStack">
      <div className="panelSection">
        <h2 className="panelTitle">Appearance</h2>
        <div className="panelRow panelRowTopAlign">
          <div className="panelRowLabelGroup">
            <span>Accent color</span>
          </div>
          <span className="panelRowValue panelRowValueTheme">
            <label className="themeColorField" htmlFor="accent-color">
              <input
                id="accent-color"
                className="themeColorInput"
                type="color"
                value={accentColor}
                onChange={e => setAccentColorState(theme.settings.accent.set(e.target.value))}
              />
              <span className="themeColorValue">{accentColor.toUpperCase()}</span>
            </label>
            <button
              className="stateButton stateButtonSecondary panelInlineButton"
              type="button"
              onClick={() => confirm("Do you really want to reset your color?") && setAccentColorState(theme.settings.accent.reset())}
              disabled={accentColor === DEFAULT_ACCENT_COLOR}
            >
              Reset
            </button>
          </span>
        </div>
      </div>
      <div className="panelSection">
        <h2 className="panelTitle">Graphs settings</h2>
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
            onChange={event => setGraphCompactnessState(graph.settings.line.compactness.set(Number(event.target.value)))}
          />
          <span className="rangeLabel">Spread out</span>
        </div>
        <div className="panelRow">
          <span>Line style</span>
          <span className="panelRowValue">
            <select
              className="lockInput panelInlineSelect"
              value={graphLineMode}
              onChange={event => setGraphLineModeState(graph.settings.line.mode.set(event.target.value as GraphLineMode))}
            >
              <option value="raw">Raw daily line</option>
              <option value="raw_plus_10">Raw + 10-day avg</option>
              <option value="avg10_all_days">10-day avg all days</option>
            </select>
          </span>
        </div>
        <div className="panelRow">
          <span>Heatmap colors</span>
          <span className="panelRowValue">
            <select
              className="lockInput panelInlineSelect"
              value={graphHeatmapUseMultiColor ? 'multi' : 'single'}
              onChange={event => setGraphHeatmapUseMultiColorState(graph.settings.heatmap.multiColor.set(event.target.value === 'multi'))}
            >
              <option value="multi">Colored</option>
              <option value="single">Faded</option>
            </select>
          </span>
        </div>
      </div>
      <div className="panelSection">
        <h2 className="panelTitle">Backup <span>{toUpperCase(backup.status.state)}</span></h2>
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
          <span className="panelRowValue panelRowValueToggle">
            {backup.enabled ? 'Enabled' : 'Disabled'}
            <label className="toggleSwitch" aria-label="Toggle auto sync">
              <input
                className="toggleSwitchInput"
                type="checkbox"
                checked={backup.enabled}
                onChange={handleToggleBackup}
              />
              <span className="toggleSwitchTrack" />
            </label>
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
            <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleSyncNow} disabled={state.syncingNow || !backup.enabled}>
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
        {errors.backupPull && activePopup !== 'pull' && <div className="stateMeta stateMetaError">{errors.backupPull}</div>}
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
          <span className="panelRowValue panelRowValueToggle">
            {state.confirmingBiometric ? 'Confirming...' : biometricReady ? biometricAvailable ? (biometricEnabled ? 'Enabled' : 'Disabled') : 'Unavailable' : 'Checking...'}
            {(!biometricReady || biometricAvailable) && <label className="toggleSwitch" aria-label="Toggle biometric unlock">
              <input
                className="toggleSwitchInput"
                type="checkbox"
                checked={biometricEnabled}
                onChange={() => { void handleToggleBiometric() }}
                disabled={!biometricReady || state.confirmingBiometric}
              />
              <span className="toggleSwitchTrack" />
            </label>}
          </span>
        </div>
        {errors.biometric && <div className="stateMeta stateMetaError">{errors.biometric}</div>}
        <button className="stateButton" onClick={() => lock()}>Lock now</button>
      </div>
      <div className="panelSection">
        <h2 className="panelTitle">Notes</h2>
        <div className="panelRow">
          <span>Color note headings</span>
          <span className="panelRowValue panelRowValueToggle">
            {colorNoteHeadings ? 'Enabled' : 'Disabled'}
            <label className="toggleSwitch" aria-label="Toggle note heading colors">
              <input
                className="toggleSwitchInput"
                type="checkbox"
                checked={colorNoteHeadings}
                onChange={() => setColorNoteHeadingsState(setNoteHeaderColors(!colorNoteHeadings))}
              />
              <span className="toggleSwitchTrack" />
            </label>
          </span>
        </div>
        <label className="panelLabel" htmlFor="note-template">Default note style</label>
        <MarkdownEditor
          id="note-template"
          className="noteMarkdownEditor"
          colorHeadings={colorNoteHeadings}
          placeholder="Example: ## Highlights&#10;- item one&#10;- item two"
          value={noteTemplate}
          onChange={value => { setNoteTemplateState(value); setStatus({ template: "idle" }) }}
        />
        <div className="editorActions">
          <button className="stateButton" type="button" onClick={async () => await saveTemplateValue(noteTemplate)} disabled={status.template === 'saving'}>
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
    <SettingsPopups
      activePopup={activePopup}
      server={{
        draft: serverDraft,
        error: errors.server,
        onDraftChange: value => { setServerDraft(value); setErrors({ server: null }) },
        onSave: handleSaveServerEdit,
        onClose: () => setState({ editingServer: false }),
      }}
      pin={{
        hasDevicePin,
        values: pin,
        error: errors.pin,
        onChange: (field, value) => { setPin({ [field]: value } as Partial<pinType>); setErrors({ pin: null }) },
        onSave: handleSavePin,
        onClose: () => setState({ editingPin: false }),
      }}
      remote={{
        values: serverCredentials,
        status: status.remoteCredentials,
        error: errors.remoteCredentials,
        onChange: (field, value) => { setServerCredentials({ [field]: value } as Partial<serverCredentials>); setErrors({ remoteCredentials: null }) },
        onSave: handleSaveRemoteCredentials,
        onClose: () => setState({ editingRemote: false }),
      }}
      pull={pull.preview && {
        values: {
          preview: pull.preview,
          choices: pull.choices,
          accomplishmentChoice: pull.accomplishmentChoice,
        },
        unresolvedConflicts: unresolvedPullConflicts,
        unresolvedAccomplishmentChoice,
        applying: state.applyingPull,
        error: errors.backupPull,
        onAccomplishmentChoiceChange: value => setPull({ accomplishmentChoice: value }),
        onConflictChoiceChange: (date, value) => setPull(previous => ({ choices: { ...previous.choices, [date]: value } })),
        onApply: handleApplyPull,
        onClose: closePullModal,
        summarizeConflictDay,
      }}
    />
  </div>
}
