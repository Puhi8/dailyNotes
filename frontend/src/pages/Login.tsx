import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../data/api'

export default function Login() {
  const { login, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [remoteSessionConnected, setRemoteSessionConnected] = useState(() => api.auth.session.hasSession())
  const [apiBaseUrl, setApiBaseUrl] = useState(() => api.config.baseUrl.get())
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const from = (location.state as { from?: string } | null)?.from || '/'
  const backTarget = from === '/login' ? '/' : from

  useEffect(() => {
    setApiBaseUrl(api.config.baseUrl.get())
    const sync = () => setRemoteSessionConnected(api.auth.session.hasSession())
    sync()
    return api.auth.subscribe(sync)
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!password) {
      setError('Enter your server password.')
      return
    }
    setIsSubmitting(true)
    try {
      await login(password)
      navigate(from, { replace: true })
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed.') }
    finally { setIsSubmitting(false) }
  }

  return <div className="state">
    <div className="stateCard">
      <h2>Remote Backup Login</h2>
      <p>Optional. Connect your server account to enable cloud backup sync.</p>
      <p className="panelHint">Server: <code>{apiBaseUrl}</code></p>
      <p>First-time setup: use the password from your server <code>password</code> file.</p>
      {remoteSessionConnected && <div className="stateMeta">Connected. Sign out to disconnect remote backup.</div>}
      <form className="lockForm" onSubmit={handleSubmit}>
        <input
          className="lockInput"
          type="password"
          placeholder="Server password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        <div className="lockActions">
          <button className="stateButton" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
          <button
            className="stateButton stateButtonSecondary"
            type="button"
            onClick={() => navigate(backTarget, { replace: true })}
          >
            Go back
          </button>
        </div>
      </form>
      {error && <div className="stateMeta stateMetaError">{error}</div>}
      {remoteSessionConnected && (
        <div className="lockActions">
          <button
            className="stateButton stateButtonSecondary"
            type="button"
            onClick={() => { logout(); setError(null) }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  </div>
}
