'use client'
import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'

const ROLE_LABELS: Record<string, string> = {
  bank_admin:          'Bank Admin',
  bank_credit_officer: 'Credit Officer',
  anchor_admin:        'Anchor Admin',
  anchor_member:       'Anchor Member',
  supplier_admin:      'Supplier Admin',
  supplier_member:     'Supplier Member',
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',             icon: 'dashboard', href: '/dashboard' },
  { key: 'programs',  label: 'My Programs',           icon: 'programs',  href: '/programs'  },
  { key: 'reporting', label: 'Reporting & Analytics', icon: 'reports',   href: '/reporting' },
]

function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

export function Sidebar() {
  const portal   = usePortal()
  const user     = useUser()
  const router   = useRouter()
  const pathname = usePathname()

  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'light'
    return localStorage.getItem('strike-theme') === 'dark' ? 'dark' : 'light'
  })

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const [programName, setProgramName] = useState('')
  const [anchorName,  setAnchorName]  = useState('')
  const [supplierName, setSupplierName] = useState('')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.setAttribute('data-portal', portal)
    try { localStorage.setItem('strike-theme', theme) } catch {}
  }, [theme, portal])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  // Read breadcrumb names from sessionStorage on every navigation
  useEffect(() => {
    try {
      const inTree     = pathname.startsWith('/programs/')
      const inAnchor   = /\/programs\/[^/]+\/anchor\//.test(pathname)
      const inSupplier = /\/programs\/[^/]+\/anchor\/[^/]+\/supplier\//.test(pathname)

      if (pathname === '/programs') {
        sessionStorage.removeItem('breadcrumb_program')
        sessionStorage.removeItem('breadcrumb_anchor')
        sessionStorage.removeItem('breadcrumb_supplier')
        setProgramName('')
        setAnchorName('')
        setSupplierName('')
      } else if (inTree && !inAnchor) {
        sessionStorage.removeItem('breadcrumb_anchor')
        sessionStorage.removeItem('breadcrumb_supplier')
        setProgramName(sessionStorage.getItem('breadcrumb_program') ?? '')
        setAnchorName('')
        setSupplierName('')
      } else if (inAnchor && !inSupplier) {
        sessionStorage.removeItem('breadcrumb_supplier')
        setProgramName(sessionStorage.getItem('breadcrumb_program') ?? '')
        setAnchorName(sessionStorage.getItem('breadcrumb_anchor') ?? '')
        setSupplierName('')
      } else if (inSupplier) {
        setProgramName(sessionStorage.getItem('breadcrumb_program') ?? '')
        setAnchorName(sessionStorage.getItem('breadcrumb_anchor') ?? '')
        setSupplierName(sessionStorage.getItem('breadcrumb_supplier') ?? '')
      }
    } catch {}
  }, [pathname])

  const userInitials = user?.full_name
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  const userName = user?.full_name || 'Unknown'
  const userRole = ROLE_LABELS[user?.role ?? ''] || user?.role || 'User'

  function handleSignOut() {
    const supabase = createClient()
    supabase.auth.signOut().then(() => router.push('/login')).catch(() => router.push('/login'))
  }

  // Depth detection for Programs breadcrumb rendering
  const inProgramsTree = pathname.startsWith('/programs/')
  const inAnchorTree   = /\/programs\/[^/]+\/anchor\//.test(pathname)
  const inSupplierTree = /\/programs\/[^/]+\/anchor\/[^/]+\/supplier\//.test(pathname)

  // Navigation path helpers
  const segments    = pathname.split('/')
  const programPath = '/' + segments.slice(1, 3).join('/')
  const anchorPath  = '/' + segments.slice(1, 5).join('/')

  const onProgramDetail = inProgramsTree && !inAnchorTree
  const onAnchorDetail  = inAnchorTree && !inSupplierTree

  return (
    <aside className="sidebar">
      <div style={{
        padding: '16px 12px 12px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <Image
          src="/logo.png"
          alt="Strike SCF"
          width={120}
          height={40}
          style={{
            objectFit: 'contain',
            objectPosition: 'left center',
            maxWidth: '100%',
            height: 'auto',
          }}
          priority
        />
      </div>

      <nav className="nav-section" style={{ marginTop: 4 }}>
        <div className="nav-label">Workspace</div>
        {NAV_ITEMS.map(item => {
          const active = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href)
          return (
            <React.Fragment key={item.key}>
              <Link
                href={item.href}
                className={`nav-item ${active ? 'active' : ''}`}
                style={{ textDecoration: 'none' }}
              >
                <Icon name={item.icon} className="nav-icon" />
                <span>{item.label}</span>
              </Link>

              {item.key === 'programs' && inProgramsTree && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* Program level */}
                  <button
                    type="button"
                    className="nav-item"
                    style={{
                      paddingLeft: 28, fontSize: 12,
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', textDecoration: 'none',
                      color:      onProgramDetail ? 'var(--color-ink-1)' : 'var(--color-ink-2)',
                      fontWeight: onProgramDetail ? 500 : 400,
                    }}
                    onClick={() => router.push(programPath)}
                  >
                    └ {programName || 'Program'}
                  </button>

                  {/* Anchor level */}
                  {(inAnchorTree || inSupplierTree) && (
                    <button
                      type="button"
                      className="nav-item"
                      style={{
                        paddingLeft: 40, fontSize: 12,
                        width: '100%', textAlign: 'left',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', textDecoration: 'none',
                        color:      onAnchorDetail ? 'var(--color-ink-1)' : 'var(--color-ink-2)',
                        fontWeight: onAnchorDetail ? 500 : 400,
                      }}
                      onClick={() => router.push(anchorPath)}
                    >
                      └ {anchorName || 'Anchor'}
                    </button>
                  )}

                  {/* Supplier level — not clickable, already on this page */}
                  {inSupplierTree && (
                    <div
                      className="nav-item"
                      style={{
                        paddingLeft: 52, fontSize: 12,
                        color: 'var(--color-ink-1)', fontWeight: 500,
                        textDecoration: 'none', cursor: 'default',
                      }}
                    >
                      └ {supplierName || 'Supplier'}
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          )
        })}
      </nav>

      <div ref={userMenuRef} style={{ marginTop: 'auto', position: 'relative' }}>
        {userMenuOpen && (
          <div style={{
            position:     'absolute',
            bottom:       '100%',
            left:         8,
            right:        8,
            marginBottom: 4,
            background:   'var(--color-card)',
            border:       '1px solid var(--color-border)',
            borderRadius: 8,
            padding:      '4px 0',
            boxShadow:    '0 4px 16px rgba(0,0,0,0.12)',
            zIndex:       50,
          }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-ink-1)' }}>{userName}</div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 2 }}>{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={() => { setUserMenuOpen(false); router.push('/settings') }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--color-ink-1)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Icon name="settings" size={14} />
              Settings
            </button>
            <button
              type="button"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--color-ink-1)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
            <button
              type="button"
              onClick={() => { setUserMenuOpen(false); handleSignOut() }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--color-error)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Icon name="logout" size={14} />
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className="sidebar-footer"
          onClick={() => setUserMenuOpen(o => !o)}
          style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
        >
          <div className="avatar">{userInitials}</div>
          <div className="user-meta">
            <span className="user-name">{userName}</span>
            <span className="user-role">{userRole}</span>
          </div>
        </button>
      </div>
    </aside>
  )
}
