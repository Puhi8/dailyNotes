import { useCallback, useState } from 'react'

export function pad2(value: number) { return String(value).padStart(2, '0') }

export const makeDayKey = (date: Date) => `${pad2(date.getFullYear() % 100)}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
export function formatDateKey(arg1: number | Date, month?: number, day?: number): string {
  if (arg1 instanceof Date) return makeDayKey(arg1)
  return `${pad2(arg1 % 100)}-${pad2(month!)}-${pad2(day!)}`
}

export function toUpperCase(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export const eventListener = {
  window: (events: readonly (keyof WindowEventMap)[], listener: EventListener) => {
    events.forEach(event => window.addEventListener(event, listener))
    return () => events.forEach(event => window.removeEventListener(event, listener))
  },
  document: (events: readonly (keyof DocumentEventMap)[], listener: EventListener) => {
    events.forEach(event => document.addEventListener(event, listener))
    return () => events.forEach(event => document.removeEventListener(event, listener))
  },
}

export function useObjectState<T extends object>(initialState: T) {
  const [state, setState] = useState<T>(initialState)
  const setPartial = useCallback((update: Partial<T> | ((prev: T) => Partial<T>)) => {
    setState(prev => ({
      ...prev,
      ...(typeof update === 'function' ? update(prev) : update),
    }))
  }, [])
  const reset = useCallback(() => setState(initialState), [initialState])
  return [state, setPartial, reset] as const
}
