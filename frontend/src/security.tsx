import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { manageLocalStorage } from './utils/localProcessing'
import { eventListener, useObjectState } from './utils/functions'
import { Button, LockInput } from './utils/simplifyReact'
import { useSecurityReauthSettings, type SecurityReauthSetting } from './data/securitySettings'

declare global {
  interface Window {
    DailyNotesPrivacy?: {
      setEnabled?: (enabled: boolean) => void
      setLockScreenActive?: (active: boolean) => void
      prepareForExit?: () => void
    }
    __dailyNotesPrivacySkipUntil?: number
  }
}

type UnlockScope = 'home' | 'app'

const canPromptForAuth = () => {
  if (typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return false
  return Capacitor.isNativePlatform() || document.hasFocus()
}

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
  const { focus: requireBackInFocusUnlock } = useSecurityReauthSettings()
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isHomeUnlocked, setIsHomeUnlocked] = useState(false)
  const biometricPromptActive = useRef(false)
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
      biometricPromptActive.current = true
      await NativeBiometric.verifyIdentity({ reason })
      return true
    }
    catch { return false }
    finally { biometricPromptActive.current = false }
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

  useEffect(() => {
    if (!requireBackInFocusUnlock || !hasPin) return

    let disposed = false
    const nativeListenerRemovers: Array<() => void> = []
    const lockEnterGate = () => {
      if (disposed || biometricPromptActive.current) return
      setIsHomeUnlocked(false)
    }
    const handleVisibilityChange = () => { if (document.visibilityState !== 'visible') lockEnterGate() }
    const handleNativeAppStateChange = ({ isActive }: { isActive: boolean }) => { if (!isActive) lockEnterGate() }
    const addNativeListener = (listenerPromise: Promise<{ remove: () => Promise<void> }>) => {
      void listenerPromise
        .then(handle => {
          const remove = () => { void handle.remove() }
          if (disposed) remove()
          else nativeListenerRemovers.push(remove)
        })
        .catch(() => { })
    }

    const removeWindowListeners = eventListener.window(['blur', 'pagehide'], lockEnterGate)
    const removeDocumentListeners = eventListener.document(['visibilitychange'], handleVisibilityChange)

    if (isNative) {
      addNativeListener(CapacitorApp.addListener('pause', lockEnterGate))
      addNativeListener(CapacitorApp.addListener('appStateChange', handleNativeAppStateChange))
    }

    return () => {
      disposed = true
      removeWindowListeners()
      removeDocumentListeners()
      nativeListenerRemovers.forEach(remove => remove())
    }
  }, [hasPin, isNative, requireBackInFocusUnlock])

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

export function RequireUnlock({ children, title = "Locked", message = "Enter your PIN to access this page."
}: { children: ReactNode, title?: string, message?: string }) {
  const { isUnlocked } = useSecurity()
  return <RequireReauth
    title={title}
    message={message}
    completed={isUnlocked}
    reauthMoment="internal"
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
  reauthMoment?: SecurityReauthSetting
  ignoreReauthSettings?: boolean
  presentation?: 'page' | 'modal'
  onCancel?: () => void
}

export function RequireReauth({
  children,
  title = 'Confirm access',
  message = 'Confirm your PIN or fingerprint to view this note.',
  completed,
  onVerified,
  unlockScope = 'app',
  reauthMoment = 'internal',
  ignoreReauthSettings = false,
  presentation = 'page',
  onCancel,
}: RequireReauthProps) {
  const { hasPin, biometricAvailable, biometricReady, biometricEnabled, unlockWithPin, unlockWithBiometrics } = useSecurity()
  const { internal: requireInternalMovementUnlock, focus: requireBackInFocusUnlock } = useSecurityReauthSettings()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [localConfirmed, setLocalConfirmed] = useState(false)
  const [biometricSettled, setBiometricSettled] = useState(false)
  const [canPrompt, setCanPrompt] = useState(canPromptForAuth)
  const didFocusBiometric = useRef(false)
  const pinInputRef = useRef<HTMLInputElement | null>(null)
  const shouldTryBiometric = hasPin && biometricEnabled && biometricReady && biometricAvailable
  const isCompleted = completed ?? localConfirmed
  const isRequirementDisabled = !ignoreReauthSettings && (
    (reauthMoment === 'internal' && !requireInternalMovementUnlock) ||
    (reauthMoment === 'focus' && !requireBackInFocusUnlock)
  )
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
    let disposed = false
    const nativeListenerRemovers: Array<() => void> = []
    const syncCanPrompt = (nextValue = canPromptForAuth()) => { if (!disposed) setCanPrompt(nextValue) }
    const addNativeListener = (listenerPromise: Promise<{ remove: () => Promise<void> }>) => {
      void listenerPromise
        .then(handle => {
          const remove = () => { void handle.remove() }
          if (disposed) remove()
          else nativeListenerRemovers.push(remove)
        })
        .catch(() => { })
    }

    syncCanPrompt()
    const removeDocumentListeners = eventListener.document(['visibilitychange'], () => syncCanPrompt())
    const removeWindowListeners = Capacitor.isNativePlatform()
      ? () => { }
      : eventListener.window(['blur', 'focus', 'pagehide'], () => syncCanPrompt())
    if (Capacitor.isNativePlatform()) {
      addNativeListener(CapacitorApp.addListener('pause', () => syncCanPrompt(false)))
      addNativeListener(CapacitorApp.addListener('resume', () => syncCanPrompt(true)))
      addNativeListener(CapacitorApp.addListener('appStateChange', ({ isActive }) => syncCanPrompt(isActive)))
    }
    return () => {
      disposed = true
      removeDocumentListeners()
      removeWindowListeners()
      nativeListenerRemovers.forEach(remove => remove())
    }
  }, [])

  useEffect(() => {
    didFocusBiometric.current = false
    setBiometricSettled(false)
    if (!isCompleted && !isRequirementDisabled) {
      setError(null)
      setPin('')
    }
  }, [isCompleted, isRequirementDisabled])

  useEffect(() => {
    if (isRequirementDisabled || isCompleted) return
    if (!canPrompt || !biometricReady) {
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
  }, [biometricAvailable, biometricEnabled, biometricReady, canPrompt, hasPin, isCompleted, isRequirementDisabled, markVerified, unlockScope, unlockWithBiometrics])

  useEffect(() => {
    if (isRequirementDisabled || isCompleted || !hasPin || !biometricSettled) return
    pinInputRef.current?.focus()
  }, [biometricSettled, hasPin, isCompleted, isRequirementDisabled])

  useEffect(() => {
    const isLockScreen = hasPin && !isCompleted && !isRequirementDisabled
    document.documentElement.classList.toggle('lockScreenActive', isLockScreen)
    window.DailyNotesPrivacy?.setLockScreenActive?.(isLockScreen)
    return () => {
      document.documentElement.classList.remove('lockScreenActive')
      window.DailyNotesPrivacy?.setLockScreenActive?.(false)
    }
  }, [hasPin, isCompleted, isRequirementDisabled])

  if (!hasPin || isCompleted || isRequirementDisabled) return <>{children}</>

  const handleCancel = () => {
    if (onCancel) { onCancel(); return }
    navigate("/")
  }

  const lockCard = <div className={presentation === 'modal' ? 'stateCard modalCard' : 'stateCard'}>
    <h2>{title}</h2>
    <p>{message}</p>
    {!hasPin
      ? <div className="stateMeta">PIN not configured.</div>
      : <form className="lockForm" onSubmit={handleSubmit}>
        <LockInput.pin
          ref={pinInputRef}
          placeholder="PIN"
          value={pin}
          onChange={event => setPin(event.target.value)}
          onFocus={handlePinFocus}
          autoComplete="one-time-code"
        />
        <div className="lockActions">
          <Button.primary type="submit">Unlock</Button.primary>
          {biometricAvailable && biometricEnabled && <Button.secondary onClick={handleBiometric}>
            Use fingerprint
          </Button.secondary>
          }
          <Button.secondary onClick={handleCancel}>{onCancel ? 'Cancel' : 'Go back'}</Button.secondary>
        </div>
      </form>
    }
    {!hasPin && <div className="lockActions">
      <Button.secondary onClick={handleCancel}>{onCancel ? 'Cancel' : 'Go back'}</Button.secondary>
    </div>}
    {error && <div className="stateMeta stateMetaError">{error}</div>}
  </div>
  if (presentation === 'modal') return <div className="modalBackdrop" role="presentation">{lockCard}</div>
  return <div className="state state-locked">{lockCard}</div>
}
