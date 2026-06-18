'use client'
import React, { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const PATH_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/programs':  'My Programs',
  '/reporting': 'Reporting & Analytics',
}

function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

interface Notif {
  id: string
  title: string
  body: string
  read: boolean
  created_at: string
}

// Module-level — NOT inside Topbar — so it never re-mounts on parent re-renders
function NotifBell() {
  const [open, setOpen]           = useState(false)
  const [notifs, setNotifs]       = useState<Notif[]>([])
  const [unreadCount, setUnread]  = useState(0)
  const ref                       = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.ok ? r.json() : { notifications: [], unread_count: 0 })
      .then(d => {
        const list: Notif[] = d.notifications ?? []
        setNotifs(list)
        setUnread(d.unread_count ?? list.filter((n: Notif) => !n.read).length)
      })
      .catch(() => {})
  }, [])

  // Always-running click-outside — not conditional on `open`
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function markRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ read: true }),
      })
    } catch {}
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  function markAllRead() {
    notifs.filter(n => !n.read).forEach(n => markRead(n.id))
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'relative',
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--gray)',
        }}
      >
        <Icon name="bell" size={16} />
        {unreadCount > 0 && (
          <span style={{
            position:        'absolute',
            top:             -3,
            right:           -3,
            background:      '#DC2626',
            color:           'white',
            borderRadius:    '50%',
            width:           15,
            height:          15,
            fontSize:        9,
            fontWeight:      700,
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            lineHeight:      1,
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position:     'absolute',
          top:          'calc(100% + 8px)',
          right:        0,
          width:        320,
          background:   'var(--white)',
          border:       '1px solid var(--border)',
          boxShadow:    '0 8px 24px rgba(0,0,0,0.12)',
          zIndex:       9999,
          overflow:     'hidden',
        }}>
          <div style={{
            padding:        '12px 16px',
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
                  color:      'var(--color-accent)',
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifs.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
              No notifications yet
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {notifs.slice(0, 10).map(n => (
                <div
                  key={n.id}
                  onClick={() => { if (!n.read) markRead(n.id) }}
                  style={{
                    padding:     '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    cursor:       n.read ? 'default' : 'pointer',
                    borderLeft:   n.read ? 'none' : '3px solid var(--color-accent)',
                    background:   n.read ? 'transparent' : 'rgba(37,99,235,0.03)',
                    transition:   'background 0.1s',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 500, color: 'var(--ink)', marginBottom: 2 }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 4 }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--gray)' }}>
                    {new Date(n.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
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

export function Topbar({
  title,
  actions,
}: {
  title?: string
  actions?: React.ReactNode
}) {
  const pathname    = usePathname()
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

  const derivedTitle = title ?? (() => {
    for (const [path, label] of Object.entries(PATH_TITLES)) {
      if (pathname === path || pathname.startsWith(path + '/')) return label
    }
    return ''
  })()

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 2,
        width: loading ? `${progress}%` : '0%',
        background: 'var(--blue)',
        transition: loading ? 'width 0.3s ease' : 'none',
        opacity: loading ? 1 : 0,
      }} />
      <div className="breadcrumb" style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--gray)',
      }}>
        {derivedTitle && (
          <span className="crumb-current">{derivedTitle}</span>
        )}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <NotifBell />
        {actions}
      </div>
    </header>
  )
}

export { Icon }
