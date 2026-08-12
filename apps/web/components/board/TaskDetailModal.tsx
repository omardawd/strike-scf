'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/locale-context'
import type { BoardColumn, ChecklistItem, TaskComment, TaskDetail } from './types'

interface TeamMember {
  id: string
  full_name: string
  email: string
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'var(--gray)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
}

const LABEL_PALETTE = ['#1428CC', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#0891B2']

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
      color: 'var(--blue)', fontSize: size * 0.42, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {initials(name)}
    </span>
  )
}

export function TaskDetailModal({
  taskId, columns, members, onClose, onChanged,
}: {
  taskId: string
  columns: BoardColumn[]
  members: TeamMember[]
  onClose: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newChecklistText, setNewChecklistText] = useState('')
  const [newComment, setNewComment] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/board/tasks/${taskId}`)
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

  useEffect(() => { load() }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function patchTask(body: Record<string, unknown>) {
    const res = await fetch(`/api/board/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { onChanged(); load() }
    return res.ok
  }

  async function handleAddChecklistItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newChecklistText.trim()) return
    const res = await fetch(`/api/board/tasks/${taskId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newChecklistText.trim() }),
    })
    if (res.ok) { setNewChecklistText(''); load() }
  }

  async function handleToggleChecklistItem(item: ChecklistItem) {
    const res = await fetch(`/api/board/tasks/${taskId}/checklist/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_done: !item.is_done }),
    })
    if (res.ok) load()
  }

  async function handleDeleteChecklistItem(itemId: string) {
    const res = await fetch(`/api/board/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return
    const res = await fetch(`/api/board/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newComment.trim() }),
    })
    if (res.ok) { setNewComment(''); load() }
  }

  async function handleDelete() {
    if (!confirm('Delete this task?')) return
    const res = await fetch(`/api/board/tasks/${taskId}`, { method: 'DELETE' })
    if (res.ok) { onChanged(); onClose() }
  }

  function addLabel(e: React.FormEvent) {
    e.preventDefault()
    if (!detail || !labelDraft.trim()) return
    const next = Array.from(new Set([...detail.task.labels, labelDraft.trim()]))
    setLabelDraft('')
    patchTask({ labels: next })
  }

  function removeLabel(label: string) {
    if (!detail) return
    patchTask({ labels: detail.task.labels.filter(l => l !== label) })
  }

  const checkedCount = detail?.checklist_items.filter(i => i.is_done).length ?? 0
  const totalCount = detail?.checklist_items.length ?? 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,13,13,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div
        style={{
          background: 'var(--white)', borderRadius: 'var(--radius-card)', width: '100%', maxWidth: 560,
          maxHeight: '86vh', overflowY: 'auto', boxShadow: 'var(--shadow-elevated)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {loading || !detail ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>{t('common.loading')}</div>
        ) : (
          <>
            {/* Header accent bar in the AI-surface gradient — Board is chat-designable */}
            <div style={{ height: 5, background: 'var(--gradient-ai)', borderRadius: 'var(--radius-card) var(--radius-card) 0 0' }} />
            <div style={{ padding: '22px 26px 26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                {editingTitle && detail.is_admin ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={() => { setEditingTitle(false); if (titleDraft.trim() && titleDraft !== detail.task.title) patchTask({ title: titleDraft.trim() }) }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    maxLength={160}
                    style={{ fontSize: 19, fontWeight: 700, border: '1.5px solid var(--blue)', borderRadius: 8, padding: '4px 8px', flex: 1, fontFamily: 'var(--font-display)' }}
                  />
                ) : (
                  <h2
                    onClick={() => detail.is_admin && setEditingTitle(true)}
                    style={{ fontSize: 19, fontWeight: 700, fontFamily: 'var(--font-display)', cursor: detail.is_admin ? 'text' : 'default', flex: 1 }}
                  >
                    {detail.task.title}
                  </h2>
                )}
                <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray-soft)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
              </div>

              {/* Labels */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, alignItems: 'center' }}>
                {detail.task.labels.map(label => (
                  <span key={label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
                    padding: '3px 10px', borderRadius: 'var(--radius-badge)',
                    background: `${labelColor(label)}1A`, color: labelColor(label),
                  }}>
                    {label}
                    {detail.is_admin && (
                      <button onClick={() => removeLabel(label)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                    )}
                  </span>
                ))}
                {detail.is_admin && (
                  <form onSubmit={addLabel} style={{ display: 'inline-flex' }}>
                    <input
                      value={labelDraft}
                      onChange={e => setLabelDraft(e.target.value)}
                      placeholder="+ label"
                      maxLength={30}
                      style={{ fontSize: 11, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-badge)', padding: '3px 10px', width: 72 }}
                    />
                  </form>
                )}
              </div>

              {/* Meta row: priority / assignee / due date */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 18, fontSize: 13 }}>
                <div>
                  <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{t('board.priority')}</div>
                  {detail.is_admin ? (
                    <select
                      value={detail.task.priority}
                      onChange={e => patchTask({ priority: e.target.value })}
                      style={{ fontSize: 13, fontWeight: 600, color: PRIORITY_COLOR[detail.task.priority], border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  ) : (
                    <span style={{ fontWeight: 600, color: PRIORITY_COLOR[detail.task.priority], textTransform: 'capitalize' }}>{detail.task.priority}</span>
                  )}
                </div>
                <div>
                  <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{t('board.assignTo')}</div>
                  {detail.is_admin ? (
                    <select
                      value={detail.task.assignee_user_id ?? ''}
                      onChange={e => patchTask({ assignee_user_id: e.target.value || null })}
                      style={{ fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
                    >
                      <option value="">{t('board.unassigned')}</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  ) : detail.task.assignee ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <Avatar name={detail.task.assignee.full_name} size={18} /> {detail.task.assignee.full_name}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--gray-soft)' }}>{t('board.unassigned')}</span>
                  )}
                </div>
                <div>
                  <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{t('board.dueDate')}</div>
                  {detail.is_admin ? (
                    <input
                      type="date"
                      value={detail.task.due_date ?? ''}
                      onChange={e => patchTask({ due_date: e.target.value || null })}
                      style={{ fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
                    />
                  ) : (
                    <span style={{ fontWeight: 600 }}>{detail.task.due_date ? new Date(detail.task.due_date).toLocaleDateString() : '—'}</span>
                  )}
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Description</div>
                {editingDesc && detail.is_admin ? (
                  <textarea
                    autoFocus
                    value={descDraft}
                    onChange={e => setDescDraft(e.target.value)}
                    onBlur={() => { setEditingDesc(false); if (descDraft !== (detail.task.description ?? '')) patchTask({ description: descDraft || null }) }}
                    rows={3}
                    style={{ width: '100%', fontSize: 13.5, border: '1.5px solid var(--blue)', borderRadius: 8, padding: 8, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                ) : (
                  <p
                    onClick={() => detail.is_admin && setEditingDesc(true)}
                    style={{ fontSize: 13.5, color: detail.task.description ? 'var(--ink)' : 'var(--gray-soft)', cursor: detail.is_admin ? 'text' : 'default', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
                  >
                    {detail.task.description || (detail.is_admin ? 'Add a description…' : 'No description')}
                  </p>
                )}
              </div>

              {/* Checklist */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Checklist {totalCount > 0 && `${checkedCount}/${totalCount}`}
                  </div>
                </div>
                {totalCount > 0 && (
                  <div style={{ height: 4, background: 'var(--offwhite)', borderRadius: 4, marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(checkedCount / totalCount) * 100}%`, background: 'var(--color-green)', transition: 'width var(--dur-2) var(--ease-out)' }} />
                  </div>
                )}
                {detail.checklist_items.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={item.is_done}
                      disabled={!detail.is_admin && detail.task.assignee_user_id !== detail.current_user_id}
                      onChange={() => handleToggleChecklistItem(item)}
                    />
                    <span style={{ fontSize: 13.5, flex: 1, textDecoration: item.is_done ? 'line-through' : 'none', color: item.is_done ? 'var(--gray-soft)' : 'var(--ink)' }}>
                      {item.text}
                    </span>
                    {detail.is_admin && (
                      <button onClick={() => handleDeleteChecklistItem(item.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray-soft)', fontSize: 12 }}>✕</button>
                    )}
                  </div>
                ))}
                {detail.is_admin && (
                  <form onSubmit={handleAddChecklistItem} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      value={newChecklistText}
                      onChange={e => setNewChecklistText(e.target.value)}
                      placeholder="Add checklist item…"
                      maxLength={200}
                      style={{ flex: 1, fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}
                    />
                  </form>
                )}
              </div>

              {/* Comments + activity feed */}
              <div>
                <div style={{ color: 'var(--gray-soft)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Activity</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                  {detail.comments.map((c: TaskComment) => (
                    <div key={c.id} style={{ display: 'flex', gap: 8 }}>
                      <Avatar name={c.author?.full_name ?? 'System'} size={22} />
                      <div style={{ flex: 1 }}>
                        {c.kind === 'activity' ? (
                          <p style={{ fontSize: 12.5, color: 'var(--gray)' }}>
                            <strong style={{ color: 'var(--ink-soft)' }}>{c.author?.full_name ?? 'Someone'}</strong> {c.body.toLowerCase()} · {timeAgo(c.created_at)}
                          </p>
                        ) : (
                          <div style={{ background: 'var(--offwhite)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                              {c.author?.full_name ?? 'Unknown'} <span style={{ fontWeight: 400, color: 'var(--gray-soft)' }}>· {timeAgo(c.created_at)}</span>
                            </div>
                            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleAddComment} style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Write a comment…"
                    maxLength={2000}
                    style={{ flex: 1, fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', padding: '8px 14px' }}
                  />
                  <button type="submit" className="btn btn-blue btn-sm">Send</button>
                </form>
              </div>

              {detail.is_admin && (
                <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={handleDelete} style={{ border: 'none', background: 'none', color: 'var(--color-red)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Delete task
                  </button>
                </div>
              )}

              {error && <p style={{ color: 'var(--color-red)', fontSize: 13, marginTop: 10 }}>{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
