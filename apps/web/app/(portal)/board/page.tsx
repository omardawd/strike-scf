'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Topbar } from '@/components/portal-shell'
import { useUser } from '@/lib/user-context'
import { useT } from '@/lib/i18n/locale-context'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { FlowBoard } from '@/components/board/FlowBoard'
import { TaskDetailModal } from '@/components/board/TaskDetailModal'
import type { BoardData } from '@/components/board/types'

const VIEW_KEY = 'strike_board_view'

interface TeamMember {
  id: string
  full_name: string
  email: string
}

function NewStageModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await onCreate(name.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 28, width: '100%', maxWidth: 360, boxShadow: 'var(--shadow-elevated)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{t('board.newStage')}</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={60}
            placeholder="Stage name"
            style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14 }}
          />
          {error && <p style={{ color: 'var(--color-red)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius-button)', border: '1.5px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer' }}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={loading} style={{ padding: '9px 20px', borderRadius: 'var(--radius-button)', background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
              {t('board.newStage')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NewTaskModal({
  columns, members, onClose, onCreate,
}: {
  columns: BoardData['columns']
  members: TeamMember[]
  onClose: () => void
  onCreate: (input: { title: string; column_id: string; assignee_user_id: string | null; priority: string; due_date: string | null }) => Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !columnId) return
    setLoading(true)
    setError('')
    try {
      await onCreate({
        title: title.trim(),
        column_id: columnId,
        assignee_user_id: assigneeId || null,
        priority,
        due_date: dueDate || null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 28, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-elevated)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{t('board.newTask')}</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="Task title" style={inputStyle} />
          <select value={columnId} onChange={e => setColumnId(e.target.value)} style={inputStyle}>
            {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} style={inputStyle}>
            <option value="">{t('board.unassigned')}</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 10 }}>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
          </div>
          {error && <p style={{ color: 'var(--color-red)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius-button)', border: '1.5px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer' }}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={loading} style={{ padding: '9px 20px', borderRadius: 'var(--radius-button)', background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
              {t('board.newTask')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function BoardPage() {
  const user = useUser()
  const t = useT()
  const [data, setData] = useState<BoardData | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'kanban' | 'flow'>('kanban')
  const [showNewTask, setShowNewTask] = useState(false)
  const [showNewStage, setShowNewStage] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null
    if (stored === 'kanban' || stored === 'flow') setView(stored)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch {}
  }, [view])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/board')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load board')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/settings/team')
      .then(res => res.json())
      .then(json => setMembers(json.users ?? []))
      .catch(() => {})
  }, [])

  async function handleMoveTask(taskId: string, columnId: string) {
    // Optimistic update — the board should feel instant while dragging.
    setData(prev => prev ? { ...prev, tasks: prev.tasks.map(tk => tk.id === taskId ? { ...tk, column_id: columnId } : tk) } : prev)
    const res = await fetch(`/api/board/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_id: columnId }),
    })
    if (!res.ok) load() // revert to server truth on failure
  }

  async function handleCreateTask(input: { title: string; column_id: string; assignee_user_id: string | null; priority: string; due_date: string | null }) {
    if (!data) return
    const res = await fetch('/api/board/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: data.board.id, ...input }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to create task')
    load()
  }

  async function handleCreateStage(name: string) {
    if (!data) return
    const res = await fetch('/api/board/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: data.board.id, name }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to create stage')
    load()
  }

  async function handleDeleteColumn(columnId: string) {
    const res = await fetch(`/api/board/columns/${columnId}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Failed to delete stage')
      return
    }
    load()
  }

  async function handleMoveColumn(columnId: string, x: number, y: number) {
    await fetch(`/api/board/columns/${columnId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_x: x, position_y: y }),
    })
  }

  async function handleCreateEdge(fromColumnId: string, toColumnId: string) {
    if (!data) return
    const res = await fetch('/api/board/edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: data.board.id, from_column_id: fromColumnId, to_column_id: toColumnId }),
    })
    if (res.ok) load()
  }

  async function handleDeleteEdge(edgeId: string) {
    await fetch(`/api/board/edges/${edgeId}`, { method: 'DELETE' })
    load()
  }

  const aiContext = useMemo(() => {
    if (!data) return {}
    return {
      board_name: data.board.name,
      stages: data.columns.map(c => c.name),
      task_count: data.tasks.length,
      is_admin: data.is_admin,
    }
  }, [data])

  return (
    <>
      <Topbar
        crumbs={[{ label: t('board.title') }]}
        actions={
          <div className="topbar-right" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-button)', overflow: 'hidden' }}>
              {(['kanban', 'flow'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  data-demo-target={`board-view-${v}`}
                  style={{
                    padding: '7px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: view === v ? 'var(--blue)' : 'none',
                    color: view === v ? '#fff' : 'var(--ink)',
                  }}
                >
                  {v === 'kanban' ? t('board.kanbanView') : t('board.flowView')}
                </button>
              ))}
            </div>
            {data?.is_admin && (
              <>
                <button
                  onClick={() => setShowNewStage(true)}
                  style={{
                    border: '1.5px solid var(--border-strong)', background: 'var(--white)', color: 'var(--ink)',
                    borderRadius: 'var(--radius-button)', padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    height: 32, display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  + {t('board.newStage')}
                </button>
                <button className="btn btn-blue btn-sm" onClick={() => setShowNewTask(true)}>
                  + {t('board.newTask')}
                </button>
              </>
            )}
          </div>
        }
      />

      <div
        className="page"
        style={{ maxWidth: 1280 }}
        data-page-name="Board"
        data-ai-context={JSON.stringify(aiContext)}
      >
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {data?.board.name ?? t('board.title')}
          </h1>
          <p className="subtitle">
            {data?.is_admin
              ? 'Design your team\'s workflow and assign work — chat with Strike AI or edit it directly.'
              : 'See where everything stands and what\'s assigned to you.'}
          </p>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-card)', padding: '12px 16px', marginBottom: 20, fontSize: 14, color: '#dc2626' }}>
            {error}
          </div>
        )}

        {loading || !data ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
        ) : view === 'kanban' ? (
          <KanbanBoard
            columns={data.columns}
            tasks={data.tasks}
            isAdmin={data.is_admin}
            currentUserId={user?.id}
            onMoveTask={handleMoveTask}
            onDeleteColumn={handleDeleteColumn}
            onOpenTask={setSelectedTaskId}
          />
        ) : (
          <FlowBoard
            columns={data.columns}
            edges={data.edges}
            tasks={data.tasks}
            isAdmin={data.is_admin}
            onMoveColumn={handleMoveColumn}
            onCreateEdge={handleCreateEdge}
            onDeleteEdge={handleDeleteEdge}
            onOpenTask={setSelectedTaskId}
          />
        )}
      </div>

      {showNewStage && <NewStageModal onClose={() => setShowNewStage(false)} onCreate={handleCreateStage} />}
      {showNewTask && data && (
        <NewTaskModal columns={data.columns} members={members} onClose={() => setShowNewTask(false)} onCreate={handleCreateTask} />
      )}
      {selectedTaskId && data && (
        <TaskDetailModal
          taskId={selectedTaskId}
          columns={data.columns}
          members={members}
          onClose={() => setSelectedTaskId(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
