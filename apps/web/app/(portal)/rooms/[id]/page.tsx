'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomDetail {
  id: string
  name: string
  room_type: 'public' | 'private'
  status: 'active' | 'archived'
  participant_count: number
  deal_id: string | null
  description: string | null
}

interface Participant {
  id: string
  user_id: string
  org_id: string | null
  role: string
  user_name: string | null
  org_name: string | null
}

interface Message {
  id: string
  user_id: string | null
  content: string
  message_type: 'message' | 'system' | 'ai_suggestion' | 'document_share' | 'offer_update' | 'contract_draft'
  status: string
  metadata: Record<string, any> | null
  reply_to_id: string | null
  created_at: string
  sender_name: string | null
  sender_org_name: string | null
}

interface DealSummary {
  id: string
  status: string
  total_value: number | null
  agreed_currency: string
  counterparty_name: string
  goods_description: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(w => w.length > 0)
    .slice(0, 2)
    .map(w => (w[0] ?? '').toUpperCase())
    .join('')
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: string): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function DateDivider({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: 'var(--gray-soft)',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function SystemMsg({ msg }: { msg: Message }) {
  return (
    <div className="room-msg-system">
      <div className="room-msg-system-line" />
      <span className="room-msg-system-text">{msg.content}</span>
      <div className="room-msg-system-line" />
    </div>
  )
}

function AiMsg({ msg }: { msg: Message }) {
  return (
    <div className="room-msg room-msg-ai">
      <div className="room-msg-avatar room-msg-avatar-ai">⚡</div>
      <div className="room-msg-body">
        <div className="room-msg-meta">
          <span className="room-msg-sender room-msg-sender-ai">Strike AI</span>
          <span className="room-msg-time">{formatTime(msg.created_at)}</span>
        </div>
        <div className="room-msg-content">{msg.content}</div>
      </div>
    </div>
  )
}

function DocumentMsg({ msg, hideAvatar }: { msg: Message; hideAvatar: boolean }) {
  const meta = msg.metadata ?? {}
  const fileName = (meta.file_name as string) ?? 'Document'
  const fileSize = (meta.file_size as string) ?? ''
  return (
    <div className="room-msg">
      <div className="room-msg-avatar" style={{ visibility: hideAvatar ? 'hidden' : 'visible' }}>
        {initials(msg.sender_name)}
      </div>
      <div className="room-msg-body">
        {!hideAvatar && (
          <div className="room-msg-meta">
            <span className="room-msg-sender">{msg.sender_name ?? 'Unknown'}</span>
            {msg.sender_org_name && (
              <span style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{msg.sender_org_name}</span>
            )}
            <span className="room-msg-time">{formatTime(msg.created_at)}</span>
          </div>
        )}
        {msg.content && (
          <div className="room-msg-content" style={{ marginBottom: 4 }}>{msg.content}</div>
        )}
        <div className="room-msg-document-attachment">
          <div className="room-msg-doc-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M4 2h6l2 2v10H4z M9 2v3h3" />
            </svg>
          </div>
          <div className="room-msg-doc-info">
            <span className="room-msg-doc-name">{fileName}</span>
            {fileSize && <span className="room-msg-doc-size">{fileSize}</span>}
          </div>
          <span className="room-msg-doc-download">Download</span>
        </div>
      </div>
    </div>
  )
}

function OfferMsg({ msg, hideAvatar }: { msg: Message; hideAvatar: boolean }) {
  const meta = msg.metadata ?? {}
  const price = meta.offered_price as number | undefined
  const currency = (meta.currency as string) ?? 'USD'
  const terms: string[] = []
  if (meta.offered_quantity) terms.push(`${meta.offered_quantity} ${meta.unit ?? ''}`.trim())
  if (meta.proposed_incoterms) terms.push(meta.proposed_incoterms as string)
  if (meta.proposed_payment_terms) terms.push(meta.proposed_payment_terms as string)
  if (meta.proposed_delivery_date) terms.push(new Date(meta.proposed_delivery_date as string).toLocaleDateString([], { month: 'short', day: 'numeric' }))

  return (
    <div className="room-msg">
      <div className="room-msg-avatar" style={{ visibility: hideAvatar ? 'hidden' : 'visible' }}>
        {initials(msg.sender_name)}
      </div>
      <div className="room-msg-body">
        {!hideAvatar && (
          <div className="room-msg-meta">
            <span className="room-msg-sender">{msg.sender_name ?? 'Unknown'}</span>
            {msg.sender_org_name && (
              <span style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{msg.sender_org_name}</span>
            )}
            <span className="room-msg-time">{formatTime(msg.created_at)}</span>
          </div>
        )}
        {msg.content && (
          <div className="room-msg-content" style={{ marginBottom: 4 }}>{msg.content}</div>
        )}
        <div className="room-msg-offer-card">
          <span className="room-msg-offer-label">Offer update</span>
          {price != null && (
            <span className="room-msg-offer-price">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(price)}
              {' '}
              <span style={{ fontSize: 13, fontFamily: 'var(--font-body)', fontWeight: 500, color: 'var(--gray)' }}>{currency}</span>
            </span>
          )}
          {terms.length > 0 && (
            <div className="room-msg-offer-terms">
              {terms.map((t, i) => <span key={i} className="mp-offer-term-pill">{t}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Bubble-style standard message (TG.2): own → right + blue, others → left +
// offwhite with an avatar circle. Grouped consecutive messages from the same
// sender hide the avatar/sender label and tighten the bubble corner.
function BubbleMsg({ msg, isOwn, hideAvatar }: { msg: Message; isOwn: boolean; hideAvatar: boolean }) {
  return (
    <div className={`room-msg-row${isOwn ? ' room-msg-row-own' : ''}${hideAvatar ? ' room-msg-row-grouped' : ''}`}>
      {!isOwn && (
        hideAvatar
          ? <div className="room-msg-bubble-avatar-spacer" />
          : <div className="room-msg-bubble-avatar" title={[msg.sender_name, msg.sender_org_name].filter(Boolean).join(' · ')}>
              {initials(msg.sender_name)}
            </div>
      )}
      <div className="room-msg-bubble-col">
        {!isOwn && !hideAvatar && (
          <span className="room-msg-bubble-sender">
            {msg.sender_name ?? 'Unknown'}
            {msg.sender_org_name ? ` · ${msg.sender_org_name}` : ''}
          </span>
        )}
        <div className="room-msg-bubble">{msg.content}</div>
        <span className="room-msg-bubble-time">{formatTime(msg.created_at)}</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RoomPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const user = useUser()

  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [deal, setDeal] = useState<DealSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [showMembers, setShowMembers] = useState(false)

  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const channelRef = useRef<any>(null)
  const lastMarkedRef = useRef<string | null>(null)

  // Mark the room read (sets room_participants.last_read_at = now) once the
  // user is scrolled to the bottom. Debounced by the latest message id so we
  // only POST when a genuinely-new message has been seen at the bottom.
  const markRead = useCallback(() => {
    if (!id) return
    const last = messages[messages.length - 1]
    const marker = last?.id ?? 'empty'
    if (lastMarkedRef.current === marker) return
    lastMarkedRef.current = marker
    fetch(`/api/rooms/${id}/read`, { method: 'POST' }).catch(() => {
      // Allow a retry on the next scroll-to-bottom if the request failed.
      lastMarkedRef.current = null
    })
  }, [id, messages])

  // Load room data
  useEffect(() => {
    if (!id) return
    fetch(`/api/rooms/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setRoom(data.room)
        setParticipants(data.participants ?? [])
        setMessages(data.messages ?? [])
        setDeal(data.deal ?? null)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load room'); setLoading(false) })
  }, [id])

  // Auto-scroll to bottom on new messages, and mark the room read once the
  // freshly-loaded/arrived messages are pinned to the bottom.
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    if (!loading && messages.length > 0) markRead()
  }, [messages, loading, markRead])

  // Also mark read when the user manually scrolls to the bottom.
  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom) markRead()
  }, [markRead])

  // Supabase Realtime subscription (gracefully degrades if WebSocket is blocked)
  useEffect(() => {
    if (!id || !user) return

    let supabase: ReturnType<typeof createClient> | null = null
    let channel: any = null

    try {
      supabase = createClient()

      channel = supabase
        .channel(`room:${id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_messages',
            filter: `room_id=eq.${id}`,
          },
          (payload: any) => {
            const newMsg = payload.new as Message
            if (newMsg.status === 'visible') {
              setMessages(prev => {
                if (prev.find(m => m.id === newMsg.id)) return prev
                return [...prev, newMsg]
              })
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'room_messages',
            filter: `room_id=eq.${id}`,
          },
          (payload: any) => {
            const updated = payload.new as Message
            setMessages(prev => {
              const exists = prev.find(m => m.id === updated.id)
              if (updated.status === 'visible') {
                if (exists) {
                  return prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)
                }
                return [...prev, updated]
              }
              return prev.filter(m => m.id !== updated.id)
            })
          }
        )
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState()
          const online = new Set<string>()
          Object.values(state).forEach((presences: any) => {
            presences.forEach((p: any) => {
              if (p.user_id) online.add(p.user_id)
            })
          })
          setOnlineUsers(online)
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED' && user) {
            channel.track({
              user_id: user.id,
              user_name: user.full_name,
            })
          }
        })

      channelRef.current = channel
    } catch {
      // Realtime unavailable (e.g. WebSocket blocked); room still works via REST
    }

    return () => {
      if (supabase && channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [id, user])

  const lastPendingReview = [...messages]
    .reverse()
    .find((m: Message) => m.user_id === user?.id && m.status === 'pending_review')

  const sendDisabled = sending || !!lastPendingReview || inputValue.trim().length === 0

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || sending) return
    setSending(true)
    setSendError(null)

    try {
      const res = await fetch(`/api/rooms/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: inputValue.trim(), message_type: 'message' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSendError(data.error ?? 'Send failed')
      } else {
        setInputValue('')
        // Optimistically append if private room (visible immediately)
        if (room?.room_type === 'private' && data.message) {
          setMessages(prev => {
            if (prev.find(m => m.id === data.message.id)) return prev
            return [...prev, {
              ...data.message,
              sender_name: user?.full_name ?? null,
              sender_org_name: null,
            }]
          })
        }
      }
    } catch {
      setSendError('Network error')
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }, [id, inputValue, sending, room, user])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!sendDisabled) handleSend()
    }
  }, [handleSend, sendDisabled])

  // ─── Render ─────────────────────────────────────────────────────────────────

  const shownParticipants = participants.slice(0, 5)
  const overflowCount = Math.max(0, participants.length - 5)

  const topbarActions = (
    <div className="topbar-right" style={{ gap: 8 }}>
      {room && (
        <span className={`badge ${room.status === 'active' ? 'badge-active' : 'badge-draft'}`}>
          {room.status}
        </span>
      )}
      {deal && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => router.push(`/deals/${deal.id}`)}
        >
          ← Back to Deal
        </button>
      )}
    </div>
  )

  const crumbs = [
    { label: 'Rooms', onClick: () => router.push('/rooms') },
    { label: room?.name ?? '…' },
  ]

  if (loading) {
    return (
      <>
        <Topbar crumbs={[{ label: 'Rooms', onClick: () => router.push('/rooms') }, { label: '…' }]} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '60vh' }}>
          <span style={{ color: 'var(--gray)', fontSize: 13 }}>Loading room…</span>
        </div>
      </>
    )
  }

  if (error || !room) {
    return (
      <>
        <Topbar crumbs={[{ label: 'Rooms', onClick: () => router.push('/rooms') }, { label: 'Error' }]} />
        <div style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ color: 'var(--color-red)', fontSize: 13 }}>{error ?? 'Room not found'}</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => router.push('/rooms')}>
            Back to Rooms
          </button>
        </div>
      </>
    )
  }

  const memberCount = participants.length
  const onlineCount = participants.filter(p => onlineUsers.has(p.user_id)).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }} data-page-name="Room" data-ai-context={JSON.stringify({ room_name: room.name, room_type: room.room_type, status: room.status, participant_count: participants.length, message_count: messages.length, has_deal: !!deal, deal_id: deal?.id ?? null })}>
      <Topbar crumbs={crumbs} actions={topbarActions} />

      {/* Clean room header (TG.2): name bold · member count · View Members */}
      <div className="room-header">
        <span className="room-header-name">{room.name}</span>
        <span className="room-header-members">
          {memberCount} member{memberCount !== 1 ? 's' : ''}
          {onlineCount > 0 && <span style={{ color: 'var(--color-green)' }}> · {onlineCount} online</span>}
        </span>
        {deal && (
          <>
            <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
            <span className={`badge ${dealStatusClass(deal.status)}`}>{deal.status.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--gray)' }}>{deal.counterparty_name}</span>
            {deal.total_value != null && (
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: 'var(--gray-soft)' }}>
                {fmtAmount(deal.total_value, deal.agreed_currency)}
              </span>
            )}
          </>
        )}
        <button className="room-header-viewbtn" onClick={() => setShowMembers(v => !v)}>
          {showMembers ? 'Hide Members' : 'View Members'}
        </button>
      </div>

      {/* Members panel (toggled by "View Members") */}
      {showMembers && (
        <div style={{
          background: 'var(--white)', borderBottom: '1px solid var(--border)',
          padding: '10px 28px', display: 'flex', flexWrap: 'wrap', gap: 10, flexShrink: 0,
        }}>
          {participants.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--gray-soft)' }}>No members yet.</span>
          ) : participants.map(p => {
            const isOnline = onlineUsers.has(p.user_id)
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }} title={p.org_name ?? undefined}>
                <div style={{ position: 'relative' }}>
                  <div className="room-msg-bubble-avatar" style={{ width: 26, height: 26, fontSize: 9 }}>
                    {initials(p.user_name)}
                  </div>
                  {isOnline && (
                    <div style={{
                      position: 'absolute', bottom: -1, right: -1, width: 8, height: 8,
                      background: 'var(--color-green)', border: '1.5px solid var(--white)', borderRadius: '50%',
                    }} />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{p.user_name ?? 'Unknown'}</span>
                  {p.org_name && <span style={{ fontSize: 10.5, color: 'var(--gray-soft)' }}>{p.org_name}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Message thread */}
      <div
        ref={threadRef}
        className="room-thread"
        onScroll={handleThreadScroll}
      >
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--gray)', fontSize: 13, fontStyle: 'italic' }}>
              No messages yet. Start the conversation.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null
            const showDateDivider = !prev || !isSameDay(prev.created_at, msg.created_at)
            const sameSenderAsPrev = !!prev &&
              prev.user_id === msg.user_id &&
              prev.message_type !== 'system' &&
              msg.message_type !== 'system' &&
              !showDateDivider
            const hideAvatar = sameSenderAsPrev
            const isOwn = !!user && msg.user_id === user.id

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && <DateDivider label={formatDate(msg.created_at)} />}
                {msg.message_type === 'system' && <SystemMsg msg={msg} />}
                {msg.message_type === 'ai_suggestion' && <AiMsg msg={msg} />}
                {msg.message_type === 'document_share' && (
                  <DocumentMsg msg={msg} hideAvatar={hideAvatar} />
                )}
                {(msg.message_type === 'offer_update' || msg.message_type === 'contract_draft') && (
                  <OfferMsg msg={msg} hideAvatar={hideAvatar} />
                )}
                {msg.message_type === 'message' && (
                  <BubbleMsg msg={msg} isOwn={isOwn} hideAvatar={hideAvatar} />
                )}
              </React.Fragment>
            )
          })
        )}
      </div>

      {/* Composer (TG.2): full-width rounded bar with arrow-icon send */}
      <div className="room-composer">
        {sendError && (
          <p style={{ fontSize: 11.5, color: 'var(--color-red)', marginBottom: 6 }}>{sendError}</p>
        )}
        {lastPendingReview && (
          <p style={{ fontSize: 11.5, color: 'var(--color-amber)', marginBottom: 6, fontStyle: 'italic' }}>
            Moderation in progress…
          </p>
        )}
        <div className="room-composer-bar">
          <textarea
            ref={textareaRef}
            className="room-composer-input"
            rows={1}
            placeholder={room.status !== 'active' ? 'This room is archived' : 'Send a message…'}
            disabled={room.status !== 'active' || !!lastPendingReview}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={2000}
          />
          <button
            className="room-composer-send"
            disabled={sendDisabled}
            title={lastPendingReview ? 'Moderation in progress' : 'Send'}
            aria-label="Send message"
            onClick={handleSend}
          >
            {sending ? (
              <span style={{ fontSize: 14, lineHeight: 1 }}>…</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
