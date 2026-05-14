'use client'
import React, { useState, useEffect, useRef } from 'react'

interface AppNotification {
  id: string
  title: string
  body: string | null
  read: boolean
  created_at: string
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
  return (
    <header className="topbar">
      {onBack && (
        <button className="back-btn" type="button" onClick={onBack}>
          <Icon name="back" size={12} /> Back
        </button>
      )}
      <div className="breadcrumb">
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
  const [open, setOpen]                     = useState(false)
  const [notifications, setNotifications]   = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount]       = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { loadNotifs() }, [])

  // Mark all unread as read when panel opens
  useEffect(() => {
    if (!open) return
    const unread = notifications.filter(n => !n.read)
    unread.forEach(n => {
      fetch(`/api/notifications/${n.id}`, { method: 'PATCH' }).catch(() => {})
    })
    if (unread.length > 0) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function loadNotifs() {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unread_count ?? 0)
    } catch {}
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
          position:   'absolute',
          top:        'calc(100% + 4px)',
          right:      0,
          width:      320,
          background: 'var(--color-card)',
          border:     '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow:  '0 4px 16px rgba(0,0,0,0.12)',
          zIndex:     100,
        }}>
          <div style={{
            padding:      '10px 14px 8px',
            borderBottom: '1px solid var(--color-border)',
            fontWeight:   600,
            fontSize:     13,
            color:        'var(--color-ink-1)',
          }}>
            Notifications
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-ink-3)', fontSize: 13 }}>
              No notifications
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.map(n => (
                <div key={n.id} style={{
                  padding:    '10px 14px',
                  background: n.read ? 'transparent' : 'var(--color-accent-bg, rgba(37,99,235,0.06))',
                  borderBottom: '1px solid var(--color-border)',
                }}>
                  <div style={{
                    fontSize:   13,
                    fontWeight: n.read ? 400 : 600,
                    color:      'var(--color-ink-1)',
                    lineHeight: 1.3,
                  }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 3, lineHeight: 1.4 }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginTop: 4 }}>
                    {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
  if (!n) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M'
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K'
  return '$' + n.toLocaleString()
}
