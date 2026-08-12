'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/locale-context'
import type { BoardColumn, ChecklistItem, TaskComment, TaskDetail } from './types'

interface TeamMember {
  id: string
  full_name: string
  email: string
}

const PANEL_WIDTH = 440

const PRIORITY_COLOR: Record<string, string> = {
  low: 'var(--gray-soft)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
}

// A small, restrained set of pastel accents — enough to tell labels apart
// without turning the panel into a rainbow.
const LABEL_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#B45309']

function labelColor(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]!
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--blue-light)',
      color: 'var(--blue)', fontSize: size * 0.4, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {initials(name)}
    </span>
  )
}

const fieldStyle: React.CSSProperties = {
  fontSize: 13, border: 'none', background: 'transparent', color: 'var(--ink)',
  fontWeight: 600, padding: '2px 0', cursor: 'pointer',
}

export function TaskPanel({
  taskId, boardId, columns, members, defaultColumnId, onClose, onChanged,
}: {
  taskId: string | null
  boardId: string
  columns: BoardColumn[]
  members: TeamMember[]
  defaultColumnId?: string
  onClose: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [shown, setShown] = useState(false)
  const [localTaskId, setLocalTaskId] = useState(taskId)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(!!localTaskId)
  const [error, setError] = useState('')
  const [newChecklistText, setNewChecklistText] = useState('')
  const [newComment, setNewComment] = useState('')
  const [editingTitle, setEditingTitle] = useState(!localTaskId)
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [showLabelInput, setShowLabelInput] = useState(false)

  // Create-mode draft fields (used until the task is first saved)
  const [draftColumnId, setDraftColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? '')
  const [draftAssignee, setDraftAssignee] = useState('')
  const [draftPriority, setDraftPriority] = useState('medium')
  const [draftDueDate, setDraftDueDate] = useState('')
  const [creating, setCreating] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleClose() {
    setShown(false)
    setTimeout(onClose, 240)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/board/tasks/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load task')
      setDetail(json)
      setTitleDraft(json.task.title)
      setDescDraft(json.task.description ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (localTaskId) load(localTaskId)
  }, [localTaskId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!titleDraft.trim() || !draftColumnId) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/board/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: boardId,
          column_id: draftColumnId,
          title: titleDraft.trim(),
          assignee_user_id: draftAssignee || null,
          priority: draftPriority,
          due_date: draftDueDate || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create task')
      onChanged()
      setEditingTitle(false)
      setLocalTaskId(json.task.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setCreating(false)
    }
  }

  async function patchTask(body: Record<string, unknown>) {
    if (!localTaskId) return false
    const res = await fetch(`/api/board/tasks/${localTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { onChanged(); load(localTaskId) }
    return res.ok
  }

  async function handleAddChecklistItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newChecklistText.trim() || !localTaskId) return
    const res = await fetch(`/api/board/tasks/${localTaskId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newChecklistText.trim() }),
    })
    if (res.ok) { setNewChecklistText(''); load(localTaskId) }
  }

  async function handleToggleChecklistItem(item: ChecklistItem) {
    if (!localTaskId) return
    const res = await fetch(`/api/board/tasks/${localTaskId}/checklist/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_done: !item.is_done }),
    })
    if (res.ok) load(localTaskId)
  }

  async function handleDeleteChecklistItem(itemId: string) {
    if (!localTaskId) return
    const res = await fetch(`/api/board/tasks/${localTaskId}/checklist/${itemId}`, { method: 'DELETE' })
    if (res.ok) load(localTaskId)
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() || !localTaskId) return
    const res = await fetch(`/api/board/tasks/${localTaskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newComment.trim() }),
    })
    if (res.ok) { setNewComment(''); load(localTaskId) }
  }

  async function handleDelete() {
    if (!localTaskId || !confirm('Delete this task?')) return
    const res = await fetch(`/api/board/tasks/${localTaskId}`, { method: 'DELETE' })
    if (res.ok) { onChanged(); handleClose() }
  }

  function addLabel(e: React.FormEvent) {
    e.preventDefault()
    if (!detail || !labelDraft.trim()) return
    const next = Array.from(new Set([...detail.task.labels, labelDraft.trim()]))
    setLabelDraft('')
    setShowLabelInput(false)
    patchTask({ labels: next })
  }

  function removeLabel(label: string) {
    if (!detail) return
    patchTask({ labels: detail.task.labels.filter(l => l !== label) })
  }

  const isCreateMode = !localTaskId
  const checkedCount = detail?.checklist_items.filter(i => i.is_done).length ?? 0
  const totalCount = detail?.checklist_items.length ?? 0
  const isAdmin = detail?.is_admin ?? true // create mode is only reachable by admins

  return (
    <>
      {/* Invisible click-catcher — closes the panel without dimming the
          board behind it, so this reads as a docked panel, not a modal. */}
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />

      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: PANEL_WIDTH,
          background: 'var(--white)', borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.07)',
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 240ms var(--ease-out)',
          zIndex: 100, display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <button
            onClick={handleClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray)',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: 4,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4l-6 6 6 6" />
            </svg>
            Close
          </button>
          {!isCreateMode && isAdmin && (
            <button onClick={handleDelete} style={{ border: 'none', background: 'none', color: 'var(--gray-soft)', cursor: 'pointer', fontSize: 12.5 }}>
              Delete
            </button>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>{t('common.loading')}</div>
          ) : (
            <>
              {/* Title */}
              {editingTitle && isAdmin ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (!isCreateMode) {
                      setEditingTitle(false)
                      if (titleDraft.trim() && detail && titleDraft !== detail.task.title) patchTask({ title: titleDraft.trim() })
                    }
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  maxLength={160}
                  placeholder="Task title"
                  style={{
                    fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', border: 'none',
                    borderBottom: '1.5px solid var(--blue)', padding: '4px 0', width: '100%', marginBottom: 18,
                  }}
                />
              ) : (
                <h2
                  onClick={() => isAdmin && setEditingTitle(true)}
                  style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', cursor: isAdmin ? 'text' : 'default', marginBottom: 18, lineHeight: 1.3 }}
                >
                  {detail?.task.title}
                </h2>
              )}

              {/* Meta fields — compact rows, not boxed inputs, for a calmer feel */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 84, fontSize: 12, color: 'var(--gray-soft)' }}>{t('board.priority')}</span>
                  <select
                    value={isCreateMode ? draftPriority : detail?.task.priority}
                    disabled={!isAdmin}
                    onChange={e => isCreateMode ? setDraftPriority(e.target.value) : patchTask({ priority: e.target.value })}
                    style={{ ...fieldStyle, color: PRIORITY_COLOR[isCreateMode ? draftPriority : (detail?.task.priority ?? 'medium')] }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 84, fontSize: 12, color: 'var(--gray-soft)' }}>{t('board.assignTo')}</span>
                  {isAdmin ? (
                    <select
                      value={isCreateMode ? draftAssignee : detail?.task.assignee_user_id ?? ''}
                      onChange={e => isCreateMode ? setDraftAssignee(e.target.value) : patchTask({ assignee_user_id: e.target.value || null })}
                      style={fieldStyle}
                    >
                      <option value="">{t('board.unassigned')}</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  ) : detail?.task.assignee ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                      <Avatar name={detail.task.assignee.full_name} size={18} /> {detail.task.assignee.full_name}
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--gray-soft)' }}>{t('board.unassigned')}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 84, fontSize: 12, color: 'var(--gray-soft)' }}>{t('board.dueDate')}</span>
                  {isAdmin ? (
                    <input
                      type="date"
                      value={isCreateMode ? draftDueDate : detail?.task.due_date ?? ''}
                      onChange={e => isCreateMode ? setDraftDueDate(e.target.value) : patchTask({ due_date: e.target.value || null })}
                      style={fieldStyle}
                    />
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{detail?.task.due_date ? new Date(detail.task.due_date).toLocaleDateString() : '—'}</span>
                  )}
                </div>
                {!isCreateMode && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ width: 84, fontSize: 12, color: 'var(--gray-soft)', paddingTop: 3 }}>Labels</span>
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {detail?.task.labels.map(label => (
                        <span key={label} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
                          padding: '2px 9px', borderRadius: 'var(--radius-badge)',
                          background: `${labelColor(label)}14`, color: labelColor(label),
                        }}>
                          {label}
                          {isAdmin && (
                            <button onClick={() => removeLabel(label)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 10, padding: 0, lineHeight: 1, opacity: 0.7 }}>✕</button>
                          )}
                        </span>
                      ))}
                      {isAdmin && (
                        showLabelInput ? (
                          <form onSubmit={addLabel} style={{ display: 'inline-flex' }}>
                            <input
                              autoFocus
                              value={labelDraft}
                              onChange={e => setLabelDraft(e.target.value)}
                              onBlur={() => !labelDraft.trim() && setShowLabelInput(false)}
                              placeholder="Label name"
                              maxLength={30}
                              style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius-badge)', padding: '3px 10px', width: 90 }}
                            />
                          </form>
                        ) : (
                          <button onClick={() => setShowLabelInput(true)} style={{ fontSize: 11, color: 'var(--gray-soft)', border: '1px dashed var(--border-strong)', background: 'none', borderRadius: 'var(--radius-badge)', padding: '2px 9px', cursor: 'pointer' }}>
                            + Add
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              {isCreateMode ? (
                <>
                  {error && <p style={{ color: 'var(--color-red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
                  <button
                    onClick={handleCreate}
                    disabled={creating || !titleDraft.trim()}
                    className="btn btn-blue"
                    style={{ width: '100%', opacity: creating || !titleDraft.trim() ? 0.6 : 1 }}
                  >
                    {creating ? 'Creating…' : t('board.newTask')}
                  </button>
                </>
              ) : detail && (
                <>
                  {/* Description */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, color: 'var(--gray-soft)', marginBottom: 6 }}>Description</div>
                    {editingDesc && isAdmin ? (
                      <textarea
                        autoFocus
                        value={descDraft}
                        onChange={e => setDescDraft(e.target.value)}
                        onBlur={() => { setEditingDesc(false); if (descDraft !== (detail.task.description ?? '')) patchTask({ description: descDraft || null }) }}
                        rows={3}
                        style={{ width: '100%', fontSize: 13.5, border: '1px solid var(--border)', borderRadius: 8, padding: 10, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    ) : (
                      <p
                        onClick={() => isAdmin && setEditingDesc(true)}
                        style={{ fontSize: 13.5, color: detail.task.description ? 'var(--ink)' : 'var(--gray-soft)', cursor: isAdmin ? 'text' : 'default', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}
                      >
                        {detail.task.description || (isAdmin ? 'Add a description…' : 'No description')}
                      </p>
                    )}
                  </div>

                  {/* Checklist */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--gray-soft)' }}>
                        Checklist {totalCount > 0 && `${checkedCount}/${totalCount}`}
                      </div>
                    </div>
                    {totalCount > 0 && (
                      <div style={{ height: 3, background: 'var(--offwhite)', borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(checkedCount / totalCount) * 100}%`, background: 'var(--color-green)', transition: 'width var(--dur-2) var(--ease-out)' }} />
                      </div>
                    )}
                    {detail.checklist_items.map(item => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                        <input
                          type="checkbox"
                          checked={item.is_done}
                          disabled={!isAdmin && detail.task.assignee_user_id !== detail.current_user_id}
                          onChange={() => handleToggleChecklistItem(item)}
                          style={{ accentColor: 'var(--blue)' }}
                        />
                        <span style={{ fontSize: 13.5, flex: 1, textDecoration: item.is_done ? 'line-through' : 'none', color: item.is_done ? 'var(--gray-soft)' : 'var(--ink)' }}>
                          {item.text}
                        </span>
                        {isAdmin && (
                          <button onClick={() => handleDeleteChecklistItem(item.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray-soft)', fontSize: 12, opacity: 0.6 }}>✕</button>
                        )}
                      </div>
                    ))}
                    {isAdmin && (
                      <form onSubmit={handleAddChecklistItem} style={{ marginTop: 6 }}>
                        <input
                          value={newChecklistText}
                          onChange={e => setNewChecklistText(e.target.value)}
                          placeholder="+ Add checklist item"
                          maxLength={200}
                          style={{ width: '100%', fontSize: 13, border: 'none', borderBottom: '1px solid var(--border)', padding: '6px 0', background: 'transparent' }}
                        />
                      </form>
                    )}
                  </div>

                  {/* Comments + activity */}
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--gray-soft)', marginBottom: 12 }}>Activity</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
                      {detail.comments.map((c: TaskComment) => (
                        <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                          <Avatar name={c.author?.full_name ?? 'System'} size={22} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {c.kind === 'activity' ? (
                              <p style={{ fontSize: 12.5, color: 'var(--gray)' }}>
                                <strong style={{ color: 'var(--ink-soft)' }}>{c.author?.full_name ?? 'Someone'}</strong> {c.body.toLowerCase()} <span style={{ color: 'var(--gray-soft)' }}>· {timeAgo(c.created_at)}</span>
                              </p>
                            ) : (
                              <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                                  {c.author?.full_name ?? 'Unknown'} <span style={{ fontWeight: 400, color: 'var(--gray-soft)' }}>· {timeAgo(c.created_at)}</span>
                                </div>
                                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.body}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {error && !isCreateMode && <p style={{ color: 'var(--color-red)', fontSize: 13, marginTop: 10 }}>{error}</p>}
            </>
          )}
        </div>

        {/* Comment composer pinned to the bottom, like a message thread */}
        {!isCreateMode && !loading && (
          <form onSubmit={handleAddComment} style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Write a comment…"
              maxLength={2000}
              style={{ flex: 1, fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', padding: '9px 14px' }}
            />
            <button type="submit" className="btn btn-blue btn-sm" disabled={!newComment.trim()}>Send</button>
          </form>
        )}
      </div>
    </>
  )
}
