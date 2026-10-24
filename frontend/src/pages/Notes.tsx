import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import ErrorState from '../components/ErrorState'
import { api, type NoteSummary } from '../data/api'
import { getNoteLengthShade } from '../data/noteSettings'
import { RequireReauth, useSecurity } from '../security'
import { formatDateKey, pad2 } from '../utils/functions'
import { ToggleSwitch } from '../utils/simplifyReact'
import { months, weekdays } from '../data/data'

type ParsedDate = {
  year: number
  month: number
  day: number
}

type CalendarCell = {
  date: string
  dayNumber: number
  hasNote: boolean
  isActive: boolean
  marked: boolean
  shade: number
}

type CalendarMonth = {
  key: string
  label: string
  days: Array<CalendarCell | null>
}

const parseDateKey = (key: string): ParsedDate | null => {
  const parts = key.split('-')
  if (parts.length !== 3) return null
  const [yearPart, monthPart, dayPart] = parts
  if (yearPart.length !== 2 && yearPart.length !== 4) return null
  const yearNumber = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  if (!Number.isFinite(yearNumber) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const fullYear = yearPart.length === 4 ? yearNumber : 2000 + yearNumber
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year: fullYear, month, day }
}

const normalizeDateKey = (key: string) => {
  const parsed = parseDateKey(key)
  if (!parsed) return null
  return formatDateKey(parsed.year, parsed.month, parsed.day)
}

// Square root: spreads short and long notes apart, while one very long note does not wash out all the others.
const noteShade = (length: number, maxLength: number) => maxLength > 0 ? Math.sqrt(length / maxLength) : 0

const buildCalendarMonth = (year: number, month: number, notesByDate: Map<string, NoteSummary>, maxLength: number): CalendarMonth => {
  const firstDayIndex = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const days: Array<CalendarCell | null> = []
  for (let i = 0; i < firstDayIndex; i += 1) { days.push(null) }
  for (let day = 1; day <= new Date(year, month, 0).getDate(); day += 1) {
    const dateKey = formatDateKey(year, month, day)
    const entry = notesByDate.get(dateKey)
    days.push({
      date: dateKey,
      dayNumber: day,
      hasNote: entry?.hasNote ?? false,
      isActive: Boolean(entry),
      marked: entry?.marked ?? false,
      shade: noteShade(entry?.length ?? 0, maxLength),
    })
  }
  while (days.length % 7 !== 0) days.push(null)
  // Newest week on top, while the weekday columns keep their order.
  const weeks: Array<Array<CalendarCell | null>> = []
  for (let i = 0; i < days.length; i += 7) weeks.unshift(days.slice(i, i + 7))
  return { key: `${year}-${pad2(month)}`, label: `${months.long[month - 1]} ${year}`, days: weeks.flat() }
}

// Outside the component so it survives opening a note; used once on the way back, so the navbar still opens at the top.
let savedScrollY = 0

export default function Notes() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [confirmingMarks, setConfirmingMarks] = useState(false)
  const { hasPin, marksVisible, setMarksVisible } = useSecurity()
  const shadeByLength = getNoteLengthShade()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    api.notes.list()
      .then(result => { if (!cancelled) setNotes(result) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken])

  useLayoutEffect(() => {
    if (isLoading) return
    window.scrollTo(0, savedScrollY)
    savedScrollY = 0
  }, [isLoading])

  const calendarMonths = useMemo(() => {
    const notesByDate = new Map<string, NoteSummary>()
    const monthMap = new Map<string, { year: number; month: number }>()
    const maxLength = notes.reduce((longest, entry) => Math.max(longest, entry.length), 0)

    for (const entry of notes) {
      const normalized = normalizeDateKey(entry.date)
      if (!normalized) continue
      notesByDate.set(normalized, { ...entry, date: normalized })
      const parsed = parseDateKey(normalized)
      if (!parsed) continue
      const key = `${parsed.year}-${pad2(parsed.month)}`
      if (!monthMap.has(key)) monthMap.set(key, { year: parsed.year, month: parsed.month })
    }
    return Array.from(monthMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year
        return b.month - a.month
      })
      .map(({ year, month }) => buildCalendarMonth(year, month, notesByDate, maxLength))
  }, [notes])

  const handleMarksToggle = () => {
    if (marksVisible || !hasPin) setMarksVisible(!marksVisible)
    else setConfirmingMarks(true)
  }

  const dayClassName = (cell: CalendarCell) => [
    'calendarDay',
    cell.hasNote ? 'calendarDayHasNote' : 'calendarDayEmptyNote',
    shadeByLength && cell.hasNote ? 'calendarDayShaded' : null,
    marksVisible && cell.marked ? 'calendarDayMarked' : null
  ].filter(Boolean).join(' ')

  if (isLoading) return <div className="state">Loading...</div>
  if (error) return <ErrorState error={error} onReload={() => setReloadToken(token => token + 1)} />

  return <div className="page">
    <header className="pageHeader"><h1>Notes</h1></header>
    <section className="panelCard panelStack">
      {calendarMonths.length > 0 && <div className="panelRow">
        <span>Show marks</span>
        <span className="panelRowValue panelRowValueToggle">
          <ToggleSwitch ariaLabel="Toggle note marks" checked={marksVisible} onChange={handleMarksToggle} disabled={confirmingMarks} />
        </span>
      </div>}
      {calendarMonths.length === 0
        ? <div className="panelEmpty">No notes yet.</div>
        : calendarMonths.map(month => (
          <div className="calendarMonth" key={month.key}>
            <div className="calendarHeader">
              <h2 className="panelTitle">{month.label}</h2>
            </div>
            <div className="calendarWeekdays">
              {weekdays.short.map(label => (<span className="calendarWeekday" key={label}>{label}</span>))}
            </div>
            <div className="calendarGrid">
              {month.days.map((cell, index) => {
                if (!cell) return <div className="calendarDay calendarDayBlank" key={`blank-${month.key}-${index}`} />
                if (!cell.isActive) return <div className="calendarDay calendarDayInactive" key={cell.date}>
                  {cell.dayNumber}
                </div>
                return <Link
                  className={dayClassName(cell)}
                  style={shadeByLength && cell.hasNote ? { '--note-shade': cell.shade.toFixed(2) } as CSSProperties : undefined}
                  key={cell.date}
                  to={`/notes/${cell.date}`}
                  onClick={() => { savedScrollY = window.scrollY }}
                >
                  {cell.dayNumber}
                </Link>
              })}
            </div>
          </div>
        ))
      }
    </section>
    {confirmingMarks && <RequireReauth
      title="Show marks"
      message="Confirm your PIN or fingerprint to show note marks."
      onVerified={() => {
        setMarksVisible(true)
        setConfirmingMarks(false)
      }}
      ignoreReauthSettings
      presentation="modal"
      onCancel={() => setConfirmingMarks(false)}
    >
      {null}
    </RequireReauth>}
  </div>
}
