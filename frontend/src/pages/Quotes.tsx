import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import ErrorState from "../components/ErrorState"
import { QuoteCard, QuoteConfirm, QuoteEdit } from "../components/QuoteParts"
import { api, type Quote } from "../data/api"
import { useQuotesEnabled } from "../data/noteSettings"
import { Button, ToggleSwitch } from "../utils/simplifyReact"

type PendingAction = { quote: Quote, action: "edit" | "deny" | "delete" }

const errorText = (err: unknown) => err instanceof Error ? err.message : "Request failed"

export default function Quotes() {
  const quotesEnabled = useQuotesEnabled()
  const [quotes, setQuotes] = useState<Quote[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [showDetails, setShowDetails] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    api.quotes.list()
      .then(result => { if (!cancelled) setQuotes(result) })
      .catch(err => { if (!cancelled) setLoadError(errorText(err)) })
    return () => { cancelled = true }
  }, [reloadToken])

  const runAction = async (action: () => Promise<void>) => {
    setPending(null)
    setActionError(null)
    try {
      await action()
      setQuotes(await api.quotes.list())
    }
    catch (err) { setActionError(errorText(err)) }
  }

  if (!quotesEnabled) return <Navigate to="/" replace />
  if (loadError) return <ErrorState error={loadError} onReload={() => setReloadToken(token => token + 1)} />
  if (!quotes) return <div className="state">Loading...</div>

  const visibleQuotes = showHidden ? quotes : quotes.filter(quote => quote.status === "active")

  return <div className="page">
    <header className="pageHeader"><h1>Quotes</h1></header>
    <section className="panelCard panelStack">
      <div className="panelRow">
        <span>Show description and date</span>
        <span className="panelRowValue panelRowValueToggle">
          <ToggleSwitch ariaLabel="Toggle quote description and date" checked={showDetails} onChange={() => setShowDetails(!showDetails)} />
        </span>
      </div>
      <div className="panelRow">
        <span>Show hidden and denied</span>
        <span className="panelRowValue panelRowValueToggle">
          <ToggleSwitch ariaLabel="Toggle hidden and denied quotes" checked={showHidden} onChange={() => setShowHidden(!showHidden)} />
        </span>
      </div>
      {actionError && <div className="stateMeta stateMetaError">{actionError}</div>}
      {visibleQuotes.length === 0
        ? <div className="panelEmpty">No quotes to show. Write one below the note on the Day page.</div>
        : <div className="quoteList">
          {visibleQuotes.map(quote => <QuoteCard key={quote.id} quote={quote} showDetails={showDetails} linkToNote>
            <div className="quoteActions">
              <Button.secondaryInline onClick={() => setPending({ quote, action: "edit" })}>Edit</Button.secondaryInline>
              {quote.status === "active"
                ? <Button.secondaryInline onClick={() => runAction(() => api.quotes.setStatus(quote.id, "hidden"))}>Hide</Button.secondaryInline>
                : <Button.secondaryInline onClick={() => runAction(() => api.quotes.setStatus(quote.id, "active"))}>Restore</Button.secondaryInline>
              }
              {quote.status !== "denied" && <Button.secondaryInline onClick={() => setPending({ quote, action: "deny" })}>Deny</Button.secondaryInline>}
              <Button.secondaryInline onClick={() => setPending({ quote, action: "delete" })}>Delete</Button.secondaryInline>
            </div>
          </QuoteCard>)}
        </div>
      }
    </section>
    {pending?.action === "edit" && <QuoteEdit
      quote={pending.quote}
      onSave={fields => runAction(() => api.quotes.edit(pending.quote.id, fields))}
      onClose={() => setPending(null)}
    />}
    {pending?.action === "delete" && <QuoteConfirm
      title="Delete this quote?"
      message={pending.quote.text}
      confirmLabel="Delete quote"
      onConfirm={() => runAction(() => api.quotes.delete(pending.quote.id))}
      onClose={() => setPending(null)}
    />}
    {pending?.action === "deny" && <QuoteConfirm
      title="Deny this quote?"
      message={pending.quote.text}
      confirmLabel="Deny quote"
      askReason
      onConfirm={reason => runAction(() => api.quotes.setStatus(pending.quote.id, "denied", reason))}
      onClose={() => setPending(null)}
    />}
  </div>
}
