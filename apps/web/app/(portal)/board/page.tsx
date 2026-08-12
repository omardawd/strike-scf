'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Topbar } from '@/components/portal-shell'
import { useUser } from '@/lib/user-context'
import { useT } from '@/lib/i18n/locale-context'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { FlowBoard } from '@/components/board/FlowBoard'
import { TaskPanel } from '@/components/board/TaskPanel'
import type { BoardColumn, BoardData } from '@/components/board/types'

const VIEW_KEY = 'strike_board_view'

interface TeamMember {
  id: string
  full_name: string
  email: string
}

// Small anchored popover — appears right under the button it came from, no
// dark backdrop, closes on outside click. Used for the one-field "new stage"
// action so it never has to feel like a dialog interrupting the page.
function NewStagePopover({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLFormElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [onClose])

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
      setLoading(false)
    }
  }

  return (
    <form
      ref={ref}
      onSubmit={handleSubmit}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
        background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-elevated)', padding: 14, width: 240,
        animation: 'motion-fade var(--dur-2) var(--ease-out) both',
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={60}
        placeholder="Stage name"
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 13.5, marginBottom: 10 }}
      />
      {error && <p style={{ color: 'var(--color-red)', fontSize: 12, marginBottom: 8 }}>{error}</p>}
      <button type="submit" disabled={loading || !name.trim()} className="btn btn-blue btn-sm" style={{ width: '100%', opacity: loading || !name.trim() ? 0.6 : 1 }}>
        {loading ? '…' : t('board.newStage')}
      </button>
    </form>
  )
}

export default function BoardPage() {
  const user = useUser()
  const t = useT()
  const [data, setData] = useState<BoardData | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'kanban' | 'flow'>('kanban')
  const [showNewStage, setShowNewStage] = useState(false)
  // 'new' opens the panel in create mode; a task id opens it for that task.
  const [panelTaskId, setPanelTaskId] = useState<string | 'new' | null>(null)
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

  async function handleReorderColumns(newOrder: BoardColumn[]) {
    // Optimistic update, no full reload — dragging a column should never
    // cause the board to flash/remount.
    setData(prev => prev ? { ...prev, columns: newOrder } : prev)
    const results = await Promise.all(
      newOrder.map((c, i) =>
        fetch(`/api/board/columns/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: i }),
        })
      )
    )
    if (results.some(r => !r.ok)) load() // revert to server truth on failure
  }

  async function handleCreateEdge(fromColumnId: string, toColumnId: string) {
    if (!data) return
    const res = await fetch('/api/board/edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: data.board.id, from_column_id: fromColumnId, to_column_id: toColumnId }),
    })
    if (!res.ok) return
    const json = await res.json()
    // Add the real edge in place — no full board reload, so drawing a
    // connection feels instant instead of flashing the whole canvas.
    setData(prev => prev ? { ...prev, edges: [...prev.edges, json.edge] } : prev)
  }

  async function handleDeleteEdge(edgeId: string) {
    // Optimistic — remove immediately, no reload.
    setData(prev => prev ? { ...prev, edges: prev.edges.filter(e => e.id !== edgeId) } : prev)
    const res = await fetch(`/api/board/edges/${edgeId}`, { method: 'DELETE' })
    if (!res.ok) load() // revert to server truth on failure
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
      <Topbar crumbs={[{ label: t('board.title') }]} />

      <div
        className="page"
        style={{
          maxWidth: '100%', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 56px)',
          boxSizing: 'border-box', padding: '36px 44px 44px',
        }}
        data-page-name="Board"
        data-ai-context={JSON.stringify(aiContext)}
      >
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              {data?.board.name ?? t('board.title')}
            </h1>
            <p className="subtitle">
              {data?.is_admin
                ? 'Design your team\'s workflow and assign work — chat with Strike AI or edit it directly.'
                : 'See where everything stands and what\'s assigned to you.'}
            </p>
          </div>

          {/* Right next to the title, not buried in the topbar — this is
              the board's own primary toolbar. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'relative', flexShrink: 0 }}>
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
                    transition: 'background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)',
                  }}
                >
                  {v === 'kanban' ? t('board.kanbanView') : t('board.flowView')}
                </button>
              ))}
            </div>
            {data?.is_admin && (
              <>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowNewStage(s => !s)}
                    style={{
                      border: '1.5px solid var(--border-strong)', background: 'var(--white)', color: 'var(--ink)',
                      borderRadius: 'var(--radius-button)', padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      height: 32, display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    + {t('board.newStage')}
                  </button>
                  {showNewStage && <NewStagePopover onClose={() => setShowNewStage(false)} onCreate={handleCreateStage} />}
                </div>
                <button className="btn btn-blue btn-sm" onClick={() => setPanelTaskId('new')}>
                  + {t('board.newTask')}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-card)', padding: '12px 16px', marginBottom: 20, fontSize: 14, color: '#dc2626' }}>
            {error}
          </div>
        )}

        {loading || !data ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
        ) : (
          <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="board-halo" />
            <div className="board-ambient" />
            {view === 'kanban' ? (
              <KanbanBoard
                columns={data.columns}
                tasks={data.tasks}
                isAdmin={data.is_admin}
                currentUserId={user?.id}
                onMoveTask={handleMoveTask}
                onDeleteColumn={handleDeleteColumn}
                onOpenTask={setPanelTaskId}
                onReorderColumns={handleReorderColumns}
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
                onOpenTask={setPanelTaskId}
              />
            )}
          </div>
        )}
      </div>

      {panelTaskId && data && (
        <TaskPanel
          taskId={panelTaskId === 'new' ? null : panelTaskId}
          boardId={data.board.id}
          columns={data.columns}
          members={members}
          defaultColumnId={data.columns[0]?.id}
          onClose={() => setPanelTaskId(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
