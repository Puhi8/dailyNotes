import AppearanceSettings from './settings/AppearanceSettings'
import BackupSettings from './settings/BackupSettings'
import GraphSettings from './settings/GraphSettings'
import NotesSettings from './settings/NotesSettings'
import SecuritySettings from './settings/SecuritySettings'

export default function Settings() {
  return <div className="page">
    <section className="panelCard panelStack">
      <AppearanceSettings />
      <GraphSettings />
      <BackupSettings />
      <SecuritySettings />
      <NotesSettings />
    </section>
  </div>
}
