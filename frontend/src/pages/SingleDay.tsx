import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ErrorState from '../components/ErrorState'
import { api, type DayData } from '../data/api'
import { applyNoteTemplate, resolveNoteTemplate } from '../data/noteSettings'
import type { IndividualDay, StatusOptions } from '../data/types'
import { toUpperCase } from '../utils/functions'
import { saveIndividualDay } from '../data/localWrite'

const isSameData = (left: DayData, right: DayData) => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let i = 0; i < leftKeys.length; i += 1) {
    const key = leftKeys[i]
    if (key !== rightKeys[i] || left[key] !== right[key]) return false
  }
  return true
}

const AUTOSAVE_DEBOUNCE_MS = 700
export default function SingleDay({ dayType }: { dayType: IndividualDay }) {
  const [date, setDate] = useState('')
  const [data, setData] = useState<DayData>({})
  const [originalData, setOriginalData] = useState<DayData>({})
  const [note, setNote] = useState('')
  const [originalNote, setOriginalNote] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<StatusOptions>('idle')
  const dataRef = useRef<DayData>(data)
  const noteRef = useRef(note)
  const originalDataRef = useRef<DayData>(originalData)
  const originalNoteRef = useRef(originalNote)
  const saveTimerRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const queuedSaveRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.all([api.day.getIndividual(dayType), resolveNoteTemplate()])
      .then(([result, template]) => {
        if (cancelled) return
        const displayNote = applyNoteTemplate(result.note || '', String(template)).note
        setDate(result.date)
        setData(result.data)
        setOriginalData(result.data)
        setNote(displayNote)
        setOriginalNote(displayNote)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Request failed')
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => {
      cancelled = true
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [dayType])

  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { noteRef.current = note }, [note])
  useEffect(() => { originalDataRef.current = originalData }, [originalData])
  useEffect(() => { originalNoteRef.current = originalNote }, [originalNote])

  const entries = useMemo(() => Object.entries(data).sort(([a], [b]) => a.localeCompare(b)), [data])
  const isDirty = !isSameData(originalData, data) || note !== originalNote

  const updateValue = (key: string, value: DayData[string]) => {
    setData(prev => ({ ...prev, [key]: value }))
    setSaveStatus('idle')
  }

  const handleNoteChange = (value: string) => {
    setNote(value)
    setSaveStatus('idle')
  }

  const handleSave = useCallback(async () => {
    if (saveInFlightRef.current) {
      queuedSaveRef.current = true
      return
    }
    if (isSameData(originalDataRef.current, dataRef.current) && noteRef.current === originalNoteRef.current) return

    saveInFlightRef.current = true
    setSaveError(null)
    setSaveStatus('saving')
    const dataToSave = dataRef.current
    const noteToSave = noteRef.current
    try {
      const result = await saveIndividualDay(dayType, { data: dataToSave, note: noteToSave })
      setDate(result.date)
      setOriginalData(dataToSave)
      setOriginalNote(noteToSave)
      setSaveStatus('saved')
    }
    catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      setSaveStatus('idle')
    }
    finally {
      saveInFlightRef.current = false
      const changedSinceSaveStarted = !isSameData(dataRef.current, dataToSave) || noteRef.current !== noteToSave
      if (queuedSaveRef.current || changedSinceSaveStarted) {
        queuedSaveRef.current = false
        void handleSave()
      }
    }
  }, [dayType])

  useEffect(() => {
    if (!isDirty) return
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void handleSave()
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [AUTOSAVE_DEBOUNCE_MS, data, handleSave, isDirty, note])

  if (isLoading) return <div className="state">Loading {dayType}...</div>
  if (error) return <ErrorState error={error} onReload={() => window.location.reload()} />

  return <div className="page">
    <header className="pageHeader">
      <h1>{toUpperCase(dayType)}</h1>
      <p>Editing data for {date || dayType}.</p>
    </header>
    <section className="panelCard panelStack">
      <div className="panelSection">
        <h2 className="panelTitle">Checklist</h2>
        {entries.length === 0
          ? <div className="panelEmpty">No entries for {dayType}.</div>
          : <div className="editorList"> {
            entries.map(([key, value]) => {
              return <div className="editorRow" key={key}>
                <span className="editorLabel">{key}</span>
                {typeof value === 'boolean'
                  ? <label className="editorSwitch">
                    <input
                      className="editorSwitchInput"
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={event => updateValue(key, event.target.checked)}
                    />
                    <span className="editorSwitchSlider" aria-hidden="true" />
                  </label>
                  : <input
                    className="editorInput"
                    type="text"
                    value={value == null ? '' : String(value)}
                    onChange={event => updateValue(key, event.target.value)}
                  />
                }
              </div>
            })}
          </div>
        }
      </div>
      <div className="panelSection">
        <h2 className="panelTitle">Note (.md)</h2>
        <textarea
          className="editorTextarea"
          value={note}
          placeholder={`Write ${dayType}'s markdown note.`}
          onChange={event => handleNoteChange(event.target.value)}
        />
      </div>
      <div className="editorActions">
        {isDirty && saveStatus !== 'saving' && <span className="editorStatus">Unsaved changes.</span>}
        {saveStatus === 'saving' && <span className="editorStatus">Saving...</span>}
        {saveStatus === 'saved' && <span className="editorStatus editorStatusSuccess">Saved.</span>}
        {saveError && <span className="editorStatus editorStatusError">{saveError}</span>}
      </div>
    </section>
  </div>
}
