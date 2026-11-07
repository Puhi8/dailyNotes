import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import type { Quote, QuoteStatus } from "../data/api"
import type { QuoteFields } from "../data/quotes"
import { makeDayKey, pad2 } from "../utils/functions"
import { registerCloseOnBack } from "../utils/hardwareBack"
import { Button, LockInput, ModalShell } from "../utils/simplifyReact"

const quoteTextClass: Record<QuoteStatus, string> = {
  active: "quoteText",
  hidden: "quoteText quoteTextHidden",
  denied: "quoteText quoteTextDenied"
}

const formatLoggedTime = (time: string) => {
  const date = new Date(time)
  return `${makeDayKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

type QuoteCardProps = {
  quote: Quote
  showDetails: boolean
  linkToNote?: boolean
  children?: ReactNode
}

export const QuoteCard = ({ quote, showDetails, linkToNote, children }: QuoteCardProps) => <article className="quoteItem">
  <p className={quoteTextClass[quote.status]}>{quote.text}</p>
  {quote.status === "denied" && <p className="quoteMeta">Not valid: {quote.deniedReason}</p>}
  {showDetails && <>
    {quote.note && <p className="quoteNote">{quote.note}</p>}
    <p className="quoteMeta">
      {linkToNote && <><Link to={`/notes/${quote.date}`}>{quote.date}</Link> · </>}
      Added {formatLoggedTime(quote.addedAt)}
      {formatLoggedTime(quote.updatedAt) !== formatLoggedTime(quote.addedAt) && <> · Changed {formatLoggedTime(quote.updatedAt)}</>}
    </p>
    {children}
  </>}
</article>

type QuoteEditProps = {
  quote: Quote
  onSave: (fields: QuoteFields) => void
  onClose: () => void
}

export function QuoteEdit({ quote, onSave, onClose }: QuoteEditProps) {
  const [text, setText] = useState(quote.text)
  const [note, setNote] = useState(quote.note)
  useEffect(() => registerCloseOnBack(onClose), [onClose])

  return <ModalShell titleId="quote-edit-title">
    <h2 id="quote-edit-title">Edit quote</h2>
    <label className="panelLabel" htmlFor="quote-edit-text">Quote</label>
    <textarea id="quote-edit-text" className="lockInput quoteEditField" rows={4} value={text} onChange={event => setText(event.target.value)} autoFocus />
    <label className="panelLabel" htmlFor="quote-edit-note">Extra note</label>
    <textarea id="quote-edit-note" className="lockInput quoteEditField" rows={3} value={note} onChange={event => setNote(event.target.value)} />
    <div className="lockActions">
      <Button.primary disabled={!text.trim()} onClick={() => onSave({ text, note })}>Save quote</Button.primary>
      <Button.secondary onClick={onClose}>Go back</Button.secondary>
    </div>
  </ModalShell>
}

type QuoteConfirmProps = {
  title: string
  message: string
  confirmLabel: string
  askReason?: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}

export function QuoteConfirm({ title, message, confirmLabel, askReason, onConfirm, onClose }: QuoteConfirmProps) {
  const [reason, setReason] = useState("")
  useEffect(() => registerCloseOnBack(onClose), [onClose])

  return <ModalShell titleId="quote-confirm-title">
    <h2 id="quote-confirm-title">{title}</h2>
    <p className="quoteConfirmText">{message}</p>
    {askReason && <LockInput.text
      placeholder="Why is it not valid anymore?"
      value={reason}
      onChange={event => setReason(event.target.value)}
      autoFocus
    />}
    <div className="lockActions">
      <Button.primary disabled={askReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button.primary>
      <Button.secondary onClick={onClose}>Go back</Button.secondary>
    </div>
  </ModalShell>
}
