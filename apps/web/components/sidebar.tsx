'use client'
import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { usePortal, type PortalType } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import { useRoomsUnread } from '@/lib/use-rooms-unread'

// ── Role labels (v2 roles only) ──
const ROLE_LABELS: Record<string, string> = {
  bank_admin:          'Bank Admin',
  bank_credit_officer: 'Credit Officer',
  org_admin:           'Admin',
  org_member:          'Member',
  strike_admin:        'Strike Admin',
}

// ── localStorage keys ──
const COLLAPSE_KEY = 'strike_sidebar_collapsed'

// ── Unified navigation model ──
// `icon` is a key into NAV_ICONS (20×20 stroke-based inline SVGs, currentColor).
interface NavItem {
  label: string
  href: string
  icon: NavIconName
  badge?: string
}
interface NavSection {
  label?: string
  items: NavItem[]
}

// Anchor (buyer) + Supplier share the same unified nav.
// TA.4: "Settings" and "AI Agent" removed (pages stay; reachable via user button).
// TB.1/TB.2: "My Programs" + "Transactions" removed and the now-empty "Programs"
//            group dropped (pages stay; surfaced via /deals — TB.3).
// TF.3: "Strike AI" removed (page stays; reachable via the floating trigger — TF.2).
const ANCHOR_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',       href: '/dashboard',             icon: 'dashboard' },
      { label: 'Strike Place',    href: '/marketplace',           icon: 'marketplace' },
      { label: 'My Deals',        href: '/deals',                 icon: 'deals' },
      { label: 'Financing',       href: '/marketplace/financing', icon: 'financing' },
      { label: 'Networks',        href: '/networks',              icon: 'networks' },
      { label: 'Strike Rooms',    href: '/rooms',                 icon: 'rooms' },
      { label: 'Strike Passport', href: '/passport',              icon: 'passport' },
      { label: 'Analytics',       href: '/reporting',             icon: 'analytics' },
    ],
  },
]

const SUPPLIER_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',       href: '/dashboard',             icon: 'dashboard' },
      { label: 'Strike Place',    href: '/marketplace',           icon: 'marketplace' },
      { label: 'My Deals',        href: '/deals',                 icon: 'deals' },
      { label: 'Financing',       href: '/marketplace/financing', icon: 'financing' },
      { label: 'Networks',        href: '/networks',              icon: 'networks' },
      { label: 'Strike Rooms',    href: '/rooms',                 icon: 'rooms' },
      { label: 'Strike Passport', href: '/passport',              icon: 'passport' },
      { label: 'Analytics',       href: '/reporting',             icon: 'analytics' },
    ],
  },
]

// TA.5: Transactions, KYB Review, Settings removed from bank nav (pages stay).
// TA.6: Supply Graph kept but routed to /supply-graph (full-page "Coming Soon").
// TF.3: "Strike AI" removed (page stays; reachable via the floating trigger — TF.2).
const BANK_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',       href: '/dashboard',             icon: 'dashboard' },
      { label: 'Strike Place',    href: '/marketplace/financing', icon: 'marketplace' },
      { label: 'Programs',        href: '/programs',              icon: 'programs' },
      { label: 'Strike Passport', href: '/passport',              icon: 'passport' },
      { label: 'Reporting',       href: '/reporting',             icon: 'analytics' },
      { label: 'Supply Graph',    href: '/supply-graph',          icon: 'supply-graph' },
    ],
  },
]

// TF.3: "Strike AI" removed (page stays; reachable via the floating trigger — TF.2).
const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard',       href: '/dashboard', icon: 'dashboard' },
      { label: 'KYB Queue',       href: '/admin',     icon: 'analytics' },
      { label: 'Platform Stats',  href: '/admin',     icon: 'programs' },
      { label: 'Room Reports',    href: '/admin',     icon: 'rooms' },
      { label: 'Strike Passport', href: '/passport',  icon: 'passport' },
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

// ── Sidebar nav icons (TA.3) ──────────────────────────────────────────────
// All 20×20 viewBox, stroke-based (fill:none), inherit `currentColor` so the
// active/inactive color is driven by the parent `.nav-item` text color
// (active → var(--blue), inactive → var(--gray); see globals.css Track A region).
type NavIconName =
  | 'dashboard' | 'marketplace' | 'deals' | 'rooms' | 'passport'
  | 'programs'  | 'analytics'   | 'supply-graph' | 'ai' | 'financing'
  | 'notifications' | 'settings' | 'networks'

const NAV_ICONS: Record<NavIconName, React.ReactNode> = {
  // Dashboard — 4-square grid
  dashboard: (
    <>
      <rect x="3"  y="3"  width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="3"  width="6.5" height="6.5" rx="1.5" />
      <rect x="3"  y="10.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  // Strike Place / Marketplace — institutional building with columns
  marketplace: (
    <>
      <path d="M3 8l7-4 7 4" />
      <path d="M4 8v8M8 8v8M12 8v8M16 8v8" />
      <path d="M2.5 16.5h15" />
    </>
  ),
  // My Deals — handshake (two hands meeting)
  deals: (
    <>
      <path d="M9.5 7.5l-2-1.5a2 2 0 0 0-2.4.2L2.5 8.5" />
      <path d="M10.5 7.5l2-1.5a2 2 0 0 1 2.4.2l2.6 2.3" />
      <path d="M2.5 8.5v4l2.5 2 2 1.6a1.3 1.3 0 0 0 2-.3" />
      <path d="M17.5 8.5v4l-2.8 2.2-2.2-1.8-2-1.6" />
      <path d="M10 8.2l1.8 1.5a1.2 1.2 0 0 1-1.6 1.8L8.5 10" />
    </>
  ),
  // Strike Rooms — two overlapping speech bubbles
  rooms: (
    <>
      <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 12 6.5V10a1.5 1.5 0 0 1-1.5 1.5H7L4.5 13.5V11A1.5 1.5 0 0 1 3 9.5z" />
      <path d="M9 8.5h5A1.5 1.5 0 0 1 15.5 10v2A1.5 1.5 0 0 1 14 13.5h-.5l2 2.5v-2.5" />
    </>
  ),
  // Strike Passport — shield with checkmark
  passport: (
    <>
      <path d="M10 2.5l6 2.2v4.6c0 3.6-2.5 6.4-6 8.2-3.5-1.8-6-4.6-6-8.2V4.7z" />
      <path d="M7.3 9.8l2 2 3.4-3.6" />
    </>
  ),
  // Programs — 3 stacked horizontal bars
  programs: (
    <>
      <rect x="3" y="4"  width="14" height="3.2" rx="1.2" />
      <rect x="3" y="8.4" width="14" height="3.2" rx="1.2" />
      <rect x="3" y="12.8" width="14" height="3.2" rx="1.2" />
    </>
  ),
  // Analytics / Reporting — 3 bars with upward trend
  analytics: (
    <>
      <path d="M3 17V3" />
      <path d="M3 17h14" />
      <rect x="6"  y="11" width="2.6" height="4.5" rx="0.6" />
      <rect x="10" y="8"  width="2.6" height="7.5" rx="0.6" />
      <rect x="14" y="5"  width="2.6" height="10.5" rx="0.6" />
      <path d="M6 9l4-3 4-2" />
    </>
  ),
  // Supply Graph — 3 nodes connected by lines
  'supply-graph': (
    <>
      <circle cx="5"  cy="6"  r="2" />
      <circle cx="15" cy="6"  r="2" />
      <circle cx="10" cy="15" r="2" />
      <path d="M6.7 7.2L9 13.4M13.3 7.2L11 13.4M7 6h6" />
    </>
  ),
  // Strike AI — lightning bolt
  ai: (
    <path d="M11 2.5L4.5 11h4.2l-1 6.5L15 8.5h-4.2z" />
  ),
  // Financing — circular flow / refresh
  financing: (
    <>
      <path d="M16.5 5.5V9h-3.5" />
      <path d="M3.5 14.5V11h3.5" />
      <path d="M4.2 9a6 6 0 0 1 10.5-2.7L16.5 8" />
      <path d="M15.8 11a6 6 0 0 1-10.5 2.7L3.5 12" />
    </>
  ),
  // Notifications — bell
  notifications: (
    <>
      <path d="M5 8a5 5 0 0 1 10 0v3.5l1.5 2.5h-13L5 11.5z" />
      <path d="M8 16.5a2 2 0 0 0 4 0" />
    </>
  ),
  // Settings — gear (used in user menu)
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.2v2.2M10 15.6v2.2M2.2 10h2.2M15.6 10h2.2M4.5 4.5l1.6 1.6M13.9 13.9l1.6 1.6M15.5 4.5l-1.6 1.6M6.1 13.9L4.5 15.5" />
    </>
  ),
  // Networks — 3 circles connected by lines
  networks: (
    <>
      <circle cx="10" cy="4"  r="2" />
      <circle cx="3"  cy="15" r="2" />
      <circle cx="17" cy="15" r="2" />
      <line x1="10" y1="6"  x2="3.8"  y2="13.2" strokeLinecap="round" />
      <line x1="10" y1="6"  x2="16.2" y2="13.2" strokeLinecap="round" />
      <line x1="5"  y1="15" x2="15"   y2="15"   strokeLinecap="round" />
    </>
  ),
}

function NavIcon({ name, size = 20 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="nav-icon"
      aria-hidden="true"
    >
      {NAV_ICONS[name]}
    </svg>
  )
}

// Sprite-based small icon for the user menu chrome (settings/sun/moon/logout
// live in the shared #i-* sprite defined in app/layout.tsx).
function SpriteIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

// Collapse toggle chevrons (chevron-left expanded / chevron-right collapsed).
function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {collapsed
        ? <path d="M8 5l5 5-5 5" />
        : <path d="M12 5l-5 5 5 5" />}
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

  // TG.3 — live unread-rooms count for the Strike Rooms badge (ORG_NAV only).
  // Called unconditionally (hooks rule). Safe for every portal: the hook and its
  // /api/rooms/unread backend key off room_participants.user_id, so bank/admin
  // users (and orgs not in any room) get 0 with no error. 0 ⇒ no badge.
  const roomsUnread = useRoomsUnread()

  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'light'
    return localStorage.getItem('strike-theme') === 'dark' ? 'dark' : 'light'
  })

  // TA.2 — collapse state, persisted to localStorage (key: strike_sidebar_collapsed).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(COLLAPSE_KEY) === 'true'
  })

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.setAttribute('data-portal', portal)
    try { localStorage.setItem('strike-theme', theme) } catch {}
  }, [theme, portal])

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)) } catch {}
  }, [collapsed])

  // Collapsing closes the user menu so the popover never floats over icons-only chrome.
  useEffect(() => {
    if (collapsed) setUserMenuOpen(false)
  }, [collapsed])

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
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Logo + collapse toggle (TA.1 removed the portal label; TA.2 added the toggle) */}
      <div className="sidebar-head">
        {!collapsed && (
          <Image
            src={theme === 'dark' ? '/strike_white_nobg.png' : '/logo.png'}
            alt="Strike SCF"
            width={132}
            height={42}
            style={{
              objectFit: 'contain',
              objectPosition: 'left center',
              maxWidth: '100%',
              height: 'auto',
            }}
            priority
          />
        )}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CollapseChevron collapsed={collapsed} />
        </button>
      </div>

      {/* Unified navigation */}
      <nav className="nav-section" style={{ marginTop: 4 }}>
        {sections.map((section, si) => (
          <React.Fragment key={section.label ?? `top-${si}`}>
            {section.label && !collapsed && <div style={sectionLabelStyle}>{section.label}</div>}
            {section.label && collapsed && si > 0 && <div className="nav-section-divider" />}
            {section.items.map(item => {
              const active = bestLen >= 0 && matchLen(pathname, item.href) === bestLen
              // TG.3 — Strike Rooms (ORG_NAV only) gets a LIVE unread badge from the
              // realtime hook, overriding any static config string. Other items keep
              // their static badge. 0 ⇒ no badge.
              const isRooms = item.href === '/rooms'
              const badge = isRooms
                ? (roomsUnread > 0 ? (roomsUnread > 99 ? '99+' : String(roomsUnread)) : undefined)
                : item.badge
              return (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  className={`nav-item ${active ? 'active' : ''}`}
                  style={{ textDecoration: 'none' }}
                  // TA.2 — native tooltip surfaces the label when collapsed (icons-only).
                  title={collapsed ? item.label : undefined}
                  aria-label={badge ? `${item.label} (${badge} unread)` : item.label}
                >
                  {/* TG.3 — collapsed mode hides .nav-badge, so overlay a small dot on
                      the rooms icon to keep the unread signal visible icons-only. */}
                  {isRooms && collapsed && roomsUnread > 0 ? (
                    <span style={{ position: 'relative', display: 'inline-flex' }}>
                      <NavIcon name={item.icon} />
                      <span
                        aria-hidden="true"
                        style={{
                          position:     'absolute',
                          top:          -2,
                          right:        -2,
                          width:        8,
                          height:       8,
                          borderRadius: 'var(--radius-badge)',
                          background:   'var(--blue)',
                          boxShadow:    '0 0 0 2px var(--white)',
                        }}
                      />
                    </span>
                  ) : (
                    <NavIcon name={item.icon} />
                  )}
                  {!collapsed && <span>{item.label}</span>}
                  {badge && !collapsed && <span className="nav-badge">{badge}</span>}
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
            borderRadius: 'var(--radius-sm)',
            padding:      '4px 0',
            boxShadow:    'var(--shadow-elevated)',
            zIndex:       50,
            minWidth:     200,
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
              <SpriteIcon name="settings" size={14} />
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
              <SpriteIcon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              type="button"
              onClick={() => { setUserMenuOpen(false); handleSignOut() }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--color-red)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <SpriteIcon name="logout" size={14} />
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className="sidebar-footer"
          onClick={() => setUserMenuOpen(o => !o)}
          title={collapsed ? `${userName} — open menu` : undefined}
          aria-label="Open user menu"
          style={{
            width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left',
            borderTop: '1px solid var(--border)', padding: collapsed ? '14px 0' : 16,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <div className="avatar">{userInitials}</div>
          {!collapsed && (
            <div className="user-meta">
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{userName}</span>
              <span style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{userRole}</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  )
}
