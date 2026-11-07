export type QuoteStatus = "active" | "hidden" | "denied"

export type Quote = {
  id: string
  text: string
  note: string
  date: string
  addedAt: string
  updatedAt: string
  status: QuoteStatus
  deniedReason: string
}

export type QuoteFields = Pick<Quote, "text" | "note">
export type QuoteBlock = QuoteFields & { start: number, end: number }

type OpenBlock = { textLines: string[], noteLines: string[], start: number, end: number }

const QUOTE_MARK = ">"
const NOTE_MARK = "--"
const QUOTE_TEMPLATE = `${QUOTE_MARK} \n${NOTE_MARK} `
const isNoteLine = (line: string) => /^--(\s|$)/.test(line)
const joinLines = (lines: string[]) => lines.filter(Boolean).join("\n")
// Same shape the day input parses to, so an edited quote still counts as unchanged there.
export const cleanQuoteField = (value: string) => joinLines(value.split("\n").map(line => line.trim()))

export const parseQuoteBlocks = (source: string) => {
  const blocks: QuoteBlock[] = []
  let hasIgnoredText = false
  let open: OpenBlock | null = null
  const finish = (block: OpenBlock) => {
    const text = joinLines(block.textLines)
    const note = joinLines(block.noteLines)
    if (text) blocks.push({ text, note, start: block.start, end: block.end })
    else if (note) hasIgnoredText = true
  }

  let lineStart = 0
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim()
    const lineEnd = lineStart + rawLine.length
    if (line.startsWith(QUOTE_MARK)) {
      // A quote line after a note line starts the next quote.
      if (open && open.noteLines.length > 0) {
        finish(open)
        open = null
      }
      open ??= { textLines: [], noteLines: [], start: lineStart, end: lineEnd }
      open.textLines.push(line.slice(QUOTE_MARK.length).trim())
      open.end = lineEnd
    }
    else if (isNoteLine(line)) {
      const note = line.slice(NOTE_MARK.length).trim()
      if (open) {
        open.noteLines.push(note)
        open.end = lineEnd
      }
      else if (note) hasIgnoredText = true
    }
    else {
      if (open) finish(open)
      open = null
      if (line) hasIgnoredText = true
    }
    lineStart = lineEnd + 1
  }
  if (open) finish(open)
  return { blocks, hasIgnoredText }
}

const markLines = (mark: string, value: string) => value.split("\n").map(line => `${mark} ${line}`)

// Always writes the note line, so a saved quote can get a note later without typing the mark.
export const serializeQuotes = (quotes: QuoteFields[]) => quotes
  .map(quote => [...markLines(QUOTE_MARK, quote.text), ...markLines(NOTE_MARK, quote.note)].join("\n"))
  .join("\n\n")

export const appendQuoteTemplate = (source: string) => {
  const base = source.replace(/\n+$/, "")
  const prefix = base ? `${base}\n\n` : ""
  return { text: `${prefix}${QUOTE_TEMPLATE}`, cursor: prefix.length + QUOTE_MARK.length + 1 }
}

export const removeQuoteBlock = (source: string, block: QuoteBlock) => `${source.slice(0, block.start)}${source.slice(block.end)}`
  .replace(/\n{3,}/g, "\n\n")
  .replace(/^\n+|\n+$/g, "")

// randomUUID only exists on HTTPS, and a self-hosted server can run on plain HTTP.
const makeQuoteId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")

export const isDayQuote = (quote: Quote, date: string) => quote.date === date && quote.status === "active"

// Unchanged text keeps its quote; what is left over counts as edited in order, so typing a quote out does not reset its logged time.
export const reconcileDayQuotes = (quotes: Quote[], date: string, fields: QuoteFields[], now: string) => {
  const unmatched = quotes.filter(quote => isDayQuote(quote, date))
  const exactMatches = fields.map(item => {
    const index = unmatched.findIndex(quote => quote.text === item.text)
    return index < 0 ? null : unmatched.splice(index, 1)[0]
  })
  const dayQuotes = fields.map((item, index): Quote => {
    const existing = exactMatches[index] ?? unmatched.shift()
    if (!existing) return { id: makeQuoteId(), text: item.text, note: item.note, date, addedAt: now, updatedAt: now, status: "active", deniedReason: "" }
    return existing.text === item.text && existing.note === item.note ? existing : { ...existing, text: item.text, note: item.note, updatedAt: now }
  })
  return [...quotes.filter(quote => !isDayQuote(quote, date)), ...dayQuotes]
}

const normalizeQuote = (raw: unknown): Quote | null => {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const id = String(item.id ?? "").trim()
  const text = String(item.text ?? "").trim()
  const date = String(item.date ?? "").trim()
  const addedAt = String(item.addedAt ?? "")
  if (!id || !text || !date || Number.isNaN(Date.parse(addedAt))) return null
  const updatedAt = String(item.updatedAt ?? "")
  const status = item.status === "hidden" || item.status === "denied" ? item.status : "active"
  return {
    id,
    text,
    note: String(item.note ?? "").trim(),
    date,
    addedAt,
    updatedAt: Number.isNaN(Date.parse(updatedAt)) ? addedAt : updatedAt,
    status,
    deniedReason: status === "denied" ? String(item.deniedReason ?? "").trim() : ""
  }
}

export const normalizeQuotes = (raw: unknown) => {
  const byId = new Map<string, Quote>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const quote = normalizeQuote(item)
    if (quote && !byId.has(quote.id)) byId.set(quote.id, quote)
  }
  return [...byId.values()]
}

// Leaves out updatedAt: an edit that was undone is still the same quote.
export const quoteEquals = (left: Quote, right: Quote) => (["text", "note", "date", "addedAt", "status", "deniedReason"] as const)
  .every(field => left[field] === right[field])

// On the same id the latest change wins. ISO times in UTC sort as plain text.
export const joinQuotes = (local: Quote[], remote: Quote[]) => {
  const byId = new Map(remote.map(quote => [quote.id, quote]))
  for (const quote of local) {
    const other = byId.get(quote.id)
    if (!other || quote.updatedAt > other.updatedAt) byId.set(quote.id, quote)
  }
  return [...byId.values()]
}
