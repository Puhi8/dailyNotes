import { api } from './data/api'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

type AuthContextValue = {
  isAuthenticated: boolean
  userId: number | null
  login: (password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState(api.auth.session.getAll())
  useEffect(() => {
    const syncFromStorage = () => { setAuth(api.auth.session.getAll()) }
    const unsubscribe = api.auth.subscribe(syncFromStorage)
    return unsubscribe
  }, [])
  const login = async (password: string) => {
    const result = await api.auth.login(password)
    api.auth.session.set(result.userId, result.jwt)
    setAuth({ token: result.jwt, userId: result.userId })
  }
  const logout = () => {
    void api.auth.logout().catch(() => { })
    api.auth.session.clear()
    setAuth(api.auth.session.getAll())
  }
  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(auth.token && auth.userId),
      userId: auth.userId,
      login,
      logout,
    }),
    [auth]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) { throw new Error('useAuth must be used within AuthProvider') }
  return context
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) { return <Navigate to="/login" state={{ from: location.pathname }} replace /> }
  return <>{children}</>
}
