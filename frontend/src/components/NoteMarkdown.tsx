import { type ReactNode } from 'react'

type NoteMarkdownProps = { text: string }

const isHeading = (line: string) => /^(#{1,3})\s+/.test(line)
const isUnordered = (line: string) => /^\s*[-*]\s+/.test(line)
const isOrdered = (line: string) => /^\s*\d+\.\s+/.test(line)

const stripHeading = (line: string) => line.replace(/^(#{1,3})\s+/, '').trim()
const stripUnordered = (line: string) => line.replace(/^\s*[-*]\s+/, '').trim()
const stripOrdered = (line: string) => line.replace(/^\s*\d+\.\s+/, '').trim()

const renderParagraphLines = (lines: string[], keyPrefix: string) => (
  lines.map((line, index) => <span className="noteMarkdownLine" key={`${keyPrefix}-${index}`}>{line.trim()}</span>)
)

export default function NoteMarkdown({ text }: NoteMarkdownProps) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    if (isHeading(line)) {
      const match = line.match(/^(#{1,3})\s+/)
      const level = match ? match[1].length : 1
      const content = stripHeading(line)
      if (content !== '') blocks.push(
        level === 1
          ? <h2 key={`h-${index}`}>{content}</h2>
          : level === 2
            ? <h3 key={`h-${index}`}>{content}</h3>
            : <h4 key={`h-${index}`}>{content}</h4>
      )
      index += 1
      continue
    }

    if (isUnordered(line)) {
      const items: string[] = []
      while (index < lines.length && isUnordered(lines[index])) {
        const item = stripUnordered(lines[index])
        if (item !== '') items.push(item)
        index += 1
      }
      if (items.length > 0) blocks.push(<ul key={`ul-${index}`}>
        {items.map((item, itemIndex) => <li key={`ul-${index}-${itemIndex}`}>{item}</li>)}
      </ul>)
      continue
    }

    if (isOrdered(line)) {
      const items: string[] = []
      while (index < lines.length && isOrdered(lines[index])) {
        const item = stripOrdered(lines[index])
        if (item !== '') items.push(item)
        index += 1
      }
      if (items.length > 0) blocks.push(<ol key={`ol-${index}`}>
        {items.map((item, itemIndex) => <li key={`ol-${index}-${itemIndex}`}>{item}</li>)}
      </ol>)
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const currentLine = lines[index]
      if (currentLine.trim() === '' || isHeading(currentLine) || isUnordered(currentLine) || isOrdered(currentLine)) break
      paragraphLines.push(currentLine)
      index += 1
    }
    if (paragraphLines.length > 0) blocks.push(<p key={`p-${index}`}>
      {renderParagraphLines(paragraphLines, `p-${index}`)}
    </p>)
  }
  return <div className="noteMarkdown">{blocks}</div>
}
