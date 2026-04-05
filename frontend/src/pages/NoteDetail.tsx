import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ErrorState from '../components/ErrorState'
import NoteMarkdown from '../components/NoteMarkdown'
import { api, type NoteEntry } from '../data/api'

export default function NoteDetail() {
  const { date } = useParams()
  const [note, setNote] = useState<NoteEntry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    api.notes.get(date)
      .then(result => { if (!cancelled) setNote(result) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [date, reloadToken])

  if (!date) return <div className="state">
    <div className="stateCard">
      <h2>Missing note date</h2>
      <p>Select a day from the calendar.</p>
      <Link className="stateButton stateButtonSecondary" to="/notes">
        Back to calendar
      </Link>
    </div>
  </div>

  if (isLoading) return <div className="state">Loading...</div>
  if (error) return <ErrorState error={error} onReload={() => setReloadToken(token => token + 1)} />
  if (!note) return <div className="state">No note</div>

  return <div className="page">
    <header className="pageHeader">
      <h1>Note</h1>
      <p>{note.date}</p>
    </header>
    <section className="panelCard panelStack">
      {note.note
        ? <NoteMarkdown text={note.note} />
        : <div className="noteEmpty">No note text.</div>
      }
      <div className="noteActions">
        <Link className="stateButton stateButtonSecondary" to="/notes">Back to calendar</Link>
      </div>
    </section>
  </div>
}
