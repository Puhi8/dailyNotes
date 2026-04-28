import { useEffect, useState } from 'react'
import MarkdownEditor from '../../components/MarkdownEditor'
import { getNoteHeaderColors, getNoteTemplate, loadNoteTemplateFromApi, saveNoteTemplateToApi, setNoteHeaderColors, subscribeNoteTemplateChange } from '../../data/noteSettings'
import type { StatusOptions } from '../../data/types'
import { Button, ToggleSwitch } from '../../utils/simplifyReact'
import { SettingsSection } from './SettingsShared'

export default function NotesSettings() {
  const [noteTemplate, setNoteTemplateState] = useState(() => getNoteTemplate())
  const [colorNoteHeadings, setColorNoteHeadingsState] = useState(() => getNoteHeaderColors())
  const [status, setStatus] = useState<StatusOptions>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const syncTemplateFromStorage = () => { if (active) setNoteTemplateState(getNoteTemplate()) }
    const unsubscribeTemplate = subscribeNoteTemplateChange(syncTemplateFromStorage)
    loadNoteTemplateFromApi()
      .then(template => {
        if (!active) return
        setNoteTemplateState(template)
        setError(null)
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Failed to load note template.') })
    return () => {
      active = false
      unsubscribeTemplate()
    }
  }, [])

  const saveTemplateValue = async (value: string) => {
    setError(null)
    setStatus('saving')
    try {
      await saveNoteTemplateToApi(value)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 1500)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note template.')
      setStatus('idle')
    }
  }

  const handleClearTemplate = async () => {
    setNoteTemplateState('')
    await saveTemplateValue('')
  }

  return <SettingsSection title="Notes">
    <div className="panelRow">
      <span>Color note headings</span>
      <span className="panelRowValue panelRowValueToggle">
        {colorNoteHeadings ? 'Enabled' : 'Disabled'}
        <ToggleSwitch
          ariaLabel="Toggle note heading colors"
          checked={colorNoteHeadings}
          onChange={() => setColorNoteHeadingsState(setNoteHeaderColors(!colorNoteHeadings))}
        />
      </span>
    </div>
    <label className="panelLabel" htmlFor="note-template">Default note style</label>
    <MarkdownEditor
      id="note-template"
      className="noteMarkdownEditor"
      colorHeadings={colorNoteHeadings}
      placeholder="Example: ## Highlights&#10;- item one&#10;- item two"
      value={noteTemplate}
      onChange={value => { setNoteTemplateState(value); setStatus('idle') }}
    />
    <div className="editorActions">
      <Button.primary onClick={async () => await saveTemplateValue(noteTemplate)} disabled={status === 'saving'}>
        {status === 'saving' ? 'Saving...' : 'Save template'}
      </Button.primary>
      <Button.secondary onClick={handleClearTemplate} disabled={status === 'saving'}>Clear</Button.secondary>
      {status === 'saved' && <span className="editorStatus editorStatusSuccess">Saved.</span>}
      {error && <span className="editorStatus editorStatusError">{error}</span>}
    </div>
  </SettingsSection>
}
