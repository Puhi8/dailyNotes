import { useEffect, useState } from 'react'
import { addMyEventListener, manageLocalStorage } from '../utils/localProcessing'

const REQUIRE_INTERNAL_MOVEMENT_UNLOCK_KEY = 'dailynotes.requireInternalMovementUnlock'
const REQUIRE_BACK_IN_FOCUS_UNLOCK_KEY = 'dailynotes.requireBackInFocusUnlock'
const SECURITY_SETTINGS_CHANGED_EVENT = 'dailynotes:securitySettingsChanged'

export type SecurityReauthSettings = {
  internal: boolean
  focus: boolean
}
export type SecurityReauthSetting = keyof SecurityReauthSettings
export type SecurityReauthMode = 'none' | 'enter' | 'all'

const SECURITY_REAUTH_STORAGE_KEYS: Record<SecurityReauthSetting, string> = {
  internal: REQUIRE_INTERNAL_MOVEMENT_UNLOCK_KEY,
  focus: REQUIRE_BACK_IN_FOCUS_UNLOCK_KEY,
}

const getStoredBoolean = (key: string) => manageLocalStorage.get(key, '1', String) !== '0'

function notifySecuritySettingsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SECURITY_SETTINGS_CHANGED_EVENT))
}

const SECURITY_REAUTH_MODE_SETTINGS: Record<SecurityReauthMode, SecurityReauthSettings> = {
  none: { internal: false, focus: false },
  enter: { internal: false, focus: true },
  all: { internal: true, focus: true },
}

export const getSecurityReauthSettings = (): SecurityReauthSettings => {
  const internal = getStoredBoolean(REQUIRE_INTERNAL_MOVEMENT_UNLOCK_KEY)
  const focus = getStoredBoolean(REQUIRE_BACK_IN_FOCUS_UNLOCK_KEY)
  return { internal, focus: focus || internal }
}

export const getSecurityReauthMode = (settings = getSecurityReauthSettings()): SecurityReauthMode => {
  if (settings.internal) return 'all'
  if (settings.focus) return 'enter'
  return 'none'
}

export function setSecurityReauthMode(mode: SecurityReauthMode) {
  const settings = SECURITY_REAUTH_MODE_SETTINGS[mode]
  manageLocalStorage.set([
    { key: SECURITY_REAUTH_STORAGE_KEYS.internal, value: settings.internal ? '1' : '0' },
    { key: SECURITY_REAUTH_STORAGE_KEYS.focus, value: settings.focus ? '1' : '0' },
  ])
  notifySecuritySettingsChanged()
  return getSecurityReauthSettings()
}

export function useSecurityReauthSettings() {
  const [settings, setSettings] = useState(getSecurityReauthSettings)
  useEffect(() => {
    const syncSettings = () => setSettings(getSecurityReauthSettings())
    const removeSecuritySettingsListener = addMyEventListener(SECURITY_SETTINGS_CHANGED_EVENT, syncSettings)
    const removeStorageListener = addMyEventListener('storage', syncSettings)
    return () => {
      removeSecuritySettingsListener()
      removeStorageListener()
    }
  }, [])

  return settings
}
