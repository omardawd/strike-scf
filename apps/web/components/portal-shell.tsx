'use client'
import React, { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface AppNotification {
  id: string
  title: string
  body: string | null
  read: boolean
  read_at: string | null
  deep_link: string | null
  created_at: string
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

// Sidebar and app-shell are now provided by app/(portal)/layout.tsx.
// PortalShell is kept as a pass-through so existing pages compile without changes.
export function PortalShell({
  children,
}: {
  activeSection?: string
  children: React.ReactNode
}) {
  return <>{children}</>
}

export function Topbar({
  crumbs,
  onBack,
  actions,
}: {
  crumbs: Array<{ label: string; onClick?: () => void }>
  onBack?: () => void
  actions?: React.ReactNode
}) {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setLoading(true)
    setProgress(0)
    const t1 = setTimeout(() => setProgress(70), 100)
    const t2 = setTimeout(() => {
      setProgress(100)
      setTimeout(() => { setLoading(false); setProgress(0) }, 200)
    }, 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [pathname])

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 2,
        width: loading ? `${progress}%` : '0%',
        background: 'var(--blue)',
        transition: loading ? 'width 0.3s ease' : 'none',
        opacity: loading ? 1 : 0,
      }} />
      {onBack && (
        <button className="back-btn" type="button" onClick={onBack}>
          <Icon name="back" size={12} /> Back
        </button>
      )}
      {/* key={pathname} forces a remount on route change so .fade-in replays for the new crumbs */}
      <div className="breadcrumb fade-in" key={pathname}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="crumb-sep">›</span>}
            {c.onClick ? (
              <a onClick={c.onClick} className={i === 0 ? 'crumb-portal' : ''} style={{ cursor: 'pointer' }}>
                {c.label}
              </a>
            ) : (
              <span className={i === crumbs.length - 1 ? 'crumb-current' : i === 0 ? 'crumb-portal' : ''}>
                {c.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">{actions}</div>
    </header>
  )
}

export function NotifBell() {
  const [open, setOpen]                   = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const ref                               = useRef<HTMLDivElement>(null)
  const router                            = useRouter()

  // Initial fetch
  useEffect(() => {
    fetch('/api/notifications?unread_only=false&limit=20')
      .then(r => r.ok ? r.json() : { notifications: [], unread_count: 0 })
      .then(d => {
        setNotifications(d.notifications ?? [])
        setUnreadCount(d.unread_count ?? 0)
      })
      .catch(() => {})
  }, [])

  // Supabase Realtime — append new notifications live
  // (gracefully degrades if WebSocket is blocked — notifications still load via the initial fetch)
  useEffect(() => {
    const supabase = createClient()
    let userId: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      userId = user.id

      try {
        channel = supabase
          .channel('notif-bell')
          .on(
            'postgres_changes',
            {
              event:  'INSERT',
              schema: 'public',
              table:  'notifications',
              filter: `user_id=eq.${userId}`,
            },
            (payload) => {
              const n = payload.new as AppNotification
              setNotifications(prev => [n, ...prev])
              setUnreadCount(prev => prev + 1)
            }
          )
          .subscribe()
      } catch { /* realtime unavailable — notifications still work via the initial fetch */ }
    })

    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' }).catch(() => {})
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'PATCH' }).catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  async function handleClick(n: AppNotification) {
    if (!n.read) await markRead(n.id)
    if (n.deep_link) router.push(n.deep_link)
    setOpen(false)
  }

  const displayCount = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="icon-btn"
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(o => !o)}
        style={{ position: 'relative' }}
      >
        <Icon name="bell" size={16} />
        {unreadCount > 0 && <span className="dot">{displayCount}</span>}
      </button>

      {open && (
        <div style={{
          position:  'absolute',
          top:       'calc(100% + 4px)',
          right:     0,
          width:     320,
          background:'var(--white)',
          border:    '1px solid var(--border)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex:    9999,
          overflow:  'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding:        '12px 14px',
            borderBottom:   '1px solid var(--border)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  fontSize:   11,
                  color:      'var(--blue)',
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  fontFamily: 'inherit',
                  padding:    0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              No notifications
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    padding:      '11px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor:       'pointer',
                    background:   n.read ? 'transparent' : 'rgba(20,40,204,0.04)',
                    display:      'flex',
                    gap:          10,
                    alignItems:   'flex-start',
                  }}
                >
                  {/* Unread dot */}
                  <div style={{
                    width:       7,
                    height:      7,
                    borderRadius:'50%',
                    background:  n.read ? 'transparent' : 'var(--blue)',
                    flexShrink:  0,
                    marginTop:   5,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize:   13,
                      fontWeight: n.read ? 400 : 500,
                      color:      'var(--ink)',
                      lineHeight: 1.35,
                    }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2, lineHeight: 1.4 }}>
                        {n.body.length > 60 ? n.body.slice(0, 60) + '…' : n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 4 }}>
                      {relTime(n.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function fmtMoney(n: number | null | undefined): string {
  if (!n || isNaN(Number(n))) return '$0'
  const num = Number(n)
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B'
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(num % 1e6 === 0 ? 0 : 1) + 'M'
  if (num >= 1e3) return '$' + Math.round(num / 1e3) + 'K'
  return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
