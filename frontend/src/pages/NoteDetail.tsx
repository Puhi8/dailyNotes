import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ErrorState from '../components/ErrorState'
import NoteMarkdown from '../components/NoteMarkdown'
import { api, type NoteEntry } from '../data/api'
import { getNoteSwipe } from '../data/noteSettings'
import { useSecurityReauthSettings } from '../data/securitySettings'
import { useSecurity } from '../security'
import { ToggleSwitch } from '../utils/simplifyReact'

// A page without a note is a neighbor that still needs its own unlock, so only its date is shown.
type SwipePage = { date: string; note: NoteEntry | null }
type SwipeGesture = { x: number; y: number; time: number; axis: 'x' | 'y' | null }

const SWIPE_MS = 100
const SWIPE_AXIS_LOCK_PX = 8

const noteBody = (entry: NoteEntry) => entry.note.trim()
  ? <NoteMarkdown text={entry.note} />
  : <div className="noteEmpty">No note text.</div>

export default function NoteDetail() {
  const { date } = useParams()
  const navigate = useNavigate()
  const { hasPin, marksVisible } = useSecurity()
  const { internal: requireNoteUnlock } = useSecurityReauthSettings()
  const swipeEnabled = getNoteSwipe()
  const [note, setNote] = useState<NoteEntry | null>(null)
  const [pages, setPages] = useState<SwipePage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markError, setMarkError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const swiperRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const switchTimerRef = useRef<number | null>(null)
  const neighborsLocked = hasPin && requireNoteUnlock
  const currentIndex = pages.findIndex(page => page.date === note?.date)
  const canSwipe = swipeEnabled && pages.length > 1

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    Promise.all([api.notes.get(date), api.notes.list()])
      .then(async ([result, notes]) => {
        // Day keys are zero padded, so string order is date order; the list is newest first.
        const withText = notes.filter(entry => entry.hasNote)
        const older = withText.find(entry => entry.date < result.date)?.date
        const newer = withText.filter(entry => entry.date > result.date).at(-1)?.date
        const readPage = async (pageDate?: string) => pageDate
          ? { date: pageDate, note: neighborsLocked ? null : await api.notes.get(pageDate) }
          : null
        const [olderPage, newerPage] = swipeEnabled ? await Promise.all([readPage(older), readPage(newer)]) : [null, null]
        if (cancelled) return
        setNote(result)
        // Newer notes sit on the left, like the newest-first calendar.
        setPages([newerPage, { date: result.date, note: result }, olderPage].filter(page => page != null))
        setMarkError(null)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [date, reloadToken, neighborsLocked, swipeEnabled])

  useEffect(() => () => { if (switchTimerRef.current != null) window.clearTimeout(switchTimerRef.current) }, [])

  // Moved by hand instead of re-rendering, so a drag stays smooth; the box always takes the shown page's height.
  const showPage = useCallback((index: number, dragX = 0, animate = false) => {
    const swiper = swiperRef.current
    const track = trackRef.current
    const page = track?.children[index] as HTMLElement | undefined
    if (!swiper || !track || !page) return
    const transition = animate ? `${SWIPE_MS}ms ease-out` : '0s'
    track.style.transition = `transform ${transition}`
    track.style.transform = `translateX(calc(${-index * 100}% + ${dragX}px))`
    swiper.style.transition = `height ${transition}`
    swiper.style.height = `${page.offsetHeight}px`
  }, [])

  // Every new note starts at its top, resting on its own page, and follows its own height (rotating the phone changes it).
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
    switchTimerRef.current = null
    showPage(currentIndex)
    const page = trackRef.current?.children[currentIndex]
    if (!page || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => showPage(currentIndex))
    observer.observe(page)
    return () => observer.disconnect()
  }, [currentIndex, pages, showPage])

  // Listens on the whole window, so a swipe also works on the empty space below the note.
  useEffect(() => {
    if (!canSwipe) return
    let gesture: SwipeGesture | null = null
    const neighborIndex = (deltaX: number) => currentIndex + (deltaX < 0 ? 1 : -1)

    const handleStart = (event: TouchEvent) => {
      const startedInContent = (event.target as Element | null)?.closest?.('.appContent')
      const touch = event.touches[0]
      gesture = event.touches.length === 1 && startedInContent && switchTimerRef.current == null
        ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp, axis: null }
        : null
    }
    const handleMove = (event: TouchEvent) => {
      if (!gesture) return
      const deltaX = event.touches[0].clientX - gesture.x
      const deltaY = event.touches[0].clientY - gesture.y
      if (!gesture.axis && Math.hypot(deltaX, deltaY) > SWIPE_AXIS_LOCK_PX) gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      // Past the first or last note the page only gives a little, so it is clear there is nothing more.
      if (gesture.axis === 'x') showPage(currentIndex, pages[neighborIndex(deltaX)] ? deltaX : deltaX / 4)
    }
    const handleEnd = (event: TouchEvent) => {
      if (gesture?.axis !== 'x') {
        gesture = null
        return
      }
      const deltaX = event.changedTouches[0].clientX - gesture.x
      const speed = Math.abs(deltaX) / Math.max(1, event.timeStamp - gesture.time)
      gesture = null
      const targetIndex = neighborIndex(deltaX)
      const width = swiperRef.current?.clientWidth ?? window.innerWidth
      const isFlick = Math.abs(deltaX) > 30 && speed > 0.4
      const target = (Math.abs(deltaX) > width / 4 || isFlick) ? pages[targetIndex] : undefined
      showPage(target ? targetIndex : currentIndex, 0, true)
      if (!target) return
      // Only once the slide has fully ended, so swapping in the new note is invisible.
      // Replace, so going back from any page of the "book" returns to the calendar.
      switchTimerRef.current = window.setTimeout(() => navigate(`/notes/${target.date}`, { replace: true }), SWIPE_MS + 50)
    }
    const handleCancel = () => {
      if (gesture?.axis === 'x') showPage(currentIndex, 0, true)
      gesture = null
    }

    const listeners = [['touchstart', handleStart], ['touchmove', handleMove], ['touchend', handleEnd], ['touchcancel', handleCancel]] as const
    listeners.forEach(([name, listener]) => window.addEventListener(name, listener, { passive: true }))
    return () => listeners.forEach(([name, listener]) => window.removeEventListener(name, listener))
  }, [canSwipe, currentIndex, navigate, pages, showPage])

  const handleMarkToggle = async () => {
    if (!note) return
    try {
      const marked = await api.notes.setMarked(note.date, !note.marked)
      setNote({ ...note, marked })
      setMarkError(null)
    }
    catch (err) { setMarkError(err instanceof Error ? err.message : 'Failed to save mark.') }
  }

  if (!date) return <div className="state">
    <div className="stateCard">
      <h2>Missing note date</h2>
      <p>Select a day from the calendar.</p>
      <Link className="stateButton stateButtonSecondary" to="/notes">
        Back to calendar
      </Link>
    </div>
  </div>

  // A swipe keeps showing the old note until the next one is read, so the strip never flashes.
  if (isLoading && !note) return <div className="state">Loading...</div>
  if (error) return <ErrorState error={error} onReload={() => setReloadToken(token => token + 1)} />
  if (!note) return <div className="state">No note</div>

  return <div className="page">
    <header className="pageHeader">
      <h1>Note</h1>
      <p>{note.date}</p>
    </header>
    <section className="panelCard panelStack">
      {marksVisible && <div className="panelRow">
        <span>Marked</span>
        <span className="panelRowValue panelRowValueToggle">
          <ToggleSwitch ariaLabel="Toggle note mark" checked={note.marked} onChange={() => { void handleMarkToggle() }} />
        </span>
      </div>}
      {markError && <div className="stateMeta stateMetaError">{markError}</div>}
      {canSwipe
        ? <div className="noteSwiper" ref={swiperRef}>
          <div className="noteSwipeTrack" ref={trackRef}>
            {pages.map(page => <div className="noteSwipePage" key={page.date}>
              {page.note ? noteBody(page.note) : <div className="noteEmpty">{page.date} needs an unlock.</div>}
            </div>)}
          </div>
        </div>
        : noteBody(note)
      }
      <div className="noteActions">
        <Link className="stateButton stateButtonSecondary" to="/notes">Back to calendar</Link>
      </div>
    </section>
  </div>
}
