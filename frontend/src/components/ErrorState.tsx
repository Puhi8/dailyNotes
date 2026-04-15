import { api } from '../data/api'
import { Button } from '../utils/simplifyReact'

type ErrorStateProps = {
  error: string
  onReload: () => void
  title?: string
  message?: string
}

export default function ErrorState({
  error,
  onReload,
  title = 'Not able to reach the API',
  message = 'Check that the server is running and reachable, then try again.',
}: ErrorStateProps) {
  return <div className="state state-error">
    <div className="stateCard">
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="stateMeta">API: {api.config.baseUrl.get()}</div>
      <div className="stateMeta">Error: {error}</div>
      <Button.primary onClick={onReload}>Reload</Button.primary>
    </div>
  </div>
}
