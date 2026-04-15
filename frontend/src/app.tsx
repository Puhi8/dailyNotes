import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { BrowserRouter, HashRouter, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireReauth, RequireUnlock, SecurityProvider, useSecurity } from './security'
import { AuthProvider, RequireAuth, useAuth } from './auth'
import StartupGate from './components/StartupGate'
import { useAndroidBackButton } from './utils/hardwareBack'
import { eventListener } from './utils/functions'

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
const shouldUseHashRouter = (!isNativePlatform && import.meta.env.PROD && import.meta.env.VITE_ROUTER_MODE === 'hash')
const DEV_PRIVACY_KEY = 'DEV'
const PRIVACY_DEV_EVENTS = ['storage', 'blur', 'focus'] as const
const PRIVACY_FOCUS_EVENTS = ['blur', 'focus'] as const

const readPrivacyBlurEnabled = () => {
  if (typeof window === 'undefined') return true
  try { return window.localStorage.getItem(DEV_PRIVACY_KEY) !== '1' }
  catch { return true }
}

export default () => (
  <AuthProvider>
    <SecurityProvider>
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

function PrivacyScreen() {
  const [isPrivate, setIsPrivate] = useState(false)
  const [privacyBlurEnabled, setPrivacyBlurEnabled] = useState(readPrivacyBlurEnabled)

  useEffect(() => {
    const updatePrivacyBlurEnabled = () => {
      const enabled = readPrivacyBlurEnabled()
      setPrivacyBlurEnabled(enabled)
      window.DailyNotesPrivacy?.setEnabled?.(enabled)
    }
    updatePrivacyBlurEnabled()
    const removeWindowListeners = eventListener.window(PRIVACY_DEV_EVENTS, updatePrivacyBlurEnabled)
    const removeDocumentListeners = eventListener.document(['visibilitychange'], updatePrivacyBlurEnabled)
    return () => {
      removeWindowListeners()
      removeDocumentListeners()
      window.DailyNotesPrivacy?.setEnabled?.(true)
    }
  }, [])

  useEffect(() => {
    if (isNativePlatform || !privacyBlurEnabled) {
      setIsPrivate(false)
      return
    }
    const isLockScreenVisible = () => (
      document.documentElement.classList.contains('lockScreenActive') ||
      Boolean(document.querySelector('.state-locked'))
    )
    const updatePrivacy = () => {
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
      removeWindowListeners()
      removeDocumentListeners()
    }
  }, [privacyBlurEnabled])

  const showPrivacy = privacyBlurEnabled && isPrivate
  useEffect(() => {
    document.documentElement.classList.toggle('privacyActive', showPrivacy)
    return () => document.documentElement.classList.remove('privacyActive')
  }, [showPrivacy])
  if (isNativePlatform || !showPrivacy) return null
  return <div className="privacyScreen" aria-hidden="true" />
}

type LockedRoute = {
  path: string
  item: ReactNode
  lockTitle?: string
  lockMessage?: string
}

const lockedRouts: LockedRoute[] = [
  { path: "/today", item: <SingleDay dayType="today" /> },
  { path: "/yesterday", item: <SingleDay dayType="yesterday" /> },
  { path: "/notes", item: <Notes /> },
  { path: "/notes/:date", item: <NoteDetailGate /> },
  { path: "/accomplishments", item: <Accomplishments /> },
  { path: "/settings", item: <Settings /> },
]

const navbarItems = [
  { text: "Home", shortText: "Home", link: "/" },
  { text: "Today", shortText: "Today", link: "/today" },
  { text: "Yesterday", shortText: "Yest.", link: "/yesterday" },
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
          <NavLink key={item.link} to={item.link} className={({ isActive }) => (isActive ? 'active' : undefined)}>
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
          <Route
            path="/"
            element={<RequireAuth><HomeGate /></RequireAuth>}
          />
          {lockedRouts.map(item => (
            <Route
              key={item.path}
              path={item.path}
              element={<RequireAuth>
                <RequireUnlock title={item.lockTitle} message={item.lockMessage}>
                  {item.item}
                </RequireUnlock>
              </RequireAuth>}
            />
          ))}
        </Routes>
      </Suspense>
    </main>
  </div>
}

function AndroidBackButtonBridge() {
  useAndroidBackButton()
  return null
}

function HomeGate() {
  const { isHomeUnlocked } = useSecurity()
  return <RequireReauth
    title="Welcome back"
    message="Confirm your fingerprint or PIN to open Home."
    completed={isHomeUnlocked}
    unlockScope="home"
  >
    <Home />
  </RequireReauth>
}

function NoteDetailGate() {
  const { date } = useParams()
  return <RequireReauth
    key={date ?? 'note'}
    title="Confirm note access"
    message="Confirm your PIN or fingerprint to view this day note."
  >
    <NoteDetail />
  </RequireReauth>
}
