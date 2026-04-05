import { manageLocalStorage } from '../utils/localProcessing'

const ACCENT_COLOR_KEY = 'dailynotes.accentColor'

export const DEFAULT_ACCENT_COLOR = '#2fb890'

type RgbColor = {
  r: number
  g: number
  b: number
}

const SHORT_HEX_PATTERN = /^#?([\da-f]{3})$/i
const FULL_HEX_PATTERN = /^#?([\da-f]{6})$/i

export const normalizeAccentColor = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim()
  const shortHexMatch = trimmed.match(SHORT_HEX_PATTERN)
  if (shortHexMatch?.[1]) {
    const [r, g, b] = shortHexMatch[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const fullHexMatch = trimmed.match(FULL_HEX_PATTERN)
  return fullHexMatch?.[1] ? `#${fullHexMatch[1].toLowerCase()}` : DEFAULT_ACCENT_COLOR
}

const hexToRgb = (hex: string): RgbColor => {
  const normalized = normalizeAccentColor(hex).slice(1)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

export const getAccentColor = () => {
  if (typeof window === 'undefined') return DEFAULT_ACCENT_COLOR
  const stored = manageLocalStorage.get(ACCENT_COLOR_KEY, DEFAULT_ACCENT_COLOR)
  const normalized = normalizeAccentColor(stored)
  if (stored !== normalized) manageLocalStorage.set({ key: ACCENT_COLOR_KEY, value: normalized })
  return normalized
}

export const getAccentColorRgb = () => hexToRgb(getAccentColor())

export const applyAccentColor = (value = getAccentColor()) => {
  const normalized = normalizeAccentColor(value)
  if (typeof document !== 'undefined') {
    const { r, g, b } = hexToRgb(normalized)
    const root = document.documentElement
    root.style.setProperty('--accent', normalized)
    root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`)
    root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.2)`)
    root.style.setProperty('--accent-soft-bg', `rgba(${r}, ${g}, ${b}, 0.28)`)
    root.style.setProperty('--accent-surface', `rgba(${r}, ${g}, ${b}, 0.12)`)
    root.style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.7)`)
  }
  return normalized
}

const setAccentColor = (value: string) => {
  const normalized = normalizeAccentColor(value)
  if (typeof window !== 'undefined') manageLocalStorage.set({ key: ACCENT_COLOR_KEY, value: normalized })
  return applyAccentColor(normalized)
}

const resetAccentColor = () => {
  if (typeof window !== 'undefined') manageLocalStorage.remove(ACCENT_COLOR_KEY)
  return applyAccentColor(DEFAULT_ACCENT_COLOR)
}

export default {
  settings: {
    accent: {
      get: getAccentColor,
      set: setAccentColor,
      reset: resetAccentColor,
      apply: applyAccentColor,
    }
  },
  colors: {
    accent: getAccentColor,
    accentRgb: getAccentColorRgb,
  }
} as const
