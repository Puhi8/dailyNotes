import type { ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { BrowserRouter, HashRouter, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { RequireReauth, RequireUnlock, SecurityProvider, useSecurity } from './security'
import { AuthProvider, RequireAuth, useAuth } from './auth'
import StartupGate from './components/StartupGate'
import Login from './pages/Login'
import Home from './home'
import Accomplishments from './pages/Accomplishments'
import Notes from './pages/Notes'
import NoteDetail from './pages/NoteDetail'
import Settings from './pages/Settings'
import SingleDay from './pages/SingleDay'
import { useAndroidBackButton } from './utils/hardwareBack'

const routerBasename = (() => {
  const baseUrl = import.meta.env.BASE_URL || '/'
  return baseUrl === '/' ? undefined : baseUrl.replace(/\/$/, '')
})()

const shouldUseHashRouter = (!Capacitor.isNativePlatform() && import.meta.env.PROD && import.meta.env.VITE_ROUTER_MODE === 'hash')

export default function App() {
  return <AuthProvider>
    <SecurityProvider>
      {shouldUseHashRouter
        ? <HashRouter>
          <AndroidBackButtonBridge />
          <StartupGate>
            <AppShell />
          </StartupGate>
        </HashRouter>
        : <BrowserRouter basename={routerBasename}>
          <AndroidBackButtonBridge />
          <StartupGate>
            <AppShell />
          </StartupGate>
        </BrowserRouter>}
    </SecurityProvider>
  </AuthProvider>
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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={<RequireAuth>
            <HomeGate />
          </RequireAuth>}
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
