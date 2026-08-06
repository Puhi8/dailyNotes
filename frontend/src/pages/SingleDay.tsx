import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import ErrorState from '../components/ErrorState'
import MarkdownEditor from '../components/MarkdownEditor'
import { api, type DayData } from '../data/api'
import { dayKey, normalizeDayKey, openDayEdit, parseDayKey } from '../data/localCore'
import { applyNoteTemplate, resolveNoteTemplate } from '../data/noteSettings'
import type { StatusOptions } from '../data/types'
import { useObjectState } from '../utils/functions'
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

type fetchedData<T> = {
  main: T
  original: T
}

type errorState = {
  load: string | null
  save: string | null
}

const AUTOSAVE_DEBOUNCE_MS = 700
export default function SingleDay() {
  // Pinned by the URL, never read from the clock, so a session running past midnight stays on one day.
  const date = normalizeDayKey(useParams().date ?? '')
  const [data, setData] = useObjectState<fetchedData<DayData>>({ main: {}, original: {} })
  const [note, setNote] = useObjectState<fetchedData<string>>({ main: "", original: "" })
  const [isLoading, setIsLoading] = useState(true)
  const [errors, setErrors] = useObjectState<errorState>({ load: null, save: null })
  const [saveStatus, setSaveStatus] = useState<StatusOptions>('idle')
  const [accomplishmentOrder, setAccomplishmentOrder] = useState<string[]>([])
  const dataRef = useRef<DayData>(data.main)
  const noteRef = useRef(note.main)
  const originalDataRef = useRef<DayData>(data.original)
  const originalNoteRef = useRef(note.original)
  const saveTimerRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const queuedSaveRef = useRef(false)

  useEffect(() => {
    const rejection = !parseDayKey(date) ? `Invalid date: ${date}`
      : !dayKey.isEditable(date) ? `${date} is closed for editing.`
        : null
    if (rejection) {
      setErrors({ load: rejection })
      setIsLoading(false)
      return
    }
    const closeEditSession = openDayEdit(date)
    let cancelled = false
    setIsLoading(true)
    setErrors({ load: null })
    Promise.all([api.day.getIndividual(date), api.accomplishments.list(), resolveNoteTemplate()])
      .then(([result, accomplishments, template]) => {
        if (cancelled) return
        const displayNote = applyNoteTemplate(result.note || '', String(template)).note
        setData({ main: { ...result.data }, original: { ...result.data } })
        setNote({ main: displayNote, original: displayNote })
        setAccomplishmentOrder(accomplishments.map(item => item.name.trim().toLowerCase()).filter(Boolean))
      })
      .catch(err => {
        if (cancelled) return
        setErrors({ load: err instanceof Error ? err.message : 'Request failed' })
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => {
      cancelled = true
      closeEditSession()
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [date])

  useEffect(() => { dataRef.current = data.main }, [data.main])
  useEffect(() => { noteRef.current = note.main }, [note.main])
  useEffect(() => { originalDataRef.current = data.original }, [data.original])
  useEffect(() => { originalNoteRef.current = note.original }, [note.original])

  const entries = useMemo(() => {
    const orderMap = new Map(accomplishmentOrder.map((name, index) => [name, index]))
    return Object.entries(data.main).sort(([left], [right]) => {
      const leftOrder = orderMap.get(left.trim().toLowerCase())
      const rightOrder = orderMap.get(right.trim().toLowerCase())
      if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder
      if (leftOrder != null) return -1
      if (rightOrder != null) return 1
      return left.localeCompare(right)
    })
  }, [accomplishmentOrder, data.main])
  const isDirty = !isSameData(data.main, data.original) || note.main !== note.original

  const updateValue = (key: string, value: DayData[string]) => {
    setData(prev => ({ main: { ...prev.main, [key]: value } }))
    setSaveStatus('idle')
  }

  const handleNoteChange = (value: string) => {
    setNote({ main: value })
    setSaveStatus('idle')
  }

  const handleSave = useCallback(async () => {
    if (saveInFlightRef.current) {
      queuedSaveRef.current = true
      return
    }
    if (isSameData(originalDataRef.current, dataRef.current) && noteRef.current === originalNoteRef.current) return

    saveInFlightRef.current = true
    setErrors({ save: null })
    setSaveStatus('saving')
    const dataToSave = dataRef.current
    const noteToSave = noteRef.current
    try {
      await saveIndividualDay(date, { data: dataToSave, note: noteToSave })
      setData({ original: dataToSave })
      setNote({ original: noteToSave })
      setSaveStatus('saved')
    }
    catch (err) {
      setErrors({ save: err instanceof Error ? err.message : 'Save failed' })
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
  }, [date])

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
  }, [data.main, handleSave, isDirty, note.main])

  if (errors.load) return <ErrorState error={errors.load} onReload={() => window.location.reload()} />
  if (isLoading) return <div className="state">Loading {date}...</div>

  return <div className="page">
    <header className="pageHeader"><h1>{date}</h1></header>
    <section className="panelCard panelStack">
      <div className="panelSection">
        <h2 className="panelTitle">Checklist</h2>
        {entries.length === 0
          ? <div className="panelEmpty">No entries for {date}.</div>
          : <div className="editorList"> {
            entries.map(([key, value]) => (
              <div className="editorRow" key={key}>
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
            ))}
          </div>
        }
      </div>
      <div className="panelSection noteInputSection">
        <h2 className="panelTitle">Note (.md)</h2>
        <MarkdownEditor
          className="noteMarkdownEditor"
          value={note.main}
          placeholder={`Write the markdown note for ${date}.`}
          onChange={handleNoteChange}
        />
      </div>
      <div className="editorActions">
        {isDirty && saveStatus !== 'saving' && <span className="editorStatus">Unsaved changes.</span>}
        {saveStatus === 'saving' && <span className="editorStatus">Saving...</span>}
        {saveStatus === 'saved' && <span className="editorStatus editorStatusSuccess">Saved.</span>}
        {errors.save && <span className="editorStatus editorStatusError">{errors.save}</span>}
      </div>
    </section>
  </div>
}
