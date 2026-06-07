'use client'
import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { usePortal, type PortalType } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'

// ── Role labels (v2 roles only) ──
const ROLE_LABELS: Record<string, string> = {
  bank_admin:          'Bank Admin',
  bank_credit_officer: 'Credit Officer',
  org_admin:           'Admin',
  org_member:          'Member',
  strike_admin:        'Strike Admin',
}

// ── Portal labels shown under the logo ──
const PORTAL_LABELS: Record<PortalType, string> = {
  anchor:   'BUYER PORTAL',
  supplier: 'SUPPLIER PORTAL',
  bank:     'BANK PORTAL',
  admin:    'ADMIN PORTAL',
}

// ── Unified navigation model ──
interface NavItem {
  label: string
  href: string
  icon: string
  badge?: string
}
interface NavSection {
  label?: string
  items: NavItem[]
}

// Anchor (buyer) + Supplier share the same unified nav.
const ORG_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',    href: '/dashboard',             icon: 'dashboard' },
      { label: 'Strike AI',    href: '/ai',                    icon: 'message' },
      { label: 'Strike Place', href: '/marketplace',           icon: 'box' },
      { label: 'My Deals',     href: '/deals',                 icon: 'invoice' },
      { label: 'Financing',    href: '/marketplace/financing', icon: 'refresh' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { label: 'My Programs',  href: '/programs',     icon: 'programs' },
      { label: 'Transactions', href: '/transactions', icon: 'reports' },
    ],
  },
  {
    label: 'Network',
    items: [
      { label: 'Strike Rooms', href: '/rooms',    icon: 'message' },
      { label: 'My Passport',  href: '/passport', icon: 'doc' },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { label: 'Analytics', href: '/reporting', icon: 'reports' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Settings', href: '/settings',       icon: 'settings' },
      { label: 'AI Agent', href: '/settings/agent', icon: 'bell' },
    ],
  },
]

const ANCHOR_NAV: NavSection[]   = ORG_NAV
const SUPPLIER_NAV: NavSection[] = ORG_NAV

const BANK_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',          href: '/dashboard',             icon: 'dashboard' },
      { label: 'Strike AI',          href: '/ai',                    icon: 'message' },
      { label: 'Financing Requests', href: '/marketplace/financing', icon: 'invoice' },
    ],
  },
  {
    label: 'SCF Engine',
    items: [
      { label: 'Programs',     href: '/programs',     icon: 'programs' },
      { label: 'Transactions', href: '/transactions', icon: 'reports' },
      { label: 'KYB Review',   href: '/kyb',          icon: 'doc' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Reporting',    href: '/reporting',               icon: 'reports' },
      { label: 'Supply Graph', href: '/reporting#supply-graph',  icon: 'box' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Settings', href: '/settings', icon: 'settings' },
    ],
  },
]

const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Strike AI', href: '/ai',        icon: 'message' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'KYB Queue',      href: '/admin', icon: 'doc' },
      { label: 'Platform Stats', href: '/admin', icon: 'reports' },
      { label: 'Room Reports',   href: '/admin', icon: 'message' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Settings', href: '/settings', icon: 'settings' },
    ],
  },
]

function navFor(portal: PortalType, role?: string): NavSection[] {
  if (role === 'strike_admin' || portal === 'admin') return ADMIN_NAV
  if (portal === 'bank')     return BANK_NAV
  if (portal === 'supplier') return SUPPLIER_NAV
  return ANCHOR_NAV
}

// Returns the match length of an item's href against the current path, or -1 for
// no match. Used to pick the single most-specific active item so that, e.g.,
// /marketplace/financing highlights "Financing" rather than "Strike Place".
function matchLen(pathname: string, href: string): number {
  if (href.includes('#')) return -1                     // deep-link anchors never take primary-active
  if (href === '/dashboard') return pathname === '/dashboard' ? href.length : -1
  if (pathname === href || pathname.startsWith(href + '/')) return href.length
  return -1
}

function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily:     'var(--font-body)',
  fontSize:       10,
  fontWeight:     600,
  letterSpacing:  '0.09em',
  textTransform:  'uppercase',
  color:          'var(--gray-soft)',
  marginTop:      24,
  marginBottom:   4,
  paddingLeft:    12,
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

  const userInitials = user?.full_name
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  const userName = user?.full_name || 'Unknown'
  const userRole = ROLE_LABELS[user?.role ?? ''] || user?.role || 'User'

  function handleSignOut() {
    const supabase = createClient()
    supabase.auth.signOut().then(() => router.push('/login')).catch(() => router.push('/login'))
  }

  const sections = navFor(portal, user?.role)
  const bestLen = sections
    .flatMap(s => s.items)
    .reduce((max, item) => Math.max(max, matchLen(pathname, item.href)), -1)

  return (
    <aside className="sidebar">
      {/* Logo + portal label */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}>
        <Image
          src={theme === 'dark' ? '/strike_white_nobg.png' : '/logo.png'}
          alt="Strike SCF"
          width={148}
          height={48}
          style={{
            objectFit: 'contain',
            objectPosition: 'center center',
            maxWidth: '100%',
            height: 'auto',
          }}
          priority
        />
        <span style={{
          fontFamily:    'var(--font-body)',
          fontSize:      10,
          fontWeight:    600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color:         'var(--gray-soft)',
        }}>
          {PORTAL_LABELS[portal]}
        </span>
      </div>

      {/* Unified navigation */}
      <nav className="nav-section" style={{ marginTop: 4 }}>
        {sections.map((section, si) => (
          <React.Fragment key={section.label ?? `top-${si}`}>
            {section.label && <div style={sectionLabelStyle}>{section.label}</div>}
            {section.items.map(item => {
              const active = bestLen >= 0 && matchLen(pathname, item.href) === bestLen
              return (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  className={`nav-item ${active ? 'active' : ''}`}
                  style={{ textDecoration: 'none' }}
                >
                  <Icon name={item.icon} className="nav-icon" />
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </Link>
              )
            })}
          </React.Fragment>
        ))}
      </nav>

      {/* User card */}
      <div ref={userMenuRef} style={{ marginTop: 'auto', position: 'relative' }}>
        {userMenuOpen && (
          <div style={{
            position:     'absolute',
            bottom:       '100%',
            left:         8,
            right:        8,
            marginBottom: 4,
            background:   'var(--white)',
            border:       '1px solid var(--border)',
            padding:      '4px 0',
            boxShadow:    '0 4px 16px rgba(0,0,0,0.12)',
            zIndex:       50,
          }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{userName}</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={() => { setUserMenuOpen(false); router.push('/settings') }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--ink)',
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
                fontSize: 13, color: 'var(--ink)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              type="button"
              onClick={() => { setUserMenuOpen(false); handleSignOut() }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: '#DC2626',
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
          style={{
            width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left',
            borderTop: '1px solid var(--border)', padding: 16,
          }}
        >
          <div className="avatar">{userInitials}</div>
          <div className="user-meta">
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{userName}</span>
            <span style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{userRole}</span>
          </div>
        </button>
      </div>
    </aside>
  )
}
