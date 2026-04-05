import { App as CapacitorApp, type BackButtonListenerEvent } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { useEffect, useRef } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
export const HARDWARE_BACK_PRIORITY = { OVERLAY: 100, NAVIGATION: 0, EXIT: -1 } as const

type HardwareBackContext = {
  canGoBack: boolean
}

type HardwareBackHandler = (context: HardwareBackContext, processNextHandler: () => void) => void

type RegisteredBackHandler = {
  id: number
  priority: number
  handler: HardwareBackHandler
  debugLabel: string
}

const registeredBackHandlers: RegisteredBackHandler[] = []
let lastHandlerId = 0

function sortByPriorityAndRecency(left: RegisteredBackHandler, right: RegisteredBackHandler) {
  return left.priority === right.priority ? right.id - left.id : right.priority - left.priority
}

export function registerHardwareBackHandler(
  priority: number,
  handler: HardwareBackHandler,
  debugLabel = 'handled custom back action',
) {
  if (typeof window === 'undefined') return () => { }
  const entry: RegisteredBackHandler = { id: ++lastHandlerId, priority, handler, debugLabel }
  registeredBackHandlers.push(entry)
  return () => {
    const index = registeredBackHandlers.findIndex(current => current.id === entry.id)
    if (index >= 0) registeredBackHandlers.splice(index, 1)
  }
}

export function runHardwareBackHandlers(context: HardwareBackContext = { canGoBack: false }) {
  if (typeof window === 'undefined' || registeredBackHandlers.length === 0) return null
  const handlers = [...registeredBackHandlers].sort(sortByPriorityAndRecency)
  const runHandler = (index: number): string | null => {
    const current = handlers[index]
    if (!current) return null
    let shouldContinue = false
    current.handler(context, () => { shouldContinue = true })
    return shouldContinue ? runHandler(index + 1) : current.debugLabel
  }
  return runHandler(0)
}

export function registerCloseOnBack(
  closeAction: () => void,
  priority = HARDWARE_BACK_PRIORITY.OVERLAY,
  debugLabel = 'closed overlay',
) {
  if (typeof window === 'undefined') return () => { }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    closeAction()
  }
  const unregisterBackHandler = registerHardwareBackHandler(priority, () => { closeAction() }, debugLabel)
  window.addEventListener('keydown', onKeyDown)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    unregisterBackHandler()
  }
}

const ROOT_PATH = '/'
const isNativeAndroidPlatform = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
function getHistoryIndex() {
  if (typeof window === 'undefined') return 0
  const historyState = window.history.state as { idx?: unknown } | null
  return typeof historyState?.idx === 'number' ? historyState.idx : 0
}

function resolveFallbackPath(pathname: string, state: unknown) {
  if (pathname === ROOT_PATH) return null
  if (pathname === '/login') {
    const from = (state as { from?: string } | null)?.from
    return from && from !== '/login' ? from : ROOT_PATH
  }
  if (matchPath('/notes/:date', pathname)) return '/notes'
  return ROOT_PATH
}

export function useAndroidBackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  useEffect(() => { locationRef.current = location }, [location])
  useEffect(() => {
    if (!isNativeAndroidPlatform) return
    let isActive = true
    let listenerHandle: PluginListenerHandle | null = null
    console.debug('[android-back] attaching listener')
    const handleBack = ({ canGoBack }: BackButtonListenerEvent) => {
      const currentLocation = locationRef.current
      const historyIndex = getHistoryIndex()
      console.debug('[android-back] backButton event', {
        canGoBack,
        historyIndex,
        pathname: currentLocation.pathname,
      })

      const handledBy = runHardwareBackHandlers({ canGoBack })
      if (handledBy) {
        console.debug(`[android-back] ${handledBy}`)
        return
      }
      if (currentLocation.pathname === ROOT_PATH) {
        console.debug('[android-back] ignored on root')
        return
      }
      if (historyIndex > 0 || canGoBack) {
        console.debug('[android-back] navigated back')
        navigate(-1)
        return
      }

      const fallbackPath = resolveFallbackPath(currentLocation.pathname, currentLocation.state)
      if (fallbackPath && fallbackPath !== currentLocation.pathname) {
        console.debug('[android-back] navigated back', { fallbackPath })
        navigate(fallbackPath, { replace: true })
        return
      }
      console.debug('[android-back] ignored on root')
    }

    void CapacitorApp.addListener('backButton', handleBack).then(handle => {
      if (!isActive) {
        void handle.remove()
        return
      }
      listenerHandle = handle
      console.debug('[android-back] listener attached')
    })
    return () => {
      isActive = false
      console.debug('[android-back] removing listener')
      if (listenerHandle) void listenerHandle.remove()
    }
  }, [navigate])
}
