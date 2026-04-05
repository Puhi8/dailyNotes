import type { FormEvent } from 'react'
import type { BackupAccomplishmentChoice, BackupConflictChoice, BackupPullPreview } from '../data/api'
import type { StatusOptions } from '../data/types'

export type SettingsPopupKey = 'server' | 'pin' | 'remote' | 'pull' | null

type PinValues = {
  current: string
  draft: string
  confirm: string
}

type ServerCredentialsValues = {
  password: string
  passwordConfirm: string
  currentServerPassword: string
}

type PullValues = {
  preview: BackupPullPreview
  choices: Record<string, BackupConflictChoice | ''>
  accomplishmentChoice: BackupAccomplishmentChoice | ''
}

type ServerPopupConfig = {
  draft: string
  error: string | null
  onDraftChange: (value: string) => void
  onSave: (event: FormEvent) => void
  onClose: () => void
}

type PinPopupConfig = {
  hasDevicePin: boolean
  values: PinValues
  error: string | null
  onChange: (field: keyof PinValues, value: string) => void
  onSave: (event: FormEvent) => void
  onClose: () => void
}

type RemotePopupConfig = {
  values: ServerCredentialsValues
  status: StatusOptions
  error: string | null
  onChange: (field: keyof ServerCredentialsValues, value: string) => void
  onSave: (event: FormEvent) => void
  onClose: () => void
}

type PullPopupConfig = {
  values: PullValues
  unresolvedConflicts: number
  unresolvedAccomplishmentChoice: boolean
  applying: boolean
  error: string | null
  onAccomplishmentChoiceChange: (value: BackupAccomplishmentChoice | '') => void
  onConflictChoiceChange: (date: string, value: BackupConflictChoice | '') => void
  onApply: () => void
  onClose: () => void
  summarizeConflictDay: (source: { note: string; data: Record<string, unknown> }) => string
}

type SettingsPopupManagerProps = {
  activePopup: SettingsPopupKey
  server: ServerPopupConfig
  pin: PinPopupConfig
  remote: RemotePopupConfig
  pull: PullPopupConfig | null
}

function ServerPopup({ draft, error, onDraftChange, onSave, onClose }: ServerPopupConfig) {
  return <div className="modalBackdrop" role="presentation">
    <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="server-edit-title">
      <h2 id="server-edit-title">Server address</h2>
      <p>Optional remote backup server. Leave blank to use default.</p>
      <form className="lockForm" onSubmit={onSave}>
        <input
          className="lockInput"
          type="text"
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          autoFocus
        />
        <div className="lockActions">
          <button className="stateButton" type="submit">Save</button>
          <button className="stateButton stateButtonSecondary" type="button" onClick={onClose}>Go back</button>
        </div>
      </form>
      {error && <div className="stateMeta stateMetaError">{error}</div>}
    </div>
  </div>
}

function PinPopup({ hasDevicePin, values, error, onChange, onSave, onClose }: PinPopupConfig) {
  return <div className="modalBackdrop" role="presentation">
    <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="pin-edit-title">
      <h2 id="pin-edit-title">Device PIN</h2>
      <p>Set a new PIN for this device.</p>
      <form className="lockForm" onSubmit={onSave}>
        {hasDevicePin && <input
          className="lockInput"
          type="password"
          placeholder="Current PIN"
          value={values.current}
          onChange={event => onChange('current', event.target.value)}
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
        />}
        <input
          className="lockInput"
          type="password"
          placeholder="New PIN"
          value={values.draft}
          onChange={event => onChange('draft', event.target.value)}
          inputMode="numeric"
          autoComplete="new-password"
          autoFocus={!hasDevicePin}
        />
        <input
          className="lockInput"
          type="password"
          placeholder="Confirm PIN"
          value={values.confirm}
          onChange={event => onChange('confirm', event.target.value)}
          inputMode="numeric"
          autoComplete="new-password"
        />
        <div className="lockActions">
          <button className="stateButton" type="submit">Save</button>
          <button className="stateButton stateButtonSecondary" type="button" onClick={onClose}>Go back</button>
        </div>
      </form>
      {error && <div className="stateMeta stateMetaError">{error}</div>}
    </div>
  </div>
}

function RemoteCredentialsPopup({ values, status, error, onChange, onSave, onClose }: RemotePopupConfig) {
  return <div className="modalBackdrop" role="presentation">
    <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="remote-credentials-title">
      <h2 id="remote-credentials-title">Remote credentials</h2>
      <p>Use the current server password, then set your new server password.</p>
      <form className="lockForm" onSubmit={onSave}>
        <input
          className="lockInput"
          type="password"
          placeholder="Current server password"
          value={values.currentServerPassword}
          onChange={event => onChange('currentServerPassword', event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        <input
          className="lockInput"
          type="password"
          placeholder="New password"
          value={values.password}
          onChange={event => onChange('password', event.target.value)}
          autoComplete="new-password"
        />
        <input
          className="lockInput"
          type="password"
          placeholder="Confirm new password"
          value={values.passwordConfirm}
          onChange={event => onChange('passwordConfirm', event.target.value)}
          autoComplete="new-password"
        />
        <div className="lockActions">
          <button className="stateButton" type="submit" disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving...' : 'Save'}
          </button>
          <button className="stateButton stateButtonSecondary" type="button" onClick={onClose}>Go back</button>
        </div>
      </form>
      {error && <div className="stateMeta stateMetaError">{error}</div>}
    </div>
  </div>
}

function PullPopup({
  values,
  unresolvedConflicts,
  unresolvedAccomplishmentChoice,
  applying,
  error,
  onAccomplishmentChoiceChange,
  onConflictChoiceChange,
  onApply,
  onClose,
  summarizeConflictDay,
}: PullPopupConfig) {
  const preview = values.preview
  return <div className="modalBackdrop" role="presentation">
    <div className="stateCard modalCard backupPullCard" role="dialog" aria-modal="true" aria-labelledby="backup-pull-title">
      <h2 id="backup-pull-title">Pull from server</h2>
      <p>For conflict days, choose which version to keep. Non-conflicting days merge automatically.</p>
      <div className="stateMeta">
        Conflicts: {preview.conflicts.length}, Local-only: {preview.localOnlyDays}, Server-only: {preview.remoteOnlyDays}, Identical: {preview.identicalDays}
      </div>
      <div className="stateMeta">
        Accomplishments - Different: {preview.differingAccomplishments}, Local-only: {preview.localOnlyAccomplishments}, Server-only: {preview.remoteOnlyAccomplishments}, Identical: {preview.identicalAccomplishments}
      </div>
      {preview.accomplishmentOrderDiffers && <div className="stateMeta">
        Accomplishment order differs between local and server.
      </div>}
      <select
        className="lockInput"
        value={values.accomplishmentChoice}
        onChange={event => onAccomplishmentChoiceChange(event.target.value as BackupAccomplishmentChoice | '')}
      >
        <option value="">Choose accomplishments source</option>
        <option value="local">Keep local accomplishments</option>
        <option value="remote">Keep server accomplishments</option>
        <option value="merge">Merge both accomplishments</option>
      </select>
      {preview.conflicts.length > 0
        ? <div className="backupConflictList">
          {preview.conflicts.map(conflict => (
            <div key={conflict.date} className="backupConflictItem">
              <div className="backupConflictHeader">{conflict.date}</div>
              <div className="backupConflictMeta">Local: {summarizeConflictDay(conflict.local)}</div>
              <div className="backupConflictMeta">Server: {summarizeConflictDay(conflict.remote)}</div>
              <select
                className="lockInput"
                value={values.choices[conflict.date] ?? ''}
                onChange={event => onConflictChoiceChange(conflict.date, event.target.value as BackupConflictChoice | '')}
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
      {unresolvedConflicts > 0 && <div className="stateMeta">Unresolved day conflicts: {unresolvedConflicts}</div>}
      {unresolvedAccomplishmentChoice && <div className="stateMeta">Unresolved accomplishment choice.</div>}
      {error && <div className="stateMeta stateMetaError">{error}</div>}
      <div className="lockActions">
        <button
          className="stateButton"
          type="button"
          onClick={onApply}
          disabled={applying || unresolvedConflicts > 0 || unresolvedAccomplishmentChoice}
        >
          {applying ? 'Applying...' : 'Apply pull'}
        </button>
        <button className="stateButton stateButtonSecondary" type="button" onClick={onClose}>Go back</button>
      </div>
    </div>
  </div>
}

export default function SettingsPopupManager({ activePopup, server, pin, remote, pull }: SettingsPopupManagerProps) {
  if (activePopup === 'server') return <ServerPopup {...server} />
  if (activePopup === 'pin') return <PinPopup {...pin} />
  if (activePopup === 'remote') return <RemoteCredentialsPopup {...remote} />
  if (activePopup === 'pull' && pull) return <PullPopup {...pull} />
  return null
}
