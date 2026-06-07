'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'

const CATEGORIES = [
  'Steel Trading',
  'Textile & Apparel',
  'Electronics',
  'Agricultural',
  'Chemicals',
  'Logistics',
  'General Trade Finance',
]

interface DealSummary {
  id: string
  status: string
  total_value: number | null
  agreed_currency: string
  counterparty_name: string
}

interface PrivateRoom {
  id: string
  name: string
  status: string
  participant_count: number
  last_message_at: string | null
  deal_id: string | null
  deal: DealSummary | null
}

interface PublicRoom {
  id: string
  name: string
  description: string | null
  category: string | null
  tags: string[] | null
  participant_count: number
  message_count: number
  last_message_at: string | null
  created_at: string
}

interface CreateForm {
  name: string
  description: string
  category: string
  rules: string
}

function fmtAmount(v: number | null, currency: string): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v)
}

function fmtRelative(ts: string | null): string {
  if (!ts) return 'No messages yet'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function dealStatusClass(s: string): string {
  const map: Record<string, string> = {
    negotiating: 'badge-pending',
    agreed: 'badge-active',
    documents_pending: 'badge-pending',
    active: 'badge-active',
    financing_requested: 'badge-offer',
    financing_active: 'badge-signing',
    completed: 'badge-completed',
    disputed: 'badge-overdue',
    cancelled: 'badge-rejected',
  }
  return map[s] ?? 'badge-draft'
}

export default function RoomsPage() {
  const router = useRouter()

  const [privateRooms, setPrivateRooms] = useState<PrivateRoom[]>([])
  const [loadingPrivate, setLoadingPrivate] = useState(true)

  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([])
  const [loadingPublic, setLoadingPublic] = useState(true)

  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({
    name: '', description: '', category: CATEGORIES[0]!, rules: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [joiningId, setJoiningId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/rooms')
      .then(r => r.json())
      .then(data => {
        setPrivateRooms(data.private ?? [])
        setLoadingPrivate(false)
      })
      .catch(() => setLoadingPrivate(false))

    fetch('/api/rooms/public')
      .then(r => r.json())
      .then(data => {
        setPublicRooms(data.rooms ?? [])
        setLoadingPublic(false)
      })
      .catch(() => setLoadingPublic(false))
  }, [])

  const filteredPublic = activeCategory
    ? publicRooms.filter(r => r.category === activeCategory)
    : publicRooms

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || undefined,
          category: createForm.category || undefined,
          rules: createForm.rules || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create room')
        return
      }
      setPublicRooms(prev => [data.room, ...prev])
      setShowCreateForm(false)
      setCreateForm({ name: '', description: '', category: CATEGORIES[0]!, rules: '' })
      router.push(`/rooms/${data.room.id}`)
    } catch {
      setCreateError('Network error')
    } finally {
      setCreating(false)
    }
  }

  async function handleJoin(roomId: string) {
    setJoiningId(roomId)
    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, { method: 'POST' })
      if (res.ok || res.status === 409) {
        router.push(`/rooms/${roomId}`)
      }
    } finally {
      setJoiningId(null)
    }
  }

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Strike Rooms' }]}
        actions={
          <div className="topbar-right">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateForm(v => !v)}
            >
              {showCreateForm ? 'Cancel' : '+ Create Public Room'}
            </button>
          </div>
        }
      />

      <div className="page" style={{ maxWidth: 1280 }}>
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Strike Rooms
          </h1>
          <p className="subtitle">
            Private deal rooms with your counterparties, and public community rooms by sector.
          </p>
        </div>

        {/* Create room inline form */}
        {showCreateForm && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-head">
              <span>Create Public Room</span>
            </div>
            <div className="card-body">
              <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row-2">
                  <div className="form-field">
                    <label className="field-label">Room Name *</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. Steel Traders MENA Q3"
                      value={createForm.name}
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label className="field-label">Category</label>
                    <select
                      className="input form-select"
                      value={createForm.category}
                      onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                    >
                      {CATEGORIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-field">
                  <label className="field-label">Description</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="What is this room for?"
                    value={createForm.description}
                    onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label className="field-label">Room Rules</label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Optional community guidelines for participants…"
                    value={createForm.rules}
                    onChange={e => setCreateForm(f => ({ ...f, rules: e.target.value }))}
                    style={{ resize: 'vertical' }}
                  />
                </div>
                {createError && (
                  <p style={{ fontSize: 12, color: 'var(--color-red)', margin: 0 }}>{createError}</p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-blue btn-sm" disabled={creating}>
                    {creating ? 'Creating…' : 'Create Room'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* My Private Rooms */}
        <div className="section" style={{ marginBottom: 36 }}>
          <div className="rooms-section-head">
            <span className="rooms-section-title">My Private Rooms</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loadingPrivate ? '…' : `${privateRooms.length} room${privateRooms.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {loadingPrivate ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map(i => (
                <div key={i} className="mp-skeleton-card" style={{ height: 80 }} />
              ))}
            </div>
          ) : privateRooms.length === 0 ? (
            <div className="rooms-empty">
              <p className="rooms-empty-text">
                Your deal rooms appear here once you start negotiating on Strike Place.
              </p>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => router.push('/marketplace')}
              >
                Browse Marketplace
              </button>
            </div>
          ) : (
            <div className="rooms-list">
              {privateRooms.map(room => (
                <div
                  key={room.id}
                  className="room-card"
                  onClick={() => router.push(`/rooms/${room.id}`)}
                >
                  <div className="room-card-head">
                    <span className="room-card-name">{room.name}</span>
                    <span className="badge badge-draft" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em' }}>
                      Private
                    </span>
                    {room.status !== 'active' && (
                      <span className="badge badge-draft">Archived</span>
                    )}
                  </div>
                  {room.deal && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                        {room.deal.counterparty_name}
                      </span>
                      <span className={`badge ${dealStatusClass(room.deal.status)}`}>
                        {room.deal.status.replace(/_/g, ' ')}
                      </span>
                      {room.deal.total_value != null && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--gray)' }}>
                          {fmtAmount(room.deal.total_value, room.deal.agreed_currency)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="room-card-footer">
                    <div className="room-card-meta">
                      <span className="room-card-meta-item">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2a3 3 0 100 6 3 3 0 000-6zM2 13c0-2.8 2.7-5 6-5s6 2.2 6 5" />
                        </svg>
                        {room.participant_count} participant{room.participant_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="room-last-activity">{fmtRelative(room.last_message_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Public Rooms */}
        <div className="section">
          <div className="rooms-section-head">
            <span className="rooms-section-title">Public Rooms</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loadingPublic ? '…' : `${publicRooms.length} room${publicRooms.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {/* Category pill filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            <button
              className={`range-pill${!activeCategory ? ' selected' : ''}`}
              onClick={() => setActiveCategory(null)}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`range-pill${activeCategory === cat ? ' selected' : ''}`}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {loadingPublic ? (
            <div className="rooms-grid">
              {[1, 2, 3].map(i => (
                <div key={i} className="mp-skeleton-card" style={{ height: 120 }} />
              ))}
            </div>
          ) : filteredPublic.length === 0 ? (
            <div className="rooms-empty">
              <p className="rooms-empty-text">
                {activeCategory
                  ? `No public rooms in ${activeCategory} yet. Be the first to create one.`
                  : 'No public rooms yet. Be the first to create one.'}
              </p>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => setShowCreateForm(true)}
              >
                + Create Room
              </button>
            </div>
          ) : (
            <div className="rooms-grid">
              {filteredPublic.map(room => (
                <div key={room.id} className="room-card">
                  <div className="room-card-head">
                    <span className="room-card-name">{room.name}</span>
                    {room.category && (
                      <span className="room-card-category">{room.category}</span>
                    )}
                  </div>
                  {room.description && (
                    <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {room.description}
                    </p>
                  )}
                  <div className="room-card-footer">
                    <div className="room-card-meta">
                      <span className="room-card-meta-item">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2a3 3 0 100 6 3 3 0 000-6zM2 13c0-2.8 2.7-5 6-5s6 2.2 6 5" />
                        </svg>
                        {room.participant_count ?? 0}
                      </span>
                      <span className="room-card-meta-item">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 5H2a1 1 0 00-1 1v5a1 1 0 001 1h1v2l3-2h8a1 1 0 001-1V6a1 1 0 00-1-1z" />
                        </svg>
                        {room.message_count ?? 0} msg{room.message_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={joiningId === room.id}
                      onClick={() => handleJoin(room.id)}
                    >
                      {joiningId === room.id ? 'Joining…' : 'Join →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
