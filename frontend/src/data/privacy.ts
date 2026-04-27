import { manageLocalStorage } from '../utils/localProcessing'

const ANDROID_PRIVACY_MODE_KEY = 'dailynotes.androidPrivacyMode'
export const PRIVACY_SETTINGS_CHANGED_EVENT = 'dailynotes:privacySettingsChanged'

export const getAndroidPrivacyModeEnabled = () => manageLocalStorage.get(ANDROID_PRIVACY_MODE_KEY, '1', String) !== '0'

export function setAndroidPrivacyModeEnabled(enabled: boolean) {
  manageLocalStorage.set({ key: ANDROID_PRIVACY_MODE_KEY, value: enabled ? '1' : '0' })
  if (typeof window !== 'undefined') {
    window.DailyNotesPrivacy?.setEnabled?.(enabled)
    window.dispatchEvent(new Event(PRIVACY_SETTINGS_CHANGED_EVENT))
  }
  return enabled
}
