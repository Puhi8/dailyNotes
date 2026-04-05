import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { IndividualStatData, ServerData } from './data/types'
import ErrorState from './components/ErrorState'
import { api } from './data/api'
import HomeGraphs from './components/HomeGraphs'

const YESTERDAY_STACK_HEIGHT = 228
const MOBILE_WIDGET_FOCUS_MAX_WIDTH = 900

export default function Home() {
  const [data, setData] = useState<ServerData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [shouldStackStats, setShouldStackStats] = useState(false)
  const [showWidgetFocus, setShowWidgetFocus] = useState(false)
  const topWidgetsRef = useRef<HTMLDivElement | null>(null)
  const yesterdayWidgetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    api.dashboard.get()
      .then(result => {
        if (cancelled) return
        setData(result)
        setError(null)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken])

  useEffect(() => {
    const widget = yesterdayWidgetRef.current
    if (!widget || !data) return
    const updateStacking = () => {
      if (!(data.stats[0] && data.stats[1])) {
        setShouldStackStats(false)
        return
      }
      const height = widget.getBoundingClientRect().height
      setShouldStackStats(height >= YESTERDAY_STACK_HEIGHT)
    }
    updateStacking()
    window.addEventListener('resize', updateStacking)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', updateStacking)
    const observer = new ResizeObserver(() => updateStacking())
    observer.observe(widget)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateStacking)
    }
  }, [data])

  useEffect(() => {
    const container = topWidgetsRef.current
    if (!container || !data) return
    const updateWidgetFocus = () => {
      if (window.innerWidth > MOBILE_WIDGET_FOCUS_MAX_WIDTH) {
        setShowWidgetFocus(false)
        return
      }
      setShowWidgetFocus(container.scrollWidth - container.clientWidth > 1)
    }
    updateWidgetFocus()
    window.addEventListener('resize', updateWidgetFocus)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', updateWidgetFocus)
    const observer = new ResizeObserver(() => updateWidgetFocus())
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateWidgetFocus)
    }
  }, [data, shouldStackStats])

  if (isLoading) return <div className="state">Loading...</div>
  if (error) return <ErrorState error={error} onReload={() => setReloadToken(token => token + 1)} />
  if (!data) return <div className="state">No activity history yet.</div>
  return (
    <div className="home">
      {/* if mobile: show the focus options */}
      {showWidgetFocus && <div className="topWidgetFocus">
        <button onClick={() => document.getElementById('widgetYesterday')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>Yesterday</button>
        <button onClick={() => document.getElementById('widget7')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>7</button>
        <button onClick={() => document.getElementById('widget30')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>30</button>
      </div>}
      <div className={`topWidgets${shouldStackStats ? ' topWidgetsStacked' : ''}`} ref={topWidgetsRef}>
        <div className='statsWidget' id='widgetYesterday' ref={yesterdayWidgetRef}>
          <h3>Yesterday</h3>
          {data.yesterday.map(item => (<p key={item.text}>{item.text}: {typeof item.value == "boolean" ? item.value ? "Done" : "Felid" : item.value}</p>))}
        </div>
        {data.stats[0] ? DisplayStats(data.stats[0]) : null}
        {data.stats[1] ? DisplayStats(data.stats[1]) : null}
      </div>
      <div className="homeActions">
        <Link className="stateButton" to="/today">Finish the day</Link>
      </div>
      <HomeGraphs data={data} />
    </div>
  )
}

const DisplayStats = ({ dayCount, stats }: { dayCount: number, stats: IndividualStatData[] }) => (
  <div className='statsWidget' id={`widget${dayCount}`}>
    <h3>{dayCount} days</h3>
    {stats.map(statData => (<p key={statData.text}>{statData.text}: {statData.value}</p>))}
  </div>
)
