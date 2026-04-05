import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { Capacitor } from '@capacitor/core'
import { manageLocalStorage } from './utils/localProcessing'
import { useObjectState } from './utils/functions'

type UnlockScope = 'home' | 'app'

type SecurityContextValue = {
  isUnlocked: boolean
  isHomeUnlocked: boolean
  hasPin: boolean
  hasDevicePin: boolean
  biometricAvailable: boolean
  biometricReady: boolean
  biometricEnabled: boolean
  setBiometricEnabled: (enabled: boolean) => void
  confirmBiometricIdentity: (reason?: string) => Promise<boolean>
  verifyPin: (pin: string) => boolean
  unlockWithPin: (pin: string, scope?: UnlockScope) => boolean
  unlockWithBiometrics: (scope?: UnlockScope) => Promise<boolean>
  setDevicePin: (pin: string) => void
  lock: (scope?: UnlockScope | 'all') => void
}

const SecurityContext = createContext<SecurityContextValue | null>(null)

const DEVICE_PIN_KEY = 'dailynotes.devicePin'
const BIOMETRIC_ENABLED_KEY = 'dailynotes.biometricEnabled'

const writeStoredPin = (pin: string) => {
  if (pin) manageLocalStorage.set({ key: DEVICE_PIN_KEY, value: pin })
  else manageLocalStorage.remove(DEVICE_PIN_KEY)
}

const configuredPin = String(import.meta.env.VITE_SECURE_PIN || '').trim().replace(/^"+|"+$/g, '')

export function SecurityProvider({ children }: { children: ReactNode }) {
  const isNative = Capacitor.isNativePlatform()
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isHomeUnlocked, setIsHomeUnlocked] = useState(false)
  const [biometric, setBiometric] = useObjectState<{ available: boolean; enabled: boolean; ready: boolean }>({
    available: false, enabled: manageLocalStorage.get(BIOMETRIC_ENABLED_KEY, null) === "1", ready: !isNative
  })
  const [devicePin, setDevicePinState] = useState(manageLocalStorage.get(DEVICE_PIN_KEY, "", String))

  const deviceHasPin = devicePin.trim().length > 0
  const effectivePin = deviceHasPin ? devicePin : configuredPin
  const hasPin = effectivePin.length > 0

  useEffect(() => {
    if (!isNative) {
      setBiometric({ available: false, ready: true })
      return
    }
    let active = true
    Promise.resolve()
      .then(async () => Boolean((await NativeBiometric.isAvailable())?.isAvailable))
      .then(available => { if (active) setBiometric({ available: Boolean(available), ready: true }) })
      .catch(() => { if (active) setBiometric({ available: false, ready: true }) })
    return () => { active = false }
  }, [isNative, setBiometric])

  const unlockWithPin = useCallback((pin: string, scope: UnlockScope = 'app') => {
    if (!hasPin || pin !== effectivePin) return false
    if (scope === 'home') setIsHomeUnlocked(true)
    else setIsUnlocked(true)
    return true
  }, [effectivePin, hasPin])

  const verifyPin = useCallback((pin: string) => (hasPin && pin === effectivePin), [effectivePin, hasPin])

  const confirmBiometricIdentity = useCallback(async (reason = 'Confirm biometric change') => {
    try {
      if (!Capacitor.isNativePlatform()) return false
      const availability = await NativeBiometric.isAvailable()
      if (!availability?.isAvailable) return false
      await NativeBiometric.verifyIdentity({ reason })
      return true
    }
    catch { return false }
  }, [])

  const unlockWithBiometrics = useCallback(async (scope: UnlockScope = 'app') => {
    if (!biometric.enabled) return false
    const success = await confirmBiometricIdentity('Unlock protected area')
    if (!success) return false
    if (scope === 'home') setIsHomeUnlocked(true)
    else setIsUnlocked(true)
    return true
  }, [biometric.enabled, confirmBiometricIdentity])

  const setDevicePin = useCallback((pin: string) => {
    const normalized = pin.trim()
    writeStoredPin(normalized)
    setDevicePinState(normalized)
    if (normalized) {
      setIsUnlocked(true)
      setIsHomeUnlocked(true)
    }
  }, [])

  const setBiometricEnabled = useCallback((enabled: boolean) => {
    manageLocalStorage.set({ key: BIOMETRIC_ENABLED_KEY, value: enabled ? '1' : '0' })
    setBiometric({ enabled })
  }, [setBiometric])

  const lock = useCallback((scope: UnlockScope | 'all' = 'all') => {
    if (scope === 'home') {
      setIsHomeUnlocked(false)
      return
    }
    if (scope === 'app') {
      setIsUnlocked(false)
      return
    }
    setIsHomeUnlocked(false)
    setIsUnlocked(false)
  }, [])

  const value = useMemo(
    () => ({
      isUnlocked,
      isHomeUnlocked,
      hasPin,
      hasDevicePin: deviceHasPin,
      biometricAvailable: biometric.available,
      biometricReady: biometric.ready,
      biometricEnabled: biometric.enabled,
      setBiometricEnabled,
      confirmBiometricIdentity,
      verifyPin,
      unlockWithPin,
      unlockWithBiometrics,
      setDevicePin,
      lock,
    }),
    [biometric.available, biometric.enabled, biometric.ready, confirmBiometricIdentity, deviceHasPin, hasPin, isHomeUnlocked, isUnlocked, lock, setBiometricEnabled, setDevicePin, unlockWithBiometrics, unlockWithPin, verifyPin]
  )
  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>
}

export function useSecurity() {
  const context = useContext(SecurityContext)
  if (!context) throw new Error('useSecurity must be used within SecurityProvider')
  return context
}

export function RequireUnlock({
  children,
  title = "Locked",
  message = "Enter your PIN to access this page.",
}: {
  children: ReactNode
  title?: string
  message?: string
}) {
  const { isUnlocked } = useSecurity()
  return <RequireReauth
    title={title}
    message={message}
    completed={isUnlocked}
    unlockScope="app"
  >
    {children}
  </RequireReauth>
}

type RequireReauthProps = {
  children: ReactNode
  title?: string
  message?: string
  completed?: boolean
  onVerified?: () => void
  unlockScope?: UnlockScope
}

export function RequireReauth({
  children,
  title = 'Confirm access',
  message = 'Confirm your PIN or fingerprint to view this note.',
  completed,
  onVerified,
  unlockScope = 'app',
}: RequireReauthProps) {
  const { hasPin, biometricAvailable, biometricReady, biometricEnabled, unlockWithPin, unlockWithBiometrics } = useSecurity()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [localConfirmed, setLocalConfirmed] = useState(false)
  const [biometricSettled, setBiometricSettled] = useState(false)
  const didFocusBiometric = useRef(false)
  const pinInputRef = useRef<HTMLInputElement | null>(null)
  const shouldTryBiometric = hasPin && biometricEnabled && biometricReady && biometricAvailable
  const isCompleted = completed ?? localConfirmed
  const markVerified = useCallback(() => {
    setLocalConfirmed(true)
    onVerified?.()
  }, [onVerified])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (unlockWithPin(pin, unlockScope)) {
      setError(null)
      setPin('')
      markVerified()
      return
    }
    setError(hasPin ? 'Incorrect PIN.' : 'PIN not configured.')
  }

  const handleBiometric = async () => {
    setBiometricSettled(false)
    const success = await unlockWithBiometrics(unlockScope)
    setError(success ? null : 'Biometric unlock failed.')
    if (success) markVerified()
    setBiometricSettled(true)
  }

  const handlePinFocus = () => {
    if (didFocusBiometric.current) return
    didFocusBiometric.current = true
    if (shouldTryBiometric) void handleBiometric()
  }

  useEffect(() => {
    if (isCompleted) return
    if (!biometricReady) {
      setBiometricSettled(false)
      return
    }
    if (!hasPin || !biometricEnabled || !biometricAvailable || didFocusBiometric.current) {
      setBiometricSettled(true)
      return
    }
    didFocusBiometric.current = true
    setBiometricSettled(false)
    let active = true
    void unlockWithBiometrics(unlockScope)
      .then(success => {
        if (active) setError(success ? null : 'Biometric unlock failed.')
        if (success) markVerified()
      })
      .finally(() => { if (active) setBiometricSettled(true) })
    return () => { active = false }
  }, [biometricAvailable, biometricEnabled, biometricReady, hasPin, isCompleted, markVerified, unlockScope, unlockWithBiometrics])

  useEffect(() => {
    if (isCompleted || !hasPin || !biometricSettled) return
    pinInputRef.current?.focus()
  }, [biometricSettled, hasPin, isCompleted])

  if (!hasPin || isCompleted) return <>{children}</>

  return <div className="state state-locked">
    <div className="stateCard">
      <h2>{title}</h2>
      <p>{message}</p>
      {!hasPin
        ? <div className="stateMeta">PIN not configured.</div>
        : <form className="lockForm" onSubmit={handleSubmit}>
          <input
            ref={pinInputRef}
            className="lockInput"
            type="password"
            placeholder="PIN"
            value={pin}
            onChange={event => setPin(event.target.value)}
            onFocus={handlePinFocus}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <div className="lockActions">
            <button className="stateButton" type="submit">Unlock</button>
            {biometricAvailable && biometricEnabled && <button
              className="stateButton stateButtonSecondary"
              type="button"
              onClick={handleBiometric}
            >
              Use fingerprint
            </button>
            }
            <button className="stateButton stateButtonSecondary" type="button" onClick={() => navigate('/')}>Go back</button>
          </div>
        </form>
      }
      {!hasPin && <div className="lockActions">
        <button className="stateButton stateButtonSecondary" type="button" onClick={() => navigate('/')}>Go back</button>
      </div>}
      {error && <div className="stateMeta stateMetaError">{error}</div>}
    </div>
  </div>
}
