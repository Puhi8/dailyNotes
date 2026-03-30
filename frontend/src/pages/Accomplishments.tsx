import { useEffect, useState, type FormEvent } from 'react'
import { api, type AccomplishmentItem } from '../data/api'
import ErrorState from '../components/ErrorState'
import { useObjectState } from '../utils/functions'
import { normalizeAccomplishmentType } from '../data/localCore'

const accomplishmentTypeLabel = (value: string) => (normalizeAccomplishmentType(value) === 'text' ? 'Text' : 'Checkbox')
const moveItem = (list: AccomplishmentItem[], sourceIndex: number, targetIndex: number) => {
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex || targetIndex >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(sourceIndex, 1)
  if (!moved) return list
  next.splice(targetIndex, 0, moved)
  return next
}

type ErrorObjectState = {
  general: string | null
  add: string | null
  action: string | null
  edit: string | null
}

type AccomplishmentFormState = {
  isLoading: boolean
  isAdding: boolean
  newName: string
  newType: string
  editName: string
  editType: string
}

export default function Accomplishments() {
  const [items, setItems] = useState<AccomplishmentItem[]>([])
  const [errors, setErrors] = useObjectState<ErrorObjectState>({ general: null, add: null, action: null, edit: null })
  const [form, setForm] = useObjectState<AccomplishmentFormState>({ isLoading: true, isAdding: false, newName: '', newType: '', editName: '', editType: '' })
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [editingItem, setEditingItem] = useState<AccomplishmentItem | null>(null)
  const [confirmingForceDelete, setConfirmingForceDelete] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [movedMarker, setMovedMarker] = useState<{ id: number; direction: -1 | 1 } | null>(null)

  useEffect(() => {
    if (!editingItem) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setEditingItem(null)
      setConfirmingForceDelete(false)
      setForm({ editName: '', editType: '' })
      setErrors({ edit: null })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingItem, setErrors, setForm])

  useEffect(() => {
    let cancelled = false
    setForm({ isLoading: true })
    setErrors({ general: null })
    api.accomplishments.list()
      .then(result => {
        if (cancelled) return
        setItems(result)
        setErrors({ general: null })
      })
      .catch(err => { if (!cancelled) setErrors({ general: err instanceof Error ? err.message : 'Request failed' }) })
      .finally(() => { if (!cancelled) setForm({ isLoading: false }) })
    return () => { cancelled = true }
  }, [reloadToken])

  useEffect(() => {
    if (!movedMarker) return
    const timer = window.setTimeout(() => setMovedMarker(null), 320)
    return () => window.clearTimeout(timer)
  }, [movedMarker])

  const handleMove = async (sourceIndex: number, direction: -1 | 1) => {
    if (isSavingOrder) return
    const targetIndex = sourceIndex + direction
    const previous = items
    const next = moveItem(previous, sourceIndex, targetIndex)
    if (next === previous) return
    const movedId = previous[sourceIndex]?.id
    if (movedId != null) setMovedMarker({ id: movedId, direction })
    setItems(next)
    setErrors({ action: null })
    setIsSavingOrder(true)
    try { await api.accomplishments.reorder(next.map(item => item.id)) }
    catch (err) {
      setItems(previous)
      setErrors({ action: err instanceof Error ? err.message : 'Failed to reorder accomplishments.' })
    }
    finally { setIsSavingOrder(false) }
  }

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    setErrors({ add: null, action: null })
    const trimmed = form.newName.trim()
    if (!trimmed) {
      setErrors({ add: 'Enter an accomplishment name.' })
      return
    }
    setForm({ isAdding: true })
    try {
      const created = await api.accomplishments.create(trimmed, form.newType)
      setItems(prev => [...prev, created])
      setForm({ newName: '', newType: '' })
    }
    catch (err) { setErrors({ add: err instanceof Error ? err.message : 'Failed to add accomplishment.' }) }
    finally { setForm({ isAdding: false }) }
  }

  const handleOpenEdit = (item: AccomplishmentItem) => {
    setEditingItem(item)
    setConfirmingForceDelete(false)
    setForm({ editName: item.name, editType: normalizeAccomplishmentType(item.type) })
    setErrors({ edit: null })
  }

  const handleCloseEdit = () => {
    setEditingItem(null)
    setConfirmingForceDelete(false)
    setForm({ editName: '', editType: '' })
  }

  const handleSaveEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingItem) return
    const trimmed = form.editName.trim()
    if (!trimmed) {
      setErrors({ edit: 'Enter an accomplishment name.' })
      return
    }
    setPendingId(editingItem.id)
    setErrors({ edit: null, action: null })
    try {
      const updated = await api.accomplishments.rename(editingItem.id, trimmed, form.editType)
      setItems(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      setEditingItem(null)
      setConfirmingForceDelete(false)
      setForm({ editName: '', editType: '' })
    }
    catch (err) { setErrors({ edit: err instanceof Error ? err.message : 'Failed to update accomplishment.', action: null }) }
    finally { setPendingId(null) }
  }

  const handleForceDelete = async () => {
    if (!editingItem) return
    if (!confirmingForceDelete) {
      setConfirmingForceDelete(true)
      setErrors({ edit: null, action: null })
      return
    }
    setPendingId(editingItem.id)
    setErrors({ edit: null, action: null })
    try {
      const result = await api.accomplishments.delete(editingItem.id, { force: true })
      if (result.deleted) setItems(prev => prev.filter(entry => entry.id !== editingItem.id))
      setEditingItem(null)
      setConfirmingForceDelete(false)
      setForm({ editName: '', editType: '' })
    }
    catch (err) { setErrors({ edit: err instanceof Error ? err.message : 'Failed to force delete accomplishment.', action: null }) }
    finally { setPendingId(null) }
  }

  const handleDelete = async (item: AccomplishmentItem) => {
    setPendingId(item.id)
    setErrors({ action: null })
    try {
      const result = await api.accomplishments.delete(item.id)
      if (result.deleted) setItems(prev => prev.filter(entry => entry.id !== item.id))
      else setItems(prev => prev.map(entry => entry.id === item.id
        ? { ...entry, active: result.active, used: true }
        : entry
      ))
    }
    catch (err) { setErrors({ action: err instanceof Error ? err.message : 'Failed to delete accomplishment.' }) }
    finally { setPendingId(null) }
  }

  const handleEnable = async (item: AccomplishmentItem) => {
    setPendingId(item.id)
    setErrors({ action: null })
    try {
      const updated = await api.accomplishments.setActive(item.id, true)
      setItems(prev => prev.map(entry => (entry.id === updated.id ? updated : entry)))
    }
    catch (err) { setErrors({ action: err instanceof Error ? err.message : 'Failed to enable accomplishment.' }) }
    finally { setPendingId(null) }
  }

  const handleToggleOrdering = () => {
    setIsOrdering(previous => !previous)
    setErrors({ action: null })
  }

  if (form.isLoading) return <div className="state">Loading...</div>
  if (errors.general) return <ErrorState error={errors.general} onReload={() => setReloadToken(token => token + 1)} />

  return <div className="page">
    <header className="pageHeader"><h1>Accomplishments</h1></header>
    <section className="panelCard panelStack">
      <div className="panelSection">
        <form className="lockForm" onSubmit={handleAdd}>
          <div className="panelSectionHeader">
            <h2 className="panelTitle">Add new</h2>
            <button className="stateButton" type="submit" disabled={form.isAdding}>{form.isAdding ? 'Adding...' : 'Add'}</button>
          </div>
          <div className="accomplishmentAddFields">
            <input
              className="lockInput"
              type="text"
              value={form.newName}
              placeholder="New accomplishment"
              onChange={event => {
                setForm({ newName: event.target.value })
                setErrors({ add: null })
              }}
            />
            <select
              className="lockInput accomplishmentAddType"
              value={form.newType}
              onChange={event => setForm({ newType: normalizeAccomplishmentType(event.target.value) })}
            >
              <option value="">Checkbox</option>
              <option value="text">Text</option>
            </select>
          </div>
        </form>
        {errors.add && <div className="stateMeta stateMetaError">{errors.add}</div>}
      </div>
      <div className="panelSection">
        <div className="panelSectionHeader">
          <h2 className="panelTitle">Current</h2>
          <button className="stateButton stateButtonSecondary panelInlineButton" type="button" onClick={handleToggleOrdering}>
            {isOrdering ? 'Done' : 'Edit order'}
          </button>
        </div>
        {items.length === 0
          ? <div className="panelEmpty">No accomplishments yet.</div>
          : <div className="editorList">
            {items.map((item, index) => (
              <div
                className={`editorRow${item.active ? '' : ' editorRowInactive'}${movedMarker?.id === item.id ? (movedMarker.direction < 0 ? ' editorRowMovedUp' : ' editorRowMovedDown') : ''}`}
                key={item.id}
              >
                <span className={`editorLabel${item.used ? '' : ' editorLabelUnused'}`}>{item.name}</span>
                <span className="panelRowValue">
                  <span className="accomplishmentMeta">{accomplishmentTypeLabel(item.type)}</span>
                  {isOrdering
                    ? <>
                      <button
                        className="stateButton stateButtonSecondary panelInlineButton"
                        type="button"
                        onClick={() => { void handleMove(index, -1) }}
                        disabled={isSavingOrder || index === 0}
                      >
                        ↑
                      </button>
                      <button
                        className="stateButton stateButtonSecondary panelInlineButton"
                        type="button"
                        onClick={() => { void handleMove(index, 1) }}
                        disabled={isSavingOrder || index === items.length - 1}
                      >
                        ↓
                      </button>
                    </>
                    : <>
                      <button
                        className="stateButton stateButtonSecondary panelInlineButton"
                        type="button"
                        onClick={() => handleOpenEdit(item)}
                        disabled={pendingId === item.id || isSavingOrder}
                      >
                        Edit
                      </button>
                      <button
                        className={`stateButton stateButtonSecondary panelInlineButton accomplishmentButton ${item.active ? 'accomplishmentButtonDanger' : 'accomplishmentButtonEnable'}`}
                        type="button"
                        onClick={() => (item.active ? handleDelete(item) : handleEnable(item))}
                        disabled={pendingId === item.id || isSavingOrder}
                      >
                        {item.active ? (item.used ? 'Disable' : 'Delete') : 'Enable'}
                      </button>
                    </>
                  }
                </span>
              </div>
            ))}
          </div>
        }
        {errors.action && <div className="stateMeta stateMetaError">{errors.action}</div>}
      </div>
    </section>
    {editingItem && <div className="modalBackdrop" role="presentation">
      <div className="stateCard modalCard" role="dialog" aria-modal="true" aria-labelledby="accomplishment-edit-title">
        <h2 id="accomplishment-edit-title">Edit accomplishment</h2>
        <p>Changes apply to new days.</p>
        <form className="lockForm" onSubmit={handleSaveEdit}>
          <div className="accomplishmentEditFields">
            <input
              className="lockInput"
              type="text"
              value={form.editName}
              onChange={event => {
                setForm({ editName: event.target.value })
                setErrors({ edit: null })
              }}
              autoFocus
            />
            <select
              className="lockInput"
              value={form.editType}
              onChange={event => {
                setForm({ editType: normalizeAccomplishmentType(event.target.value) })
                setErrors({ edit: null })
              }}
            >
              <option value="">Checkbox</option>
              <option value="text">Text</option>
            </select>
          </div>
          <div className="lockActions">
            <button className="stateButton" type="submit" disabled={pendingId === editingItem.id}>Save</button>
            <button className="stateButton stateButtonSecondary" type="button" onClick={handleCloseEdit}>Go back</button>
          </div>
        </form>
        <div className="accomplishmentMeta">Danger zone: force delete removes this accomplishment from all days, even when it was used.</div>
        <div className="lockActions">
          <button
            className="stateButton stateButtonSecondary accomplishmentButton accomplishmentButtonDanger"
            type="button"
            onClick={() => { void handleForceDelete() }}
            disabled={pendingId === editingItem.id}
          >
            {confirmingForceDelete ? 'Confirm force delete' : 'Force delete'}
          </button>
          {confirmingForceDelete && <button
            className="stateButton stateButtonSecondary"
            type="button"
            onClick={() => setConfirmingForceDelete(false)}
            disabled={pendingId === editingItem.id}
          >
            Cancel
          </button>}
        </div>
        {errors.edit && <div className="stateMeta stateMetaError">{errors.edit}</div>}
      </div>
    </div>}
  </div>
}
