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

export default function RoomsPage() {
  const router = useRouter()

  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([])
  const [loadingPublic, setLoadingPublic] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [joiningId, setJoiningId] = useState<string | null>(null)

  useEffect(() => {
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
      <Topbar crumbs={[{ label: 'Strike Rooms' }]} />

      <div className="page" style={{ maxWidth: 1100, overflowY: 'auto' }}>
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Discover Rooms
          </h1>
          <p className="subtitle">
            Pick a conversation from the left, or browse and join public community rooms by sector.
          </p>
        </div>

        {/* Public room discovery */}
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
                  ? `No public rooms in ${activeCategory} yet. Use “New Room” to create one.`
                  : 'No public rooms yet. Use “New Room” in the panel to create one.'}
              </p>
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
