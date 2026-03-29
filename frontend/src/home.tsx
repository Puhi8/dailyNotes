import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { IndividualStatData, ServerData } from './data/types'
import ErrorState from './components/ErrorState'
import { api } from './data/api'
import HomeGraphs from './components/HomeGraphs'

export default function Home() {
  const [data, setData] = useState<ServerData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

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
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Request failed')
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadToken])

  if (isLoading) return <div className="state">Loading...</div>
  if (error) return <ErrorState error={error} onReload={() => setReloadToken(token => token + 1)} />
  if (!data) return <div className="state">No activity history yet.</div>
  return (
    <div className="home">
      {/* if mobile: show the focus options */}
      <div className="topWidgetFocus">
        <button onClick={() => document.getElementById('widgetYesterday')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>Yesterday</button>
        <button onClick={() => document.getElementById('widget7')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>7</button>
        <button onClick={() => document.getElementById('widget30')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' })}>30</button>
      </div>
      <div className="topWidgets">
        {DisplayYesterday(data.yesterday)}
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

function DisplayStats({ dayCount, stats }: { dayCount: number, stats: IndividualStatData[] }) {
  return <div className='statsWidget' id={`widget${dayCount}`}>
    <h3>{dayCount} days</h3>
    {stats.map(statData => (<p key={statData.text}>{statData.text}: {statData.value}</p>))}
  </div>
}

function DisplayYesterday(data: IndividualStatData[]) {
  return <div className='statsWidget' id='widgetYesterday'>
    <h3>Yesterday</h3>
    {data.map(item => (<p key={item.text}>{item.text}: {typeof item.value == "boolean" ? item.value ? "Done" : "Felid" : item.value}</p>))}
  </div>
}
