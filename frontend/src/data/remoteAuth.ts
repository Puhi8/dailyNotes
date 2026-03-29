import { addMyEventListener, manageLocalStorage } from "../utils/localProcessing"

const API_BASE_URL_KEY = 'dailynotes.apiBaseUrl'
const AUTH_TOKEN_KEY = 'dailynotes.jwt'
const AUTH_USER_ID_KEY = 'dailynotes.userId'
const AUTH_CHANGE_EVENT = 'dailynotes.auth'
const DEFAULT_API_PORT = 5789

const LOCAL_SESSION_TOKEN = 'local-device-session'
const LOCAL_USER_ID = 1

const notifyAuthChange = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT))
}

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/^"+|"+$/g, '')
  if (trimmed == '') return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(withScheme)
    if (!["http:", "https:"].includes(parsed.protocol)) return ''
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/+$/, '')
  }
  catch { return withScheme.replace(/\/+$/, '') }
}

export const DEFAULT_API_BASE_URL = (() => {
  const fromEnv = normalizeBaseUrl(String(import.meta.env.VITE_API_BASE_URL || ''))
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host) {
      const scheme = window.location.protocol === 'https:' ? 'https' : 'http'
      return normalizeBaseUrl(`${scheme}://${host}:${DEFAULT_API_PORT}`)
    }
  }
  return normalizeBaseUrl(`http://localhost:${DEFAULT_API_PORT}`)
})()

export const apiBaseUrl = {
  get: () => {
    const raw = manageLocalStorage.get(API_BASE_URL_KEY, DEFAULT_API_BASE_URL)
    const stored = normalizeBaseUrl(raw ?? '')
    if (typeof window !== 'undefined' && stored && stored !== raw) manageLocalStorage.set({ key: API_BASE_URL_KEY, value: stored })
    return stored || DEFAULT_API_BASE_URL
  },
  set: (value: string) => {
    if (typeof window === 'undefined') return DEFAULT_API_BASE_URL
    const normalized = normalizeBaseUrl(value)
    if (normalized === '') {
      manageLocalStorage.remove(API_BASE_URL_KEY)
      return DEFAULT_API_BASE_URL
    }
    manageLocalStorage.set({ key: API_BASE_URL_KEY, value: normalized })
    return normalized
  }
}

const requestApi = async (path: string, options: RequestInit = {}, remote: { auth?: boolean; allow401?: boolean; unauthorizedMessage?: string } = {}) => {
  const { auth = false, allow401 = false, unauthorizedMessage = 'Remote session expired. Sign in again to continue backup sync.' } = remote
  const headers = new Headers(options.headers ?? {})
  if (auth) {
    const token = authSession.getToken()
    if (!token) throw new Error('Sign in on Login page to connect remote backup.')
    headers.set('Authorization', `Bearer ${token}`)
  }
  const url = `${apiBaseUrl.get()}${path}`
  let response
  try { response = await fetch(url, { ...options, headers }) }
  catch (err) {
    throw new Error(`Cannot reach API at ${url}. Check server address, network, and CORS.${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
  }

  if (response.status === 401 && auth) {
    authSession.clear()
    if (allow401) return response
    throw new Error(unauthorizedMessage)
  }
  if (!response.ok) {
    const detail = (await response.text()).trim()
    if (detail) throw new Error(detail)
    if (response.status === 401) throw new Error('Invalid credentials.')
    throw new Error(`Request failed: ${response.status}`)
  }
  return response
}

export const authSession = {
  getToken: () => (manageLocalStorage.get(AUTH_TOKEN_KEY, "", String)),
  getUserId: () => (manageLocalStorage.get(AUTH_USER_ID_KEY, null, Number)),
  hasSession: () => {
    const token = authSession.getToken().trim()
    const userID = authSession.getUserId()
    return Boolean(token && Number.isFinite(userID) && userID && userID > 0)
  },
  getAll: () => (authSession.hasSession()
    ? { token: authSession.getToken(), userId: Number(authSession.getUserId()) }
    : { token: LOCAL_SESSION_TOKEN, userId: LOCAL_USER_ID }),
  set: (userId: number, jwt: string) => {
    manageLocalStorage.set([{ key: AUTH_TOKEN_KEY, value: jwt }, { key: AUTH_USER_ID_KEY, value: userId }])
    notifyAuthChange()
  },
  clear: () => {
    manageLocalStorage.set([{ key: AUTH_TOKEN_KEY, value: "" }, { key: AUTH_USER_ID_KEY, value: "" }])
    notifyAuthChange()
  }
}

export const subscribeAuthChanges = (handler: () => void) => (addMyEventListener(AUTH_CHANGE_EVENT, handler))

export const fetchRemoteWithAuth = async (path: string, options: RequestInit = {}) => await requestApi(path, options, { auth: true })

export async function login(password: string): Promise<{ userId: number, jwt: string }> {
  return (await requestApi('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })).json()
}

export async function logout(): Promise<void> {
  if (!authSession.getToken()) return
  await requestApi('/logout', { method: 'POST' }, { auth: true, allow401: true })
}

export async function updateRemoteCredentials(currentPassword: string, newPassword: string): Promise<{ userId: number }> {
  const response = await requestApi('/account/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }, { auth: true })
  const payload = await response.json()
  authSession.clear()
  return payload
}
