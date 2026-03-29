import { manageLocalStorage } from "../utils/localProcessing"

const GRAPH_COMPACTNESS_KEY = 'dailynotes.graphCompactness'

export const GRAPH_COMPACTNESS_MIN = 1
export const GRAPH_COMPACTNESS_MAX = 15
export const GRAPH_COMPACTNESS_DEFAULT = 8

const clampCompactness = (value: number) => Math.min(GRAPH_COMPACTNESS_MAX, Math.max(GRAPH_COMPACTNESS_MIN, value))

export const getGraphCompactness = () => {
  if (typeof window === 'undefined') return GRAPH_COMPACTNESS_DEFAULT
  const raw = manageLocalStorage.get(GRAPH_COMPACTNESS_KEY, null)
  if (!raw) return GRAPH_COMPACTNESS_DEFAULT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return GRAPH_COMPACTNESS_DEFAULT
  return clampCompactness(parsed)
}

export const setGraphCompactness = (value: number) => {
  if (typeof window === 'undefined') return GRAPH_COMPACTNESS_DEFAULT
  const normalized = clampCompactness(value)
  manageLocalStorage.set({ key: GRAPH_COMPACTNESS_KEY, value: String(normalized) })
  return normalized
}

export const calculateGraphPointLimit = (width: number, compactness: number) => {
  if (!Number.isFinite(width) || width <= 0) return 0
  const ratio = 1 - (clampCompactness(compactness) - GRAPH_COMPACTNESS_MIN) / (GRAPH_COMPACTNESS_MAX - GRAPH_COMPACTNESS_MIN)
  const maxSpacing = 40
  const minSpacing = 8
  const spacing = maxSpacing - (maxSpacing - minSpacing) * ratio
  return Math.max(7, Math.floor(width / spacing))
}
