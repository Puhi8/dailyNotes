export type DayEntry = {
  data: Record<string, string | number | boolean | null>
  percent: number
}

export type GraphData = {
  start: string
  end: string
}

export type IndividualStatData = {
  text: string
  value: string | number
}

export type DayStats = {
  dayCount: number
  stats: IndividualStatData[]
}

export type ServerData = {
  graph: GraphData
  data: Record<string, DayEntry>
  stats: DayStats[]
  yesterday: IndividualStatData[]
}

export type StatusOptions = 'idle' | 'saving' | 'saved'

export type IndividualDay = "today" | "yesterday"
