import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MarkdownEditor, { nodeAtOffset, restoreCursor } from "./MarkdownEditor"
import { QuoteConfirm } from "./QuoteParts"
import { api } from "../data/api"
import { appendQuoteTemplate, parseQuoteBlocks, removeQuoteBlock, serializeQuotes, type QuoteBlock } from "../data/quotes"
import { Button } from "../utils/simplifyReact"

const AUTOSAVE_DEBOUNCE_MS = 700
const errorText = (err: unknown) => err instanceof Error ? err.message : "Failed to save quotes."

// The range starts on the quote mark; a range starting between two text nodes also covers the line before, so the last box is the mark.
const lineTop = (editor: HTMLElement, offset: number) => {
  const start = nodeAtOffset(editor, offset)
  const end = nodeAtOffset(editor, offset + 1)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return [...range.getClientRects()].at(-1)?.top ?? 0
}

export default function QuoteInput({ date }: { date: string }) {
  const [text, setText] = useState<string | null>(null)
  const [buttonTops, setButtonTops] = useState<number[]>([])
  const [removing, setRemoving] = useState<QuoteBlock | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef("")
  const savedTextRef = useRef("")
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const { blocks, hasIgnoredText } = useMemo(() => parseQuoteBlocks(text ?? ""), [text])

  const changeText = (next: string) => {
    textRef.current = next
    setText(next)
  }

  const save = useCallback(() => {
    if (textRef.current === savedTextRef.current) return
    savedTextRef.current = textRef.current
    setError(null)
    api.quotes.saveForDay(date, parseQuoteBlocks(textRef.current).blocks).catch(err => setError(errorText(err)))
  }, [date])

  useEffect(() => {
    let cancelled = false
    api.quotes.listForDay(date)
      .then(quotes => {
        if (cancelled) return
        const loaded = serializeQuotes(quotes)
        savedTextRef.current = loaded
        changeText(loaded)
      })
      .catch(err => { if (!cancelled) setError(errorText(err)) })
    return () => {
      cancelled = true
      // Leaving the page right after an edit must not drop it.
      save()
    }
  }, [date, save])

  useEffect(() => {
    const timer = window.setTimeout(save, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, save])

  const editor = () => fieldRef.current?.querySelector<HTMLElement>(".markdownEditor") ?? null

  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field) return
    const measure = () => {
      const element = editor()
      if (!element) return
      const editorTop = element.getBoundingClientRect().top
      setButtonTops(blocks.map(block => lineTop(element, block.start) - editorTop))
    }
    // A frame later: the editor restyles its text in a frame of its own, which can move lines.
    const frame = window.requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(field)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [blocks])

  // After the editor's own layout effect has put the new text in.
  useLayoutEffect(() => {
    const element = editor()
    const cursor = pendingCursorRef.current
    if (!element || cursor == null) return
    pendingCursorRef.current = null
    element.focus()
    restoreCursor(element, { start: cursor, end: cursor })
  }, [text])

  const addQuote = () => {
    const { text: nextText, cursor } = appendQuoteTemplate(textRef.current)
    pendingCursorRef.current = cursor
    changeText(nextText)
  }

  const confirmRemove = () => {
    if (removing) changeText(removeQuoteBlock(textRef.current, removing))
    setRemoving(null)
  }

  if (text === null) return error ? <div className="stateMeta stateMetaError">{error}</div> : null

  return <div className="panelSection noteInputSection">
    <div className="panelSectionHeader">
      <h2 className="panelTitle">Quotes (.md)</h2>
      <Button.secondaryInline onClick={addQuote}>Add quote</Button.secondaryInline>
    </div>
    <div className="quoteField" ref={fieldRef}>
      <MarkdownEditor
        className="noteMarkdownEditor"
        aria-label="Quotes"
        value={text}
        placeholder={"Use Add quote, or write:\n> the quote\n-- an extra note"}
        onChange={changeText}
      />
      {blocks.map((block, index) => buttonTops[index] != null && <button
        key={block.start}
        type="button"
        className="quoteRemove"
        style={{ top: buttonTops[index] }}
        aria-label={`Remove quote: ${block.text}`}
        onClick={() => setRemoving(block)}
      >
        ×
      </button>)}
    </div>
    {hasIgnoredText && <p className="panelHint">Only lines starting with &gt; (quote) or -- (extra note) are saved.</p>}
    {error && <div className="stateMeta stateMetaError">{error}</div>}
    {removing && <QuoteConfirm
      title="Remove this quote?"
      message={removing.text}
      confirmLabel="Remove quote"
      onConfirm={confirmRemove}
      onClose={() => setRemoving(null)}
    />}
  </div>
}
