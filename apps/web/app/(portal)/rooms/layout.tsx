'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealSummary {
  id: string
  status: string
  total_value: number | null
  agreed_currency: string
  counterparty_name: string
}

interface PanelRoom {
  id: string
  name: string
  room_type: 'public' | 'private'
  status: string
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  deal?: DealSummary | null
}

const CATEGORIES = [
  'Steel Trading',
  'Textile & Apparel',
  'Electronics',
  'Agricultural',
  'Chemicals',
  'Logistics',
  'General Trade Finance',
]

const COLLAPSE_KEY = 'strike_rooms_nav_collapsed'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(ts: string | null): string {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Conversation panel ───────────────────────────────────────────────────────

function ConversationPanel({
  rooms,
  loading,
  activeId,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onNewRoom,
}: {
  rooms: PanelRoom[]
  loading: boolean
  activeId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onNavigate: (id: string) => void
  onNewRoom: () => void
}) {
  const publicRooms = rooms.filter(r => r.room_type === 'public')
  const privateRooms = rooms.filter(r => r.room_type === 'private')

  if (collapsed) {
    return (
      <div className="rooms-nav rooms-nav-collapsed">
        <button
          className="rooms-nav-collapse-btn"
          title="Expand conversations"
          onClick={onToggleCollapse}
          aria-label="Expand conversations"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        <button
          className="rooms-nav-collapse-new"
          title="New room"
          onClick={onNewRoom}
          aria-label="New room"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
    )
  }

  const renderItem = (room: PanelRoom) => {
    const isActive = room.id === activeId
    const title = room.deal?.counterparty_name
      ? `${room.name} · ${room.deal.counterparty_name}`
      : room.name
    return (
      <button
        key={room.id}
        className={`rooms-nav-item${isActive ? ' rooms-nav-item-active' : ''}`}
        onClick={() => onNavigate(room.id)}
        title={title}
      >
        <div className="rooms-nav-item-top">
          <span className="rooms-nav-item-name">{room.name}</span>
          <span className="rooms-nav-item-time">{fmtRelative(room.last_message_at)}</span>
        </div>
        <div className="rooms-nav-item-bottom">
          <span className="rooms-nav-item-preview">
            {room.last_message_preview || 'No messages yet'}
          </span>
          {room.unread_count > 0 && (
            <span className="rooms-nav-unread">{room.unread_count > 99 ? '99+' : room.unread_count}</span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="rooms-nav">
      <div className="rooms-nav-header">
        <span className="rooms-nav-title">Rooms</span>
        <div className="rooms-nav-header-actions">
          <button
            className="rooms-nav-newbtn"
            onClick={onNewRoom}
            title="New room"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New Room
          </button>
          <button
            className="rooms-nav-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse conversations"
            aria-label="Collapse conversations"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="rooms-nav-scroll">
        {loading ? (
          <div className="rooms-nav-loading">
            {[1, 2, 3].map(i => <div key={i} className="rooms-nav-skeleton" />)}
          </div>
        ) : rooms.length === 0 ? (
          <div className="rooms-nav-empty">
            <p className="rooms-nav-empty-text">No conversations yet.</p>
            <button className="rooms-nav-empty-btn" onClick={onNewRoom}>+ New Room</button>
          </div>
        ) : (
          <>
            {publicRooms.length > 0 && (
              <div className="rooms-nav-section">
                <span className="rooms-nav-section-label">Public</span>
                {publicRooms.map(renderItem)}
              </div>
            )}
            {privateRooms.length > 0 && (
              <div className="rooms-nav-section">
                <span className="rooms-nav-section-label">Private</span>
                {privateRooms.map(renderItem)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── New room modal ───────────────────────────────────────────────────────────

function NewRoomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (room: PanelRoom) => void
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0]!)
  const [rules, setRules] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: category || undefined,
          rules: rules.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create room')
        return
      }
      onCreated({
        ...data.room,
        last_message_preview: null,
        unread_count: 0,
      })
      onClose()
      router.push(`/rooms/${data.room.id}`)
    } catch {
      setError('Network error')
    } finally {
      setCreating(false)
    }
  }, [name, description, category, rules, creating, onClose, onCreated, router])

  return (
    <div className="rooms-modal-overlay" onClick={onClose}>
      <div className="rooms-modal" onClick={e => e.stopPropagation()}>
        <div className="rooms-modal-head">
          <span className="rooms-modal-title">Create Public Room</span>
          <button className="rooms-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="rooms-modal-body">
          <div className="form-field">
            <label className="field-label">Room Name *</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Steel Traders MENA Q3"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-field">
            <label className="field-label">Category</label>
            <select
              className="input form-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="field-label">Description</label>
            <input
              className="input"
              type="text"
              placeholder="What is this room for?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Room Rules</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Optional community guidelines for participants…"
              value={rules}
              onChange={e => setRules(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>
          {error && <p style={{ fontSize: 12, color: 'var(--color-red)', margin: 0 }}>{error}</p>}
        </div>
        <div className="rooms-modal-foot">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-blue btn-sm" disabled={creating || !name.trim()} onClick={submit}>
            {creating ? 'Creating…' : 'Create Room'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function RoomsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const params = useParams<{ id?: string }>()
  const pathname = usePathname()
  const activeId = params?.id ?? null

  const [rooms, setRooms] = useState<PanelRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const hydratedCollapse = useRef(false)

  // Hydrate collapse state from localStorage (client-only to avoid SSR mismatch).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch { /* ignore */ }
    hydratedCollapse.current = true
  }, [])

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  const loadRooms = useCallback(() => {
    fetch('/api/rooms')
      .then(r => r.json())
      .then(data => {
        const priv: PanelRoom[] = (data.private ?? []).map((r: any) => ({ ...r, room_type: 'private' }))
        const pub: PanelRoom[] = (data.public ?? []).map((r: any) => ({ ...r, room_type: 'public' }))
        setRooms([...pub, ...priv])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadRooms() }, [loadRooms])

  // Refresh the panel (preview + unread) when navigating between rooms, so the
  // list reflects newly-read state and any messages sent while viewing.
  useEffect(() => { loadRooms() }, [pathname, loadRooms])

  const navigate = useCallback((id: string) => {
    if (id === activeId) return
    router.push(`/rooms/${id}`)
  }, [router, activeId])

  return (
    <div className="rooms-shell">
      <ConversationPanel
        rooms={rooms}
        loading={loading}
        activeId={activeId}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onNavigate={navigate}
        onNewRoom={() => setShowModal(true)}
      />
      <div className="rooms-main">
        {children}
      </div>
      {showModal && (
        <NewRoomModal
          onClose={() => setShowModal(false)}
          onCreated={(room) => setRooms(prev => [room, ...prev])}
        />
      )}
    </div>
  )
}
