import { useCallback, useState } from 'react'

export function pad2(value: number) { return String(value).padStart(2, '0') }

export function formatDateKey(arg1: number | Date, month?: number, day?: number): string {
  if (arg1 instanceof Date) return `${pad2(arg1.getUTCFullYear() % 100)}-${pad2(arg1.getUTCMonth() + 1)}-${pad2(arg1.getUTCDate())}`
  return `${pad2(arg1 % 100)}-${pad2(month!)}-${pad2(day!)}`
}

export function toUpperCase(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
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
