'use client'
// Presentational dashboard building blocks, extracted verbatim from
// app/(portal)/dashboard/page.tsx so both the real dashboard and the
// unauthenticated /tour walkthrough render the exact same component code —
// the tour feeds these static props instead of live fetch results. None of
// these fetch data themselves except NotifBell and AgentActivityTicker,
// which self-fetch real endpoints; the tour doesn't render either of those.
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { CountUp, Skeleton, SkeletonCard } from '@/components/motion'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

// ─── Types ────────────────────────────────────────────────────────────────────
export interface NotifItem {
  id: string; title: string; body: string
  created_at: string; read: boolean; deep_link?: string | null
}

export interface DealItem {
  id: string
  buyer_org_id: string
  supplier_org_id: string
  status: string
  goods_description: string | null
  total_value: number | null
  agreed_price: number | null
  counterparty: { id: string; legal_name: string | null; passport_score: number | null } | null
  user_role: 'buyer' | 'supplier'
}

export interface PassportData {
  organization: {
    passport_score: number | null
    network_visible: boolean
    passport_narrative: string | null
    risk_tier: string | null
    trade_count_total: number
    trade_volume_total: number
    avg_payment_days: number | null
  }
  avg_rating: number | null
  review_count: number
  org_view_count_30d: number
  bank_view_count_30d: number
}

export interface ActionCard { color: string; label: string; href: string; count: number }

export type KpiIconName = 'deals' | 'volume' | 'financing' | 'listings' | 'programs' | 'balance' | 'rate' | 'org'
export interface KpiItem {
  label: string
  value: number | null
  format?: (n: number) => string
  sub?: string
  valueColor?: string
  icon?: KpiIconName
  tint?: string
}

export interface AgentActivityItem {
  id: string
  text: string
  outcome: string
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function fmtRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const DEAL_STATUS_KEYS: Record<string, string> = {
  negotiating:         'deals.status.negotiating',
  agreed:              'deals.status.agreed',
  contract_pending:    'deals.status.contractPending',
  documents_pending:   'deals.status.documentsPending',
  confirmed:           'deals.status.confirmed',
  in_preparation:      'deals.status.inPreparation',
  shipped:             'deals.status.shipped',
  delivery_confirmed:  'deals.status.deliveryConfirmed',
  in_dispute:          'deals.status.inDispute',
  payment_due:         'deals.status.paymentDue',
  payment_overdue:     'deals.status.paymentOverdue',
  payment_confirmed:   'deals.status.paymentConfirmed',
  completed:           'deals.status.completed',
  cancelled:           'deals.status.cancelled',
  active:              'deals.status.active',
  financing_requested: 'deals.status.financingRequested',
  financing_active:    'deals.status.financingActive',
  disputed:            'deals.status.disputed',
}

export function dealStatusLabel(status: string, t: TFn): string {
  const key = DEAL_STATUS_KEYS[status]
  return key ? t(key) : status.replace(/_/g, ' ')
}

export function dealStatusClass(status: string): string {
  switch (status) {
    case 'completed':          return 'badge-completed'
    case 'cancelled':          return 'badge-rejected'
    case 'negotiating':        return 'badge-pending'
    case 'agreed':             return 'badge-active'
    case 'financing_requested':
    case 'financing_active':   return 'badge-funded'
    case 'active':             return 'badge-active'
    case 'disputed':           return 'badge-rejected'
    default:                   return 'badge-draft'
  }
}

export function scoreColor(score: number | null | undefined): string {
  if (!score) return 'var(--gray)'
  if (score >= 70) return 'var(--color-green)'
  if (score >= 45) return 'var(--color-amber)'
  return 'var(--color-red)'
}

export function scoreTierLabel(score: number | null | undefined, t: TFn): string {
  if (!score) return t('dashboardShared.tierUnrated')
  if (score >= 70) return t('dashboardShared.tierPreferred')
  if (score >= 45) return t('programDetail.standard')
  return t('dashboardShared.tierAtRisk')
}

export function scoreTierClass(score: number | null | undefined): string {
  if (!score) return 'badge-draft'
  if (score >= 70) return 'badge-funded'
  if (score >= 45) return 'badge-pending'
  return 'badge-rejected'
}

function timeAgoShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Icon ─────────────────────────────────────────────────────────────────────
function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
export function Topbar({ crumbs, actions }: {
  crumbs: Array<{ label: string; onClick?: () => void }>
  actions?: React.ReactNode
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="crumb-sep">›</span>}
            {c.onClick ? (
              <a onClick={c.onClick} className={i === 0 ? 'crumb-portal' : ''}>{c.label}</a>
            ) : (
              <span className={i === crumbs.length - 1 ? 'crumb-current' : (i === 0 ? 'crumb-portal' : '')}>{c.label}</span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <NotifBell />
        {actions}
      </div>
    </header>
  )
}

// ─── NotifBell ────────────────────────────────────────────────────────────────
export function NotifBell() {
  const router = useRouter()
  const t = useT()
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/notifications?limit=20')
      .then(r => r.json())
      .then(d => {
        setNotifications(d.notifications ?? [])
        setUnreadCount(d.unread_count ?? 0)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
    fetch(`/api/notifications/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => {})
  }

  function markAllRead() {
    const ids = notifications.filter(n => !n.read).map(n => n.id)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    ids.forEach(id => fetch(`/api/notifications/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => {}))
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn" type="button" aria-label={t('dashboardShared.notifications')}
        onClick={() => setOpen(o => !o)}
        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--gray)' }}
      >
        <Icon name="bell" size={16} />
      </button>
      {unreadCount > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          background: 'var(--color-red)', color: 'var(--white)',
          borderRadius: '50%', width: 16, height: 16,
          fontSize: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 600, pointerEvents: 'none',
        }}>{unreadCount}</span>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: 48, right: 0, width: 320,
          background: 'var(--white)', border: '1px solid var(--border)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('dashboardShared.notifications')}</span>
            {unreadCount > 0 && (
              <button type="button" style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={markAllRead}>
                {t('dashboardShared.markAllRead')}
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              {t('dashboardShared.noNotificationsYet')}
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.slice(0, 10).map(n => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markRead(n.id)
                    if (n.deep_link) router.push(n.deep_link)
                    setOpen(false)
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    borderLeft: n.read ? '2px solid transparent' : '2px solid var(--blue)',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{n.title}</div>
                  <div style={{ color: 'var(--gray)', fontSize: 12, marginTop: 2 }}>{n.body}</div>
                  <div style={{ color: 'var(--gray-soft)', fontSize: 11, marginTop: 4 }}>{fmtRelTime(n.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Dashboard Header (gradient hero) ─────────────────────────────────────────
export function DashboardHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle: React.ReactNode }) {
  return (
    <div className="page-header reveal" style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(120deg, rgba(20,40,204,0.05) 0%, rgba(124,58,237,0.05) 60%, transparent 100%)',
      border: '1px solid rgba(20,40,204,0.08)',
      borderRadius: 'var(--radius-card)',
      padding: '22px 26px',
      marginBottom: 24,
    }}>
      <div style={{
        position: 'absolute', top: -60, right: -60, width: 220, height: 220, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 70%)', pointerEvents: 'none',
      }} />
      {eyebrow && <div className="eyebrow" style={{ position: 'relative' }}>{eyebrow}</div>}
      <h1 style={{ position: 'relative', fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '4px 0' }}>
        {title}
      </h1>
      <div className="subtitle" style={{ position: 'relative' }}>{subtitle}</div>
    </div>
  )
}

// ─── Action Queue Strip ───────────────────────────────────────────────────────
export function ActionQueueStrip({ cards, loading, onCardClick }: { cards: ActionCard[]; loading: boolean; onCardClick?: (card: ActionCard) => void }) {
  const router = useRouter()
  const visible = cards.filter(c => c.count > 0)

  if (loading) {
    return (
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1 }}><SkeletonCard height={60} /></div>
        ))}
      </div>
    )
  }

  if (visible.length === 0) return null

  return (
    <div className="reveal-stagger" style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
      {visible.map((card, i) => (
        <button
          key={i}
          type="button"
          className="card-interactive"
          onClick={() => onCardClick ? onCardClick(card) : router.push(card.href)}
          style={{
            flex: '1 1 180px', minWidth: 0,
            background: 'var(--white)', border: '1px solid var(--border)',
            borderLeft: `3px solid ${card.color}`,
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, textAlign: 'left', fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>{card.label}</span>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
            letterSpacing: '-0.02em', color: card.color, flexShrink: 0,
          }}>
            <CountUp value={card.count} />
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────
const KPI_ICON_PATHS: Record<KpiIconName, React.ReactNode> = {
  deals:     <path d="M4 9l3-3 3 3M7 6v9M17 8l-3 3-3-3M14 11V2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  volume:    <><path d="M10 2v16M14 5.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.5S8 8 10 8s4 1.1 4 2.5-1.8 2.5-4 2.5-4-1.1-4-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>,
  financing: <><rect x="2.5" y="8" width="15" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M5.5 8V6a4.5 4.5 0 019 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>,
  listings:  <><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="11" y="2.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="11" y="11" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /></>,
  programs:  <><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M2.5 8h15" stroke="currentColor" strokeWidth="1.6" /></>,
  balance:   <><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M10 6v8M12.5 8.2c0-1-1.1-1.7-2.5-1.7s-2.5.7-2.5 1.7 1.1 1.5 2.5 1.5 2.5.6 2.5 1.6-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" /></>,
  rate:      <><path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><circle cx="14" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.6" fill="none" /></>,
  org:       <><path d="M4 17V4a1 1 0 011-1h6a1 1 0 011 1v13" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M12 9h3a1 1 0 011 1v7" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M6.5 6.5h1M6.5 9.5h1M6.5 12.5h1M9.5 6.5h1M9.5 9.5h1M9.5 12.5h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
}

function KpiIcon({ name, tint }: { name: KpiIconName; tint: string }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
      background: `color-mix(in srgb, ${tint} 14%, transparent)`,
      color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {KPI_ICON_PATHS[name]}
      </svg>
    </div>
  )
}

export function KpiStrip({ kpis, loading }: { kpis: KpiItem[]; loading: boolean }) {
  return (
    <div className="kpi-strip-4 reveal-stagger" style={{ marginBottom: 24 }}>
      {kpis.map((k, i) => (
        <div key={i} className="kpi-card-spark" style={{ background: 'var(--white)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <div className="kpi-label" style={{ marginBottom: 0 }}>{k.label}</div>
            {k.icon && <KpiIcon name={k.icon} tint={k.tint ?? 'var(--blue)'} />}
          </div>
          {loading ? (
            <div style={{ marginTop: 4, marginBottom: 4 }}><Skeleton height={24} width={80} /></div>
          ) : (
            <div className="kpi-value" style={{
              fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '-0.02em',
              color: k.valueColor ?? 'var(--ink)',
            }}>
              <CountUp value={k.value ?? NaN} format={k.format} />
            </div>
          )}
          {k.sub && <div className="kpi-delta kpi-delta-mut">{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── Passport Banner ──────────────────────────────────────────────────────────
export function PassportBanner({
  passport, loading, size = 'md', extras, onActivate, onViewPassport,
}: {
  passport: PassportData | null
  loading: boolean
  size?: 'md' | 'lg'
  extras?: React.ReactNode
  onActivate?: () => void
  onViewPassport?: () => void
}) {
  const router = useRouter()
  const t = useT()

  if (loading) return <div style={{ marginBottom: 24 }}><SkeletonCard height={96} /></div>

  // Ghost / pre-verification: no PassportScore yet. Show the inactive score ring
  // ("—", "Passport Inactive") with a nudge to activate (TD.2).
  if (!passport || !passport.organization.passport_score) {
    return (
      <div className="reveal" style={{
        marginBottom: 24, background: 'var(--white)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--color-amber)',
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '16px 20px', flexWrap: 'wrap',
      }}>
        <PassportScoreRing score={null} size={size} showLabel pendingLabel={t('marketplace.passportInactive')} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
            {t('marketplace.passportInactive')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.55 }}>
            {t('dashboardShared.completeVerificationHint')}
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onActivate ? onActivate() : router.push('/onboarding')}
          style={{ flexShrink: 0 }}>
          {t('marketplace.activatePassport')}
        </button>
      </div>
    )
  }

  const { organization: org, avg_rating, review_count, org_view_count_30d, bank_view_count_30d } = passport
  const score = org.passport_score

  return (
    <div className="reveal" style={{
      marginBottom: 24, background: 'var(--white)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--teal)',
      display: 'flex', alignItems: 'center', gap: 20,
      padding: '16px 20px', flexWrap: 'wrap',
    }}>
      <PassportScoreRing score={score} size={size} showLabel />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${scoreTierClass(score)}`}>{scoreTierLabel(score, t)}</span>
        </div>
        <div className="reveal-stagger" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { label: t('dealDetail.totalTrades'), value: org.trade_count_total, format: undefined as ((n: number) => string) | undefined },
            { label: t('financing.totalVolume'), value: org.trade_volume_total, format: fmtCurrency },
            ...(org.avg_payment_days != null ? [{ label: t('dashboardShared.onTimeRate'), value: org.avg_payment_days, format: (n: number) => t('dashboardShared.daysAvg', { n }) }] : []),
          ].map(stat => (
            <div key={stat.label}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 2 }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                <CountUp value={stat.value} format={stat.format} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {extras}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onViewPassport ? onViewPassport() : router.push('/passport')}>
        {t('listingDetail.viewPassport')}
      </button>
    </div>
  )
}

// ─── Live Agent Activity ticker ────────────────────────────────────────────────
// Ambient strip surfacing what the org's autonomous agent has actually been
// doing — the agent's work otherwise lives entirely inside the Agent tab.
export function AgentActivityTicker() {
  const router = useRouter()
  const t = useT()
  const [items, setItems] = useState<AgentActivityItem[]>([])
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/agents/activity?limit=6')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.items) setItems(d.items) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setIndex(i => (i + 1) % items.length), 4500)
    return () => clearInterval(t)
  }, [items.length])

  if (!loaded || items.length === 0) return null
  const current = items[index]!

  return (
    <div
      className="ai-sheen card-interactive reveal"
      onClick={() => router.push('/ai?tab=agent')}
      style={{
        marginBottom: 24, background: 'var(--white)', borderRadius: 'var(--radius-card)',
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', cursor: 'pointer',
      }}
    >
      <span className="ai-breathe" style={{
        width: 8, height: 8, borderRadius: '50%', background: 'var(--gradient-ai)', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--blue)', flexShrink: 0,
      }}>
        {t('dashboardShared.yourAgent')}
      </span>
      <span key={current.id} className="fade-in" style={{
        fontSize: 13, color: 'var(--ink)', flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {current.text}
      </span>
      <span style={{ fontSize: 12, color: 'var(--gray)', flexShrink: 0 }}>{timeAgoShort(current.created_at)}</span>
      {items.length > 1 && (
        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {items.map((it, i) => (
            <span key={it.id} style={{
              width: 4, height: 4, borderRadius: '50%',
              background: i === index ? 'var(--blue)' : 'var(--border-strong)',
            }} />
          ))}
        </span>
      )}
    </div>
  )
}

// ─── Deal Table (shared by anchor + supplier) ─────────────────────────────────
export function DealTable({ deals, loading, emptyTitle, emptySub, emptyCta, onRowClick }: {
  deals: DealItem[]
  loading: boolean
  emptyTitle: string
  emptySub: string
  emptyCta: React.ReactNode
  onRowClick?: (deal: DealItem) => void
}) {
  const router = useRouter()
  const t = useT()
  const activeDeals = deals.filter(d => !['completed', 'cancelled'].includes(d.status)).slice(0, 5)

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
        {[1, 2, 3].map(i => <SkeletonCard key={i} height={48} />)}
      </div>
    )
  }

  if (activeDeals.length === 0) {
    return (
      <div className="float-slow" style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>{emptyTitle}</div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>{emptySub}</div>
        {emptyCta}
      </div>
    )
  }

  return (
    <table className="table" style={{ tableLayout: 'fixed' }}>
      <thead>
        <tr>
          <th style={{ width: '26%' }}>{t('deals.col.counterparty')}</th>
          <th style={{ width: '30%' }}>{t('financingDetail.goods')}</th>
          <th className="amount" style={{ width: '15%' }}>{t('dealImport.value')}</th>
          <th style={{ width: '18%' }}>{t('financing.status')}</th>
          <th style={{ width: '11%' }}></th>
        </tr>
      </thead>
      <tbody className="reveal-stagger">
        {activeDeals.map(deal => (
          <tr key={deal.id} className="card-interactive" onClick={() => onRowClick ? onRowClick(deal) : router.push(`/deals/${deal.id}`)}>
            <td>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {deal.counterparty?.legal_name ?? t('rooms.unknown')}
              </div>
              {deal.counterparty?.passport_score != null && (
                <div style={{ fontSize: 11, color: scoreColor(deal.counterparty.passport_score), marginTop: 1 }}>
                  {t('dashboardShared.scoreValue', { score: deal.counterparty.passport_score })}
                </div>
              )}
            </td>
            <td>
              <div style={{ fontSize: 12, color: 'var(--gray)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {(deal.goods_description ?? '—').slice(0, 40)}
              </div>
            </td>
            <td className="amount">{deal.total_value ? fmtCurrency(deal.total_value) : '—'}</td>
            <td><span className={`badge ${dealStatusClass(deal.status)}`}>{dealStatusLabel(deal.status, t)}</span></td>
            <td className="row-actions">
              <a href={`/deals/${deal.id}`} className="btn btn-sm btn-ghost" onClick={(e) => e.stopPropagation()}>{t('marketplace.view')}</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
