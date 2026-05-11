'use client'
import React from 'react'

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

export function NotifBell({ count = 0 }: { count?: number }) {
  return (
    <button className="icon-btn" type="button" aria-label="Notifications">
      <Icon name="bell" size={16} />
      {count > 0 && <span className="dot">{count}</span>}
    </button>
  )
}

export function fmtMoney(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M'
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K'
  return '$' + n.toLocaleString()
}
