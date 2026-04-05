import { Capacitor } from '@capacitor/core'

type localStorageSetter = {
  key: string
  value: unknown
}

const inMemoryStorage = new Map<string, string>()
export const isPersistentRuntime = () => (typeof window !== 'undefined' && Capacitor.isNativePlatform())

export const manageLocalStorage = {
  set: (items: localStorageSetter[] | localStorageSetter) => {
    if (typeof window === 'undefined') return
    const list = Array.isArray(items) ? items : [items]
    for (const item of list) {
      const value = String(item.value)
      inMemoryStorage.set(item.key, value)
      if (isPersistentRuntime()) window.localStorage.setItem(item.key, value)
    }
  },
  remove: (keys: string | string[]) => {
    if (typeof window === 'undefined') return
    const list = typeof keys === "string" ? [keys] : keys
    for (const key of list) {
      inMemoryStorage.delete(key)
      if (isPersistentRuntime()) window.localStorage.removeItem(key)
    }
  },
  get: getLocalStorageItems
}

function getLocalStorageItems<T>(key: string, fallbackValue: T, parser: (value: string) => T): T
function getLocalStorageItems<T>(key: string, fallbackValue: T | null, parser: (value: string) => T): T | null
function getLocalStorageItems(key: string, fallbackValue: string | null): string | null
function getLocalStorageItems<T>(keys: string[], fallbackValue: T, parser: (value: string) => T): T[]
function getLocalStorageItems<T>(keys: string[], fallbackValue: T | null, parser: (value: string) => T): (T | null)[]
function getLocalStorageItems(keys: string[], fallbackValue: string | null): (string | null)[]

function getLocalStorageItems<T>(keys: string | string[], fallbackValue: T | string | null, parser?: (value: string) => T) {
  if (typeof window === 'undefined') return fallbackValue
  const getValue = (key: string) => {
    const memoryValue = inMemoryStorage.get(key)
    if (memoryValue != null) return parser ? parser(memoryValue) : memoryValue
    if (!isPersistentRuntime()) return fallbackValue
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallbackValue
    inMemoryStorage.set(key, raw)
    return parser ? parser(raw) : raw
  }
  return typeof keys === "string" ? getValue(keys) : keys.map(getValue)
}

export function addMyEventListener(key: string, handler: () => void) {
  if (typeof window === 'undefined') return () => { }
  window.addEventListener(key, handler)
  return () => window.removeEventListener(key, handler)
}
