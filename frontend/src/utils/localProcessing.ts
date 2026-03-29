type localStorageSetter = {
  key: string
  value: unknown
}

export const manageLocalStorage = {
  set: (items: localStorageSetter[] | localStorageSetter) => {
    if (typeof window === 'undefined') return
    if (Array.isArray(items)) for (const item of items) { window.localStorage.setItem(item.key, String(item.value)) }
    else window.localStorage.setItem(items.key, String(items.value))
  },
  remove: (keys: string | string[]) => {
    if (typeof window === 'undefined') return
    if (typeof keys !== "string") for (const key of keys) { window.localStorage.removeItem(key) }
    else window.localStorage.removeItem(keys)
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
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallbackValue
    return parser ? parser(raw) : raw
  }
  return typeof keys === "string" ? getValue(keys) : keys.map(getValue)
}

export function addMyEventListener(key: string, handler: () => void) {
  if (typeof window === 'undefined') return () => { }
  window.addEventListener(key, handler)
  return () => window.removeEventListener(key, handler)
}