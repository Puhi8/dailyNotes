import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { BrowserRouter, HashRouter, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireReauth, RequireUnlock, SecurityProvider, useSecurity } from './security'
import { AuthProvider, RequireAuth, useAuth } from './auth'
import StartupGate from './components/StartupGate'
import { useAndroidBackButton } from './utils/hardwareBack'
import { eventListener, makeDayKey } from './utils/functions'
import { getAndroidPrivacyModeEnabled, PRIVACY_SETTINGS_CHANGED_EVENT } from './data/privacy'

const Login = lazy(() => import('./pages/Login'))
const Home = lazy(() => import('./home'))
const Accomplishments = lazy(() => import('./pages/Accomplishments'))
const Notes = lazy(() => import('./pages/Notes'))
const NoteDetail = lazy(() => import('./pages/NoteDetail'))
const Settings = lazy(() => import('./pages/Settings'))
const SingleDay = lazy(() => import('./pages/SingleDay'))

const routerBasename = (() => {
  const baseUrl = import.meta.env.BASE_URL || '/'
  return baseUrl === '/' ? undefined : baseUrl.replace(/\/$/, '')
})()

const isNativePlatform = Capacitor.isNativePlatform()
const isWebPlatform = !isNativePlatform
const isNativeAndroidPlatform = isNativePlatform && Capacitor.getPlatform() === 'android'
const shouldUseHashRouter = (!isNativePlatform && import.meta.env.PROD && import.meta.env.VITE_ROUTER_MODE === 'hash')
const DEV_PRIVACY_KEY = 'DEV'
const PRIVACY_DEV_EVENTS = ['storage', 'blur', 'focus', PRIVACY_SETTINGS_CHANGED_EVENT] as const
const PRIVACY_FOCUS_EVENTS = ['blur', 'focus'] as const

const readPrivacyBlurEnabled = () => {
  if (typeof window === 'undefined') return true
  try { return window.localStorage.getItem(DEV_PRIVACY_KEY) !== '1' }
  catch { return true }
}

const shouldSkipPrivacyForExit = () => (
  typeof window !== 'undefined' &&
  Number(window.__dailyNotesPrivacySkipUntil ?? 0) > Date.now()
)

export default () => (
  <AuthProvider>
    <SecurityProvider>
      <PlatformClassBridge />
      <PrivacyScreen />
      {shouldUseHashRouter
        ? <HashRouter>
          <AndroidBackButtonBridge />
          <StartupGate><AppShell /></StartupGate>
        </HashRouter>
        : <BrowserRouter basename={routerBasename}>
          <AndroidBackButtonBridge />
          <StartupGate><AppShell /></StartupGate>
        </BrowserRouter>}
    </SecurityProvider>
  </AuthProvider>
)

function PlatformClassBridge() {
  useEffect(() => {
    document.documentElement.classList.toggle('platform-android', isNativeAndroidPlatform)
    return () => document.documentElement.classList.remove('platform-android')
  }, [])
  return null
}

function PrivacyScreen() {
  const [isPrivate, setIsPrivate] = useState(false)
  const [privacyBlurEnabled, setPrivacyBlurEnabled] = useState(readPrivacyBlurEnabled)

  useEffect(() => {
    const updatePrivacySettings = () => {
      const enabled = readPrivacyBlurEnabled()
      setPrivacyBlurEnabled(enabled)
      if (isNativeAndroidPlatform) {
        window.DailyNotesPrivacy?.setEnabled?.(getAndroidPrivacyModeEnabled())
      }
    }
    updatePrivacySettings()
    const removeWindowListeners = eventListener.window(PRIVACY_DEV_EVENTS, updatePrivacySettings)
    const removeDocumentListeners = eventListener.document(['visibilitychange'], updatePrivacySettings)
    return () => {
      removeWindowListeners()
      removeDocumentListeners()
    }
  }, [])

  useEffect(() => {
    if (!isWebPlatform || !privacyBlurEnabled) {
      setIsPrivate(false)
      return
    }
    let isActive = true
    const isLockScreenVisible = () => (
      document.documentElement.classList.contains('lockScreenActive') ||
      Boolean(document.querySelector('.state-locked'))
    )
    const updatePrivacy = () => {
      if (!isActive) return
      if (shouldSkipPrivacyForExit()) {
        setIsPrivate(false)
        return
      }
      if (!readPrivacyBlurEnabled()) {
        setPrivacyBlurEnabled(false)
        setIsPrivate(false)
        return
      }
      const shouldProtect = document.visibilityState !== 'visible' || !document.hasFocus()
      setIsPrivate(shouldProtect && !isLockScreenVisible())
    }
    updatePrivacy()
    const removeWindowListeners = eventListener.window(PRIVACY_FOCUS_EVENTS, updatePrivacy)
    const removeDocumentListeners = eventListener.document(['visibilitychange'], updatePrivacy)
    return () => {
      isActive = false
      removeWindowListeners()
      removeDocumentListeners()
    }
  }, [privacyBlurEnabled])

  const showPrivacy = isWebPlatform && privacyBlurEnabled && isPrivate
  useEffect(() => {
    document.documentElement.classList.toggle('privacyActive', showPrivacy)
    return () => document.documentElement.classList.remove('privacyActive')
  }, [showPrivacy])
  if (!showPrivacy) return null
  return showPrivacy ? <div className="privacyScreen" aria-hidden="true" /> : null
}

type LockedRoute = {
  path: string
  item: ReactNode
  lockTitle?: string
  lockMessage?: string
}

const lockedRouts: LockedRoute[] = [
  { path: "/day/:date", item: <SingleDay /> },
  { path: "/notes", item: <Notes /> },
  { path: "/notes/:date", item: <NoteDetailGate /> },
  { path: "/accomplishments", item: <Accomplishments /> },
  { path: "/settings", item: <Settings /> },
]

// Called fresh on every navigation and render, never cached, so nothing goes stale over midnight.
const dayPath = (daysAgo: number) => {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return `/day/${makeDayKey(date)}`
}

type NavbarItem = {
  text: string
  shortText: string
  link: string
  activePath?: () => string
}

const navbarItems: NavbarItem[] = [
  { text: "Home", shortText: "Home", link: "/" },
  { text: "Today", shortText: "Today", link: "/today", activePath: () => dayPath(0) },
  { text: "Yesterday", shortText: "Yest.", link: "/yesterday", activePath: () => dayPath(1) },
  { text: "Notes", shortText: "Notes", link: "/notes" },
  { text: "Accomplishments", shortText: "Accom.", link: "/accomplishments" },
  { text: "Settings", shortText: "Sett.", link: "/settings" },
]

function AppShell() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  return <div className="appShell">
    {isAuthenticated && location.pathname !== '/login' && <nav className="navbar">
      <div className="navLinks">
        {navbarItems.map(item => (
          <NavLink
            key={item.link}
            to={item.link}
            className={({ isActive }) => (isActive || item.activePath?.() === location.pathname ? 'active' : undefined)}
          >
            <span className="navLabelFull">{item.text}</span>
            <span className="navLabelShort">{item.shortText}</span>
          </NavLink>
        ))}
      </div>
    </nav>}
    <main className="appContent">
      <Suspense fallback={<div className="state">Loading...</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/today" element={<DayRedirect daysAgo={0} />} />
          <Route path="/yesterday" element={<DayRedirect daysAgo={1} />} />
          <Route
            path="/"
            element={<ProtectedAppRoute><Home /></ProtectedAppRoute>}
          />
          {lockedRouts.map(item => (
            <Route
              key={item.path}
              path={item.path}
              element={<ProtectedAppRoute>
                <RequireUnlock title={item.lockTitle} message={item.lockMessage}>
                  {item.item}
                </RequireUnlock>
              </ProtectedAppRoute>}
            />
          ))}
        </Routes>
      </Suspense>
    </main>
  </div>
}

const DayRedirect = ({ daysAgo }: { daysAgo: number }) => <Navigate to={dayPath(daysAgo)} replace />

function AndroidBackButtonBridge() {
  useAndroidBackButton()
  return null
}

function ProtectedAppRoute({ children }: { children: ReactNode }) {
  return <RequireAuth>
    <EnterGate>{children}</EnterGate>
  </RequireAuth>
}

function EnterGate({ children }: { children: ReactNode }) {
  const { isHomeUnlocked } = useSecurity()
  return <RequireReauth
    title="Welcome back"
    message="Confirm your fingerprint or PIN to continue."
    completed={isHomeUnlocked}
    reauthMoment="focus"
    unlockScope="home"
  >
    {children}
  </RequireReauth>
}

function NoteDetailGate() {
  const { date } = useParams()
  return <RequireReauth
    key={date ?? 'note'}
    title="Confirm note access"
    message="Confirm your PIN or fingerprint to view this day note."
    reauthMoment="internal"
  >
    <NoteDetail />
  </RequireReauth>
}
