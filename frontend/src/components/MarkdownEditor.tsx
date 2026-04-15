import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { getNoteHeaderColors } from '../data/noteSettings'

type MarkdownEditorProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'contentEditable' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  colorHeadings?: boolean
}

type Cursor = { start: number; end: number }
type Rule = { className: string; pattern: RegExp }

const rules: Rule[] = [
  { className: 'mdCodeBlock', pattern: /```[^\n]*\n[\s\S]*?\n```/y },
  { className: 'mdCodeBlock', pattern: /~~~[^\n]*\n[\s\S]*?\n~~~/y },
  { className: 'mdHeading1', pattern: /^#[ \t]+[^\n]*/my },
  { className: 'mdHeading2', pattern: /^##[ \t]+[^\n]*/my },
  { className: 'mdHeading3', pattern: /^###[ \t]+[^\n]*/my },
  { className: 'mdHeading4', pattern: /^####[ \t]+[^\n]*/my },
  { className: 'mdCode', pattern: /`[^`\n]+`/y },
  { className: 'mdStrong', pattern: /\*\*[^*\n]+?\*\*/y },
  { className: 'mdStrong', pattern: /__[^_\n]+?__/y },
  { className: 'mdStrike', pattern: /~~[^~\n]+?~~/y },
  { className: 'mdEmphasis', pattern: /\*[^*\n]+?\*/y },
  { className: 'mdEmphasis', pattern: /_[^_\n]+?_/y },
  { className: 'mdUrl', pattern: /https?:\/\/[^\s<>(){}"'`]+/y },
]

const nextPlainTextEnd = (text: string, start: number) => {
  const next = text.slice(start + 1).search(/[`~*_#h]/)
  return next === -1 ? text.length : start + next + 1
}

const appendVisibleText = (parent: Node, text: string) => {
  const parts = text.split('\n')
  parts.forEach((part, index) => {
    if (part) parent.appendChild(document.createTextNode(part))
    if (index === parts.length - 1) return
    parent.appendChild(document.createTextNode('\n'))
    const gap = document.createElement('span')
    gap.className = 'mdLineGap'
    gap.setAttribute('aria-hidden', 'true')
    parent.appendChild(gap)
  })
}

const styledNode = (className: string, text: string) => {
  const node = document.createElement('span')
  node.className = className
  appendVisibleText(node, text)
  return node
}

const markdownFragment = (text: string) => {
  const fragment = document.createDocumentFragment()
  let index = 0

  while (index < text.length) {
    let match: { className: string; token: string } | null = null
    for (const rule of rules) {
      rule.pattern.lastIndex = index
      const result = rule.pattern.exec(text)
      if (result?.index !== index) continue
      match = { className: rule.className, token: result[0] }
      break
    }

    if (match) {
      fragment.appendChild(styledNode(match.className, match.token))
      index += match.token.length
      continue
    }

    const end = nextPlainTextEnd(text, index)
    appendVisibleText(fragment, text.slice(index, end))
    index = end
  }

  return fragment
}

const textOffset = (root: HTMLElement, node: Node, offset: number) => {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

const saveCursor = (root: HTMLElement): Cursor | null => {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  return {
    start: textOffset(root, range.startContainer, range.startOffset),
    end: textOffset(root, range.endContainer, range.endOffset),
  }
}

const nodeAtOffset = (root: HTMLElement, offset: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    node = walker.nextNode()
  }
  return { node: root, offset: root.childNodes.length }
}

const restoreCursor = (root: HTMLElement, cursor: Cursor) => {
  const selection = window.getSelection()
  if (!selection) return
  const start = nodeAtOffset(root, cursor.start)
  const end = nodeAtOffset(root, cursor.end)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

const highlight = (root: HTMLElement, keepCursor: boolean) => {
  const cursor = keepCursor ? saveCursor(root) : null
  const topBefore = keepCursor ? root.getBoundingClientRect().top : null
  const text = root.textContent ?? ''
  root.replaceChildren(markdownFragment(text))
  root.normalize()
  if (cursor) restoreCursor(root, cursor)
  if (topBefore != null) window.scrollBy(0, root.getBoundingClientRect().top - topBefore)
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
  const { className, colorHeadings = getNoteHeaderColors(), onChange, placeholder, value, ...rest } = props
  const editorRef = useRef<HTMLDivElement | null>(null)
  const highlightFrameRef = useRef<number | null>(null)
  const scheduleHighlight = (editor: HTMLElement) => {
    if (highlightFrameRef.current != null) window.cancelAnimationFrame(highlightFrameRef.current)
    highlightFrameRef.current = window.requestAnimationFrame(() => {
      highlightFrameRef.current = null
      highlight(editor, document.activeElement === editor)
    })
  }

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.textContent === value) return
    if (highlightFrameRef.current != null) {
      window.cancelAnimationFrame(highlightFrameRef.current)
      highlightFrameRef.current = null
    }
    editor.textContent = value
    highlight(editor, false)
  }, [value])

  useLayoutEffect(() => {
    return () => { if (highlightFrameRef.current != null) window.cancelAnimationFrame(highlightFrameRef.current) }
  }, [])

  return <div
    {...rest}
    ref={editorRef}
    className={['markdownEditor', colorHeadings ? 'markdownEditorColorHeadings' : null, className].filter(Boolean).join(' ')}
    contentEditable="plaintext-only"
    data-placeholder={placeholder}
    role="textbox"
    aria-multiline="true"
    spellCheck
    suppressContentEditableWarning
    onInput={event => {
      rest.onInput?.(event)
      onChange(event.currentTarget.textContent ?? '')
      scheduleHighlight(event.currentTarget)
    }}
    onBlur={event => {
      rest.onBlur?.(event)
      if (highlightFrameRef.current != null) {
        window.cancelAnimationFrame(highlightFrameRef.current)
        highlightFrameRef.current = null
      }
      highlight(event.currentTarget, false)
    }}
  />
}
