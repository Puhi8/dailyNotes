import type { FormEvent, ReactNode } from 'react'
import type { BackupAccomplishmentChoice, BackupConflictChoice, BackupPullPreview } from '../data/api'
import type { StatusOptions } from '../data/types'
import { Button, LockInput, ModalShell } from '../utils/simplifyReact'

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

type SettingsFormPopupProps = {
  children: ReactNode
  description: string
  error: string | null
  onClose: () => void
  onSave: (event: FormEvent) => void
  saveDisabled?: boolean
  saveLabel?: string
  title: string
  titleId: string
}

const SettingsFormPopup = ({ children, description, error, onClose, onSave, saveDisabled, saveLabel = 'Save', title, titleId }: SettingsFormPopupProps) => (
  <ModalShell titleId={titleId}>
    <h2 id={titleId}>{title}</h2>
    <p>{description}</p>
    <form className="lockForm" onSubmit={onSave}>
      {children}
      <div className="lockActions">
        <Button.primary type="submit" disabled={saveDisabled}>{saveLabel}</Button.primary>
        <Button.secondary onClick={onClose}>Go back</Button.secondary>
      </div>
    </form>
    {error && <div className="stateMeta stateMetaError">{error}</div>}
  </ModalShell>
)

const ServerPopup = ({ draft, error, onDraftChange, onSave, onClose }: ServerPopupConfig) => (
  <SettingsFormPopup
    titleId="server-edit-title"
    title="Server address"
    description="Optional remote backup server. Leave blank to use default."
    error={error}
    onSave={onSave}
    onClose={onClose}
  >
    <LockInput.text
      value={draft}
      onChange={event => onDraftChange(event.target.value)}
      autoFocus
    />
  </SettingsFormPopup>
)

const PinPopup = ({ hasDevicePin, values, error, onChange, onSave, onClose }: PinPopupConfig) => (
  <SettingsFormPopup
    titleId="pin-edit-title"
    title="Device PIN"
    description="Set a new PIN for this device."
    error={error}
    onSave={onSave}
    onClose={onClose}
  >
    {hasDevicePin && <LockInput.pin
      placeholder="Current PIN"
      value={values.current}
      onChange={event => onChange('current', event.target.value)}
      autoComplete="current-password"
      autoFocus
    />}
    <LockInput.newPin
      placeholder="New PIN"
      value={values.draft}
      onChange={event => onChange('draft', event.target.value)}
      autoFocus={!hasDevicePin}
    />
    <LockInput.newPin
      placeholder="Confirm PIN"
      value={values.confirm}
      onChange={event => onChange('confirm', event.target.value)}
    />
  </SettingsFormPopup>
)

const RemoteCredentialsPopup = ({ values, status, error, onChange, onSave, onClose }: RemotePopupConfig) => (
  <SettingsFormPopup
    titleId="remote-credentials-title"
    title="Remote credentials"
    description="Use the current server password, then set your new server password."
    error={error}
    onSave={onSave}
    onClose={onClose}
    saveDisabled={status === 'saving'}
    saveLabel={status === 'saving' ? 'Saving...' : 'Save'}
  >
    <LockInput.password
      placeholder="Current server password"
      value={values.currentServerPassword}
      onChange={event => onChange('currentServerPassword', event.target.value)}
      autoComplete="current-password"
      autoFocus
    />
    <LockInput.password
      placeholder="New password"
      value={values.password}
      onChange={event => onChange('password', event.target.value)}
      autoComplete="new-password"
    />
    <LockInput.password
      placeholder="Confirm new password"
      value={values.passwordConfirm}
      onChange={event => onChange('passwordConfirm', event.target.value)}
      autoComplete="new-password"
    />
  </SettingsFormPopup>
)

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
  return <ModalShell titleId="backup-pull-title" className="backupPullCard">
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
      <Button.primary
        onClick={onApply}
        disabled={applying || unresolvedConflicts > 0 || unresolvedAccomplishmentChoice}
      >
        {applying ? 'Applying...' : 'Apply pull'}
      </Button.primary>
      <Button.secondary onClick={onClose}>Go back</Button.secondary>
    </div>
  </ModalShell>
}

export default function SettingsPopupManager({ activePopup, server, pin, remote, pull }: SettingsPopupManagerProps) {
  if (activePopup === 'server') return <ServerPopup {...server} />
  if (activePopup === 'pin') return <PinPopup {...pin} />
  if (activePopup === 'remote') return <RemoteCredentialsPopup {...remote} />
  if (activePopup === 'pull' && pull) return <PullPopup {...pull} />
  return null
}
