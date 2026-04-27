import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { getAndroidPrivacyModeEnabled, setAndroidPrivacyModeEnabled } from '../../data/privacy'
import { getSecurityReauthMode, getSecurityReauthSettings, setSecurityReauthMode, type SecurityReauthMode } from '../../data/securitySettings'
import { RequireReauth, useSecurity } from '../../security'
import { useObjectState } from '../../utils/functions'
import { registerCloseOnBack } from '../../utils/hardwareBack'
import { Button, ToggleSwitch } from '../../utils/simplifyReact'
import { PinPopup } from './SettingsPopups'
import { SettingsSection } from './SettingsShared'

type PinState = {
  current: string
  draft: string
  confirm: string
}

type SecurityErrors = {
  biometric: string | null
  lockSetting: string | null
  pin: string | null
}

type SecurityState = {
  confirmingBiometric: boolean
  confirmingReauthMode: SecurityReauthMode | null
}

export default function SecuritySettings() {
  const isNativeAndroidPlatform = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const { hasPin, hasDevicePin, biometricAvailable, biometricReady, biometricEnabled, setBiometricEnabled, confirmBiometricIdentity, verifyPin, setDevicePin, lock } = useSecurity()
  const [privacyScreenBlockerEnabled, setPrivacyScreenBlockerEnabled] = useState(getAndroidPrivacyModeEnabled)
  const [securityReauthSettings, setSecurityReauthSettings] = useState(getSecurityReauthSettings)
  const [errors, setErrors] = useObjectState<SecurityErrors>({ biometric: null, lockSetting: null, pin: null })
  const [state, setState] = useObjectState<SecurityState>({ confirmingBiometric: false, confirmingReauthMode: null })
  const [pinPopupOpen, setPinPopupOpen] = useState(false)
  const [pin, setPin, resetPin] = useObjectState<PinState>({ current: '', draft: '', confirm: '' })

  useEffect(() => {
    if (!pinPopupOpen) return
    return registerCloseOnBack(() => {
      setPinPopupOpen(false)
      setErrors({ pin: null })
    })
  }, [pinPopupOpen, setErrors])

  const handleEditPin = () => {
    resetPin()
    setErrors({ pin: null })
    setPinPopupOpen(true)
  }

  const handleSavePin = (event: FormEvent) => {
    event.preventDefault()
    if (hasDevicePin && !verifyPin(pin.current.trim())) {
      setErrors({ pin: 'Current PIN is incorrect.' })
      return
    }
    const normalized = pin.draft.trim()
    if (!/^\d+$/.test(normalized)) {
      setErrors({ pin: 'PIN should contain only numbers.' })
      return
    }
    if (normalized !== pin.confirm.trim()) {
      setErrors({ pin: 'PINs do not match.' })
      return
    }
    setPinPopupOpen(false)
    setDevicePin(normalized)
  }

  const handleToggleBiometric = async () => {
    if (state.confirmingBiometric) return
    setErrors({ biometric: null })
    if (!biometricReady) {
      setErrors({ biometric: 'Checking biometric availability.' })
      return
    }
    if (!biometricAvailable) {
      setErrors({ biometric: 'Biometric unlock is not available on this device.' })
      return
    }
    const nextEnabled = !biometricEnabled
    setState({ confirmingBiometric: true })
    try {
      const confirmed = await confirmBiometricIdentity(nextEnabled ? 'Enable biometric unlock' : 'Disable biometric unlock')
      if (!confirmed) {
        setErrors({ biometric: 'Biometric confirmation failed.' })
        return
      }
      setBiometricEnabled(nextEnabled)
    }
    finally { setState({ confirmingBiometric: false }) }
  }

  const currentSecurityReauthMode = getSecurityReauthMode(securityReauthSettings)
  const selectedSecurityReauthMode = state.confirmingReauthMode ?? currentSecurityReauthMode

  const handleReauthModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const mode = event.target.value as SecurityReauthMode
    if (state.confirmingReauthMode || mode === currentSecurityReauthMode) return
    setErrors({ lockSetting: null })
    if (!hasPin) {
      setErrors({ lockSetting: 'Set a PIN before changing lock behavior.' })
      return
    }
    setState({ confirmingReauthMode: mode })
  }

  const applyConfirmedReauthMode = () => {
    const mode = state.confirmingReauthMode
    if (!mode) return
    setSecurityReauthSettings(setSecurityReauthMode(mode))
    setState({ confirmingReauthMode: null })
  }

  return <>
    <SettingsSection title="Security">
      <div className="panelRow">
        <span>Device PIN</span>
        <span className="panelRowValue">
          {hasDevicePin ? 'Set' : 'Not set'}
          <Button.secondaryInline onClick={handleEditPin}>{hasDevicePin ? 'Change' : 'Set'}</Button.secondaryInline>
        </span>
      </div>
      {(!biometricReady || biometricAvailable) && <>
        <div className="panelRow">
          <span>Biometric</span>
          <span className="panelRowValue panelRowValueToggle">
            {state.confirmingBiometric ? 'Confirming...' : biometricReady ? (biometricEnabled ? 'Enabled' : 'Disabled') : 'Checking...'}
            <ToggleSwitch
              ariaLabel="Toggle biometric unlock"
              checked={biometricEnabled}
              onChange={() => { void handleToggleBiometric() }}
              disabled={!biometricReady || state.confirmingBiometric}
            />
          </span>
        </div>
        {errors.biometric && <div className="stateMeta stateMetaError">{errors.biometric}</div>}
      </>}
      <div className="panelRow">
        <span>Lock checks</span>
        <span className="panelRowValue">
          <select
            className="lockInput panelInlineSelect"
            value={selectedSecurityReauthMode}
            onChange={handleReauthModeChange}
            disabled={!hasPin || Boolean(state.confirmingReauthMode)}
          >
            <option value="none">None</option>
            <option value="enter">On enter</option>
            <option value="all">All</option>
          </select>
        </span>
      </div>
      {errors.lockSetting && <div className="stateMeta stateMetaError">{errors.lockSetting}</div>}
      {isNativeAndroidPlatform && <div className="panelRow">
        <span>Privacy screen blocker</span>
        <span className="panelRowValue panelRowValueToggle">
          {privacyScreenBlockerEnabled ? 'Enabled' : 'Disabled'}
          <ToggleSwitch
            ariaLabel="Toggle privacy screen blocker"
            checked={privacyScreenBlockerEnabled}
            onChange={() => setPrivacyScreenBlockerEnabled(setAndroidPrivacyModeEnabled(!privacyScreenBlockerEnabled))}
          />
        </span>
      </div>}
      <Button.primary onClick={() => lock()}>Lock now</Button.primary>
    </SettingsSection>
    {pinPopupOpen && <PinPopup
      hasDevicePin={hasDevicePin}
      values={pin}
      error={errors.pin}
      onChange={(field, value) => { setPin({ [field]: value } as Partial<PinState>); setErrors({ pin: null }) }}
      onSave={handleSavePin}
      onClose={() => setPinPopupOpen(false)}
    />}
    {state.confirmingReauthMode && <RequireReauth
      title="Confirm lock change"
      message={`Confirm your PIN or fingerprint to change lock checks to ${state.confirmingReauthMode === 'none' ? 'none' : state.confirmingReauthMode === 'enter' ? 'on enter' : 'all'}.`}
      onVerified={applyConfirmedReauthMode}
      ignoreReauthSettings
      presentation="modal"
      onCancel={() => setState({ confirmingReauthMode: null })}
    >
      {null}
    </RequireReauth>}
  </>
}
