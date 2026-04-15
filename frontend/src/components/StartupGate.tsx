import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import MarkdownEditor from './MarkdownEditor'
import { useAuth } from '../auth'
import { api } from '../data/api'
import { getNoteTemplate, loadNoteTemplateFromApi, saveNoteTemplateToApi } from '../data/noteSettings'
import { useSecurity } from '../security'
import { useObjectState } from '../utils/functions'
import { HARDWARE_BACK_PRIORITY, registerHardwareBackHandler } from '../utils/hardwareBack'
import { manageLocalStorage } from '../utils/localProcessing'
import { Button, LockInput } from '../utils/simplifyReact'

const STARTUP_COMPLETE_KEY = 'dailynotes.startupComplete'

const isStartupComplete = () => (manageLocalStorage.get(STARTUP_COMPLETE_KEY, null) === "1")
const markStartupComplete = () => { manageLocalStorage.set({ key: STARTUP_COMPLETE_KEY, value: "1" }) }

type startupStep = 'pin' | 'biometric' | 'server' | 'credentials' | 'template'

const StartupStepCard = ({ children }: { children: ReactNode }) => (<div className="state startupScreen">
  <div className="stateCard">
    {children}
  </div>
</div>)

export default function StartupGate({ children }: { children: ReactNode }) {
  const { login } = useAuth()
  const { hasDevicePin, biometricAvailable, biometricEnabled, setBiometricEnabled, setDevicePin } = useSecurity()
  const isNative = Capacitor.isNativePlatform()
  const [isComplete, setIsComplete] = useState(!isNative || (isStartupComplete() && hasDevicePin))
  const [step, setStep] = useState<startupStep>(hasDevicePin ? 'biometric' : 'pin')
  const [pin, setPin, resetPinData] = useObjectState<{ draft: string; confirm: string; error: string | null }>({
    draft: "", confirm: "", error: null
  })
  const [template, setTemplate] = useObjectState<{ draft: string; status: string; error: string | null }>({
    draft: "", status: "", error: null
  })
  const [credentials, setCredentials, resetCredentials] = useObjectState<{ password: string; status: string; error: string | null }>({
    password: "", status: "idle", error: null
  })
  const [server, setServer] = useObjectState<{ draft: string; error: string | null }>({ draft: api.config.baseUrl.get(), error: null })
  const [shouldShowCredentialsStep, setShouldShowCredentialsStep] = useState(true)
  const templateTouchedRef = useRef(false)

  useEffect(() => {
    if (isComplete) return
    if (step === 'biometric' && biometricEnabled) setStep('server')
  }, [biometricEnabled, isComplete, step])

  useEffect(() => {
    if (step !== 'template') return
    let active = true
    templateTouchedRef.current = false
    setTemplate({ draft: getNoteTemplate(), status: "loading", error: null })
    loadNoteTemplateFromApi()
      .then(serverTemplate => {
        if (!active) return
        if (!templateTouchedRef.current) setTemplate({ draft: serverTemplate })
        setTemplate({ status: 'idle' })
      })
      .catch(err => { if (active) setTemplate({ status: 'idle', error: err instanceof Error ? err.message : 'Failed to load note template.' }) })
    return () => { active = false }
  }, [setTemplate, step])

  const handlePinSubmit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = pin.draft.trim()
    if (!/^\d+$/.test(normalized)) {
      setPin({ error: 'PIN should contain only numbers.' })
      return
    }
    if (normalized !== pin.confirm.trim()) {
      setPin({ error: 'PINs do not match.' })
      return
    }
    setDevicePin(normalized)
    resetPinData()
    setStep('biometric')
  }

  const handleBiometric = (enableBiometric: boolean) => {
    setBiometricEnabled(enableBiometric)
    setStep('server')
  }

  const handleServerSubmit = (event: FormEvent) => {
    event.preventDefault()
    const saved = api.config.baseUrl.set(server.draft)
    setServer({ draft: saved, error: null })
    setShouldShowCredentialsStep(true)
    resetCredentials()
    setStep('credentials')
  }

  const handleSkipServer = () => {
    setServer({ error: null })
    setShouldShowCredentialsStep(false)
    resetCredentials()
    setStep('template')
  }

  const handleCredentialsSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const password = credentials.password.trim()
    if (!password) {
      setCredentials({ error: 'Enter server password.' })
      return
    }
    setCredentials({ status: "signing", error: null })
    try {
      await login(password)
      setCredentials({ status: "syncing", error: null })
      const preview = await api.backup.previewPull()
      const conflictChoices = preview.conflicts.reduce<Record<string, 'remote'>>((acc, conflict) => {
        acc[conflict.date] = 'remote'
        return acc
      }, {})
      await api.backup.applyPull(preview.remoteSnapshot, conflictChoices)
      resetCredentials()
      setStep('template')
    }
    catch (err) { setCredentials({ status: "idle", error: err instanceof Error ? err.message : 'Failed to sign in and pull from server.' }) }
  }

  const handleSkipCredentials = () => {
    setCredentials({ status: "idle", error: null })
    setStep('template')
  }

  const handleTemplateSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTemplate({ error: null, status: "saving" })
    try {
      await saveNoteTemplateToApi(template.draft)
      markStartupComplete()
      setIsComplete(true)
    }
    catch (err) { setTemplate({ error: err instanceof Error ? err.message : 'Failed to save note template.', status: "idle" }) }
  }

  const handleBack = useCallback(() => {
    switch (step) {
      case "template":
        setStep(shouldShowCredentialsStep ? "credentials" : "server")
        return
      case "credentials":
        setStep("server")
        return
      case "server":
        setStep("biometric")
        return
      case "biometric":
        setStep("pin")
        return
      default:
        window.history.back()
        return
    }
  }, [shouldShowCredentialsStep, step])

  useEffect(() => {
    if (!isComplete) return registerHardwareBackHandler(
      HARDWARE_BACK_PRIORITY.NAVIGATION,
      (_, processNextHandler) => {
        if (step === 'pin') {
          processNextHandler()
          return
        }
        handleBack()
      },
      step === 'pin' ? 'delegated startup back to root flow' : 'navigated back in startup flow',
    )
  }, [handleBack, isComplete, step])

  if (!isNative || isComplete) return <>{children}</>
  switch (step) {
    case "pin":
      return <StartupStepCard>
        <h2>Welcome</h2>
        <p>Create a PIN for this device.</p>
        <form className="lockForm" onSubmit={handlePinSubmit}>
          <LockInput.newPin
            placeholder="New PIN"
            value={pin.draft}
            onChange={event => { setPin({ draft: event.target.value, error: null }) }}
          />
          <LockInput.newPin
            placeholder="Confirm PIN"
            value={pin.confirm}
            onChange={event => { setPin({ confirm: event.target.value, error: null }) }}
          />
          <div className="lockActions">
            <Button.primary type="submit">Set PIN</Button.primary>
            <Button.secondary onClick={handleBack}>Back</Button.secondary>
          </div>
        </form>
        {pin.error && <div className="stateMeta stateMetaError">{pin.error}</div>}
      </StartupStepCard>
    case "biometric":
      return <StartupStepCard>
        <h2>Biometric</h2>
        {biometricAvailable
          ? <p>Turn on fingerprint unlock for faster access.</p>
          : <p>Biometric unlock is not available on this device.</p>
        }
        <div className="lockActions">
          {biometricAvailable && <Button.primary onClick={() => handleBiometric(true)}>Enable</Button.primary>}
          <Button.secondary onClick={handleBack}>Back</Button.secondary>
          <Button.secondary onClick={() => handleBiometric(false)}>{biometricAvailable ? 'Skip' : 'Continue'}</Button.secondary>
        </div>
      </StartupStepCard>
    case "server":
      return <StartupStepCard>
        <h2>Server</h2>
        <p>Optional backup server address for this device.</p>
        <p className="panelHint">Use only host URL. Do not include username/password in the URL.</p>
        <form className="lockForm" onSubmit={handleServerSubmit}>
          <LockInput.text
            value={server.draft}
            placeholder="https://backup.example.com"
            onChange={event => setServer({ draft: event.target.value, error: null })}
            autoComplete="off"
          />
          <div className="lockActions">
            <Button.primary type="submit">Continue</Button.primary>
            <Button.secondary onClick={handleBack}>Back</Button.secondary>
            <Button.secondary onClick={handleSkipServer}>Skip</Button.secondary>
          </div>
        </form>
        {server.error && <div className="stateMeta stateMetaError">{server.error}</div>}
      </StartupStepCard>
    case "credentials":
      return <StartupStepCard>
        <h2>Server login</h2>
        <p>Sign in now so startup can pull your synced note template and data.</p>
        <form className="lockForm" onSubmit={handleCredentialsSubmit}>
          <LockInput.password
            value={credentials.password}
            placeholder="Server password"
            onChange={event => setCredentials({ password: event.target.value, error: null })}
            autoComplete="current-password"
            autoFocus
          />
          <div className="lockActions">
            <Button.primary
              type="submit"
              disabled={credentials.status === 'signing' || credentials.status === 'syncing'}
            >
              {credentials.status === 'syncing' ? 'Pulling...' : credentials.status === 'signing' ? 'Signing in...' : 'Sign in & pull'}
            </Button.primary>
            <Button.secondary onClick={handleSkipCredentials}>Continue without pull</Button.secondary>
            <Button.secondary onClick={handleBack}>Back</Button.secondary>
          </div>
        </form>
        {credentials.error && <div className="stateMeta stateMetaError">{credentials.error}</div>}
      </StartupStepCard>
    default:
      return <StartupStepCard>
        <h2>Default note</h2>
        <p>Loaded on device, then you can edit it.</p>
        <form className="lockForm" onSubmit={handleTemplateSubmit}>
          <MarkdownEditor
            className="noteMarkdownEditor"
            value={template.draft}
            placeholder="## Highlights"
            onChange={value => {
              templateTouchedRef.current = true
              setTemplate({ draft: value })
            }}
          />
          <div className="lockActions">
            <Button.primary
              type="submit"
              disabled={template.status === 'saving' || template.status === 'loading'}
            >
              {template.status === 'saving' ? 'Saving...' : 'Save and finish'}
            </Button.primary>
            <Button.secondary onClick={handleBack}>Back</Button.secondary>
          </div>
        </form>
        {template.status === 'loading' && <div className="stateMeta">Loading template...</div>}
        {template.error && <div className="stateMeta stateMetaError">{template.error}</div>}
      </StartupStepCard>
  }
}
