'use client'
import React, { useState, useEffect } from 'react'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { AIInsight } from '@/components/ai-insight'
import { AIInsightCard } from '@/components/ai-insight-card'
import { SupplyGraph } from '@/components/supply-graph'
import { PassportScoreRing } from '@/components/passport-score-ring'

// ─── Types ────────────────────────────────────────────────────────────────────
interface BankData {
  portal: 'bank'
  bank_name: string | null
  program_count: number
  active_program_count: number
  enrolled_org_count: number
  kyb_pending: number
  pending_bank_review: number
  active_transactions: number
  outstanding_balance: number
  avg_rate?: number | null
  // TC.6 — portfolio PassportScore distribution (replaces KYB Queue widget)
  passport_distribution?: {
    total: number
    avg_score: number | null
    strong: number
    fair: number
    weak: number
    pending: number
  }
}
interface AnchorData {
  portal: 'anchor'
  org_name: string | null
  programs: Array<{ id: string; name: string; financing_types: string[]; status: string }>
  enrolled_supplier_count: number
  pending_approval: number
}
interface SupplierData {
  portal: 'supplier'
  org_name: string | null
  programs: Array<{ id: string; name: string; financing_types: string[]; status: string }>
  active_transactions: number
  performance_tier?: string
  performance_score?: number | null
  on_time_rate?: number | null
  total_financed?: number
}

interface NotifItem {
  id: string; title: string; body: string
  created_at: string; read: boolean; deep_link?: string | null
}

interface FinancingItem {
  request: {
    id: string
    amount_requested: number
    structure_type: string
    status: string
    ai_risk_assessment: string | null
    offer_count: number
  }
  buyer_passport: { legal_name: string | null; passport_score: number | null } | null
  supplier_passport: { legal_name: string | null; passport_score: number | null } | null
  all_offers_count: number
}

interface DealItem {
  id: string
  buyer_org_id: string
  supplier_org_id: string
  status: string
  goods_description: string | null
  total_value: number | null
  counterparty: { id: string; legal_name: string | null; passport_score: number | null } | null
  user_role: 'buyer' | 'supplier'
}

interface ListingItem {
  listing: { id: string; title: string; offer_count: number; status: string }
}

interface OrgFinancingReq {
  id: string
  amount_requested: number
  structure_type: string
  status: string
  offer_count: number
}

interface PassportData {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function fmtRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function todayFull(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function dealStatusClass(status: string): string {
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

function financingStatusClass(status: string): string {
  switch (status) {
    case 'open':            return 'badge-active'
    case 'offers_received': return 'badge-offer'
    case 'accepted':        return 'badge-funded'
    case 'funded':          return 'badge-completed'
    default:                return 'badge-draft'
  }
}

function structureBadgeClass(s: string): string {
  switch (s) {
    case 'open':   return 'badge-active'
    case 'custom': return 'badge-signing'
    case 'preset': return 'badge-funded'
    default:       return 'badge-draft'
  }
}

function scoreColor(score: number | null | undefined): string {
  if (!score) return 'var(--gray)'
  if (score >= 70) return 'var(--color-green)'
  if (score >= 45) return 'var(--color-amber)'
  return 'var(--color-red)'
}

function scoreTierLabel(score: number | null | undefined): string {
  if (!score) return 'Unrated'
  if (score >= 70) return 'Preferred'
  if (score >= 45) return 'Standard'
  return 'At Risk'
}

function scoreTierClass(score: number | null | undefined): string {
  if (!score) return 'badge-draft'
  if (score >= 70) return 'badge-funded'
  if (score >= 45) return 'badge-pending'
  return 'badge-rejected'
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
function Topbar({ crumbs, actions }: {
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
function NotifBell() {
  const router = useRouter()
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
        className="icon-btn" type="button" aria-label="Notifications"
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
            <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              No notifications yet
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

// ─── Skeleton primitives ──────────────────────────────────────────────────────
function SkeletonBlock({ height = 80, width = '100%' }: { height?: number; width?: string | number }) {
  return (
    <div style={{
      background: 'var(--border)', height, width,
      animation: 'skeleton-pulse 1.8s ease infinite',
    }} />
  )
}

function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--border)',
      height, animation: 'skeleton-pulse 1.8s ease infinite',
    }} />
  )
}

// ─── Action Queue Strip ───────────────────────────────────────────────────────
interface ActionCard { color: string; label: string; href: string; count: number }

function ActionQueueStrip({ cards, loading }: { cards: ActionCard[]; loading: boolean }) {
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
    <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
      {visible.map((card, i) => (
        <button
          key={i}
          type="button"
          onClick={() => router.push(card.href)}
          style={{
            flex: '1 1 180px', minWidth: 0,
            background: 'var(--white)', border: '1px solid var(--border)',
            borderLeft: `3px solid ${card.color}`,
            padding: '12px 16px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, textAlign: 'left', fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>{card.label}</span>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
            letterSpacing: '-0.02em', color: card.color, flexShrink: 0,
          }}>
            {card.count}
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────
interface KpiItem { label: string; value: string; sub?: string; valueColor?: string }

function KpiStrip({ kpis, loading }: { kpis: KpiItem[]; loading: boolean }) {
  return (
    <div className="kpi-strip-4" style={{ marginBottom: 24 }}>
      {kpis.map((k, i) => (
        <div key={i} className="kpi-card-spark" style={{ background: 'var(--white)' }}>
          <div className="kpi-label">{k.label}</div>
          {loading ? (
            <div style={{ marginTop: 4, marginBottom: 4 }}><SkeletonBlock height={24} width={80} /></div>
          ) : (
            <div className="kpi-value" style={{
              fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '-0.02em',
              color: k.valueColor ?? 'var(--ink)',
            }}>{k.value}</div>
          )}
          {k.sub && <div className="kpi-delta kpi-delta-mut">{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── Passport Banner ──────────────────────────────────────────────────────────
function PassportBanner({
  passport, loading, size = 'md', extras,
}: {
  passport: PassportData | null
  loading: boolean
  size?: 'md' | 'lg'
  extras?: React.ReactNode
}) {
  const router = useRouter()

  if (loading) return <div style={{ marginBottom: 24 }}><SkeletonCard height={96} /></div>

  // Ghost / pre-verification: no PassportScore yet. Show the inactive score ring
  // ("—", "Passport Inactive") with a nudge to activate (TD.2).
  if (!passport || !passport.organization.passport_score) {
    return (
      <div style={{
        marginBottom: 24, background: 'var(--white)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--color-amber)',
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '16px 20px', flexWrap: 'wrap',
      }}>
        <PassportScoreRing score={null} size={size} showLabel pendingLabel="Passport Inactive" />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
            Passport Inactive
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.55 }}>
            Complete verification to get your PassportScore and unlock the platform.
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push('/onboarding')}
          style={{ flexShrink: 0 }}>
          Activate Passport →
        </button>
      </div>
    )
  }

  const { organization: org, avg_rating, review_count, org_view_count_30d, bank_view_count_30d } = passport
  const score = org.passport_score

  return (
    <div style={{
      marginBottom: 24, background: 'var(--white)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--teal)',
      display: 'flex', alignItems: 'center', gap: 20,
      padding: '16px 20px', flexWrap: 'wrap',
    }}>
      <PassportScoreRing score={score} size={size} showLabel />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${scoreTierClass(score)}`}>{scoreTierLabel(score)}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Trades', value: String(org.trade_count_total) },
            { label: 'Total Volume', value: fmtCurrency(org.trade_volume_total) },
            ...(org.avg_payment_days != null ? [{ label: 'On-Time Rate', value: `${org.avg_payment_days}d avg` }] : []),
          ].map(stat => (
            <div key={stat.label}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 2 }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
      {extras}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push('/passport')}>
        View Passport →
      </button>
    </div>
  )
}

// ─── Deal Table (shared by anchor + supplier) ─────────────────────────────────
function DealTable({ deals, loading, emptyTitle, emptySub, emptyCta }: {
  deals: DealItem[]
  loading: boolean
  emptyTitle: string
  emptySub: string
  emptyCta: React.ReactNode
}) {
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
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
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
          <th style={{ width: '26%' }}>Counterparty</th>
          <th style={{ width: '30%' }}>Goods</th>
          <th className="amount" style={{ width: '15%' }}>Value</th>
          <th style={{ width: '18%' }}>Status</th>
          <th style={{ width: '11%' }}></th>
        </tr>
      </thead>
      <tbody>
        {activeDeals.map(deal => (
          <tr key={deal.id}>
            <td>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {deal.counterparty?.legal_name ?? 'Unknown'}
              </div>
              {deal.counterparty?.passport_score != null && (
                <div style={{ fontSize: 11, color: scoreColor(deal.counterparty.passport_score), marginTop: 1 }}>
                  Score {deal.counterparty.passport_score}
                </div>
              )}
            </td>
            <td>
              <div style={{ fontSize: 12, color: 'var(--gray)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {(deal.goods_description ?? '—').slice(0, 40)}
              </div>
            </td>
            <td className="amount">{deal.total_value ? fmtCurrency(deal.total_value) : '—'}</td>
            <td><span className={`badge ${dealStatusClass(deal.status)}`}>{deal.status.replace(/_/g, ' ')}</span></td>
            <td className="row-actions">
              <a href={`/deals/${deal.id}`} className="btn btn-sm btn-ghost">View</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── BANK DASHBOARD ──────────────────────────────────────────────────────────
// TC.6 — PassportScore Overview widget. Distribution of portfolio passport_scores;
// replaces the bank "KYB Queue" widget (banks evaluate via PassportScore, not KYB).
function PassportOverviewWidget({
  dist,
  loading,
}: {
  dist?: { total: number; avg_score: number | null; strong: number; fair: number; weak: number; pending: number }
  loading: boolean
}) {
  const segments = dist
    ? [
        { key: 'strong',  label: 'Strong 70+',  value: dist.strong,  color: 'var(--color-green)' },
        { key: 'fair',    label: 'Fair 45–69',  value: dist.fair,    color: 'var(--color-amber)' },
        { key: 'weak',    label: 'Weak <45',    value: dist.weak,    color: 'var(--color-red)' },
        { key: 'pending', label: 'Pending',     value: dist.pending, color: 'var(--gray-soft)' },
      ]
    : []
  const total = dist?.total ?? 0

  return (
    <div className="card">
      <div className="card-head">
        <span>PassportScore Overview</span>
        <a href="/reporting" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>Portfolio →</a>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        {loading ? (
          <SkeletonBlock height={48} />
        ) : !dist || total === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gray)', textAlign: 'center', padding: '12px 0' }}>
            No counterparties in your portfolio yet.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <PassportScoreRing score={dist.avg_score} size="sm" />
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                  Avg PassportScore
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
                  {dist.avg_score ?? '—'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--gray)' }}>{total} counterpart{total === 1 ? 'y' : 'ies'}</div>
              </div>
            </div>

            {/* Distribution bar */}
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--border)', marginBottom: 12 }}>
              {segments.filter(s => s.value > 0).map(s => (
                <div key={s.key} title={`${s.label}: ${s.value}`} style={{ flex: s.value, background: s.color }} />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {segments.map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--gray)', flex: 1 }}>{s.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BankDashboard() {
  const user = useUser()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<BankData | null>(null)
  const [financing, setFinancing] = useState<FinancingItem[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([dash, fin, notifs]) => {
      if (dash?.portal === 'bank') setDashData(dash as BankData)
      const rawRequests: unknown[] = (fin as any)?.requests ?? []
      setFinancing(rawRequests.slice(0, 5) as FinancingItem[])
      setNotifications(((notifs as any)?.notifications ?? []) as NotifItem[])
      setLoading(false)
    })
  }, [])

  // TC.6 — banks no longer approve KYB; the KYB review queue is removed from the
  // bank dashboard. Counterparties are evaluated via PassportScore (widget below).
  const openFinancing = financing.length
  const txnsPending = dashData?.pending_bank_review ?? 0
  const attentionCount = openFinancing + txnsPending

  const actionCards: ActionCard[] = [
    { color: 'var(--blue)', label: `${openFinancing} open Strike Place request${openFinancing !== 1 ? 's' : ''}`, count: openFinancing, href: '/marketplace/financing' },
    { color: 'var(--color-amber)', label: `${txnsPending} transaction${txnsPending !== 1 ? 's' : ''} awaiting review`, count: txnsPending, href: '/transactions' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Programs',    value: loading ? '—' : String(dashData?.active_program_count ?? 0), sub: dashData ? `${dashData.program_count} total` : undefined },
    { label: 'Outstanding Balance', value: loading ? '—' : fmtCurrency(dashData?.outstanding_balance ?? 0), valueColor: 'var(--blue)' },
    { label: 'Avg Financing Rate', value: loading ? '—' : (dashData?.avg_rate != null ? `${dashData.avg_rate}%` : '—') },
    { label: 'Enrolled Orgs',     value: loading ? '—' : String(dashData?.enrolled_org_count ?? 0) },
  ]

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page">

        {/* 1. Page header */}
        <div className="page-header">
          <div className="eyebrow">{dashData?.bank_name ?? 'Bank'} · Command Center</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '4px 0' }}>
            Good {greeting()}, {firstName}
          </h1>
          <div className="subtitle">
            {loading ? 'Loading…'
              : attentionCount > 0
              ? `${attentionCount} item${attentionCount !== 1 ? 's' : ''} need your attention · ${todayFull()}`
              : `Everything is up to date · ${todayFull()}`
            }
          </div>
        </div>

        {dashData && (
          <div style={{ marginBottom: 24 }}>
            <AIInsightCard
              variant="banner"
              portal="bank"
              page="dashboard"
              context={{
                bank_name: dashData.bank_name,
                active_programs: dashData.active_program_count,
                total_programs: dashData.program_count,
                enrolled_orgs: dashData.enrolled_org_count,
                kyb_pending: dashData.kyb_pending,
                pending_bank_review: dashData.pending_bank_review,
                active_transactions: dashData.active_transactions,
                outstanding_balance: dashData.outstanding_balance,
              }}
            />
          </div>
        )}

        {/* 2. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 3. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 4. Two-column */}
        <div className="split-65" style={{ marginBottom: 24 }}>

          {/* LEFT — Strike Place */}
          <div className="card">
            <div className="card-head">
              <span>Strike Place</span>
              <a href="/marketplace/financing" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[1, 2, 3].map(i => <SkeletonCard key={i} height={96} />)}
              </div>
            ) : financing.length === 0 ? (
              <div style={{ padding: '36px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>No open financing requests right now</div>
                <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Check back soon or browse Strike Place.</div>
                <a href="/marketplace/financing" className="btn btn-sm btn-ghost">Browse Strike Place →</a>
              </div>
            ) : (
              <div>
                {financing.map((item) => (
                  <div key={item.request.id} style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
                        letterSpacing: '-0.02em', color: 'var(--ink)',
                      }}>
                        {fmtCurrency(item.request.amount_requested)}
                      </span>
                      <span className={`badge ${structureBadgeClass(item.request.structure_type)}`}>
                        {item.request.structure_type}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <PassportScoreRing score={item.buyer_passport?.passport_score ?? null} size="sm" />
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Buyer</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <PassportScoreRing score={item.supplier_passport?.passport_score ?? null} size="sm" />
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Supplier</span>
                      </div>
                      {item.request.ai_risk_assessment && (
                        <div style={{
                          flex: 1, fontSize: 12, color: 'var(--gray)', fontStyle: 'italic',
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                        }}>
                          {item.request.ai_risk_assessment}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <a href={`/marketplace/financing/${item.request.id}`} className="btn btn-sm btn-blue">Submit Offer</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT — PassportScore Overview + Recent Activity + AI Insight */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* TC.6 — PassportScore Overview (replaces the KYB Queue widget) */}
            <PassportOverviewWidget dist={dashData?.passport_distribution} loading={loading} />

            <div className="card">
              <div className="card-head">
                <span>Recent Activity</span>
              </div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1, 2, 3].map(i => <SkeletonBlock key={i} height={12} />)}
                </div>
              ) : notifications.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
                  No recent activity
                </div>
              ) : (
                <div className="dash-activity">
                  {notifications.map(n => (
                    <div key={n.id} className="dash-act-row">
                      <div className={`dash-act-dot ${n.read ? '' : 'tone-blue'}`} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="dash-act-text" style={{ fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--gray)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.body}</div>
                      </div>
                      <div className="dash-act-time">{fmtRelTime(n.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--blue)' }}>
                View all notifications →
              </div>
            </div>

            <AIInsight
              title="Portfolio Insight"
              collapsed={true}
              prompt="Based on this bank's portfolio, what is the single most important action the bank should take today? Be specific and direct."
              context={{
                active_programs: dashData?.active_program_count ?? 0,
                portfolio_avg_passport_score: dashData?.passport_distribution?.avg_score ?? null,
                portfolio_weak_scores: dashData?.passport_distribution?.weak ?? 0,
                transactions_pending_review: dashData?.pending_bank_review ?? 0,
                outstanding_balance: dashData?.outstanding_balance ?? 0,
                enrolled_orgs: dashData?.enrolled_org_count ?? 0,
                open_strike_place_requests: openFinancing,
              }}
            />
          </div>
        </div>

        {/* 5. Supply graph */}
        <SupplyGraph bankId={''} />
      </div>
    </>
  )
}

// ─── ANCHOR (BUYER) DASHBOARD ────────────────────────────────────────────────
function AnchorDashboard() {
  const user = useUser()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<AnchorData | null>(null)
  const [deals, setDeals] = useState<DealItem[]>([])
  const [listings, setListings] = useState<ListingItem[]>([])
  const [financing, setFinancing] = useState<OrgFinancingReq[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [passport, setPassport] = useState<PassportData | null>(null)

  useEffect(() => {
    const orgId = user?.org_id
    const base: Promise<unknown>[] = [
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/deals').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/listings?own=true&limit=3').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
      orgId
        ? fetch(`/api/passport/${orgId}`).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
    ]

    Promise.all(base).then(([dash, dealsRes, listRes, finRes, notifRes, passRes]) => {
      if ((dash as any)?.portal === 'anchor') setDashData(dash as AnchorData)
      setDeals(((dealsRes as any)?.deals ?? []) as DealItem[])
      setListings((((listRes as any)?.listings ?? []) as ListingItem[]).slice(0, 3))
      setFinancing((((finRes as any)?.requests ?? []) as OrgFinancingReq[]).slice(0, 3))
      setNotifications(((notifRes as any)?.notifications ?? []) as NotifItem[])
      if (passRes) setPassport(passRes as PassportData)
      setLoading(false)
    })
  }, [user?.org_id])

  const activeDeals = deals.filter(d => !['completed', 'cancelled'].includes(d.status))
  const completedVolume = deals.filter(d => d.status === 'completed').reduce((s, d) => s + (d.total_value ?? 0), 0)
  const financingActiveAmt = financing.filter(f => ['open', 'offers_received', 'accepted'].includes(f.status)).reduce((s, f) => s + f.amount_requested, 0)

  const dealsNeedingAction = deals.filter(d => d.status === 'negotiating' && d.user_role === 'buyer').length
  const listingsWithOffers = listings.filter(l => l.listing.offer_count > 0).length
  const financingWithOffers = financing.filter(f => f.status === 'offers_received').length

  const actionCards: ActionCard[] = [
    { color: 'var(--color-amber)', label: `${dealsNeedingAction} deal${dealsNeedingAction !== 1 ? 's' : ''} awaiting your action`, count: dealsNeedingAction, href: '/deals' },
    { color: 'var(--blue)', label: `${listingsWithOffers} listing${listingsWithOffers !== 1 ? 's' : ''} with offers`, count: listingsWithOffers, href: '/marketplace/listings' },
    { color: 'var(--color-green)', label: `${financingWithOffers} financing offer${financingWithOffers !== 1 ? 's' : ''} received`, count: financingWithOffers, href: '/marketplace/financing' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Deals',         value: loading ? '—' : String(activeDeals.length) },
    { label: 'Trade Volume',         value: loading ? '—' : fmtCurrency(completedVolume), sub: 'Completed deals', valueColor: completedVolume > 0 ? 'var(--color-green)' : undefined },
    { label: 'Financing Active',     value: loading ? '—' : fmtCurrency(financingActiveAmt), valueColor: financingActiveAmt > 0 ? 'var(--blue)' : undefined },
    { label: 'Strike Place Listings', value: loading ? '—' : String(listings.length) },
  ]

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page">

        {/* 1. Header */}
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '4px 0' }}>
            Good {greeting()}, {firstName}
          </h1>
          <div className="subtitle">{dashData?.org_name ?? ''}{dashData?.org_name ? ' · ' : ''}{todayFull()}</div>
        </div>

        {/* AI Overview — only mount after data loads so context is populated */}
        {!loading && (
          <div style={{ marginBottom: 20 }}>
            <AIInsightCard
              variant="banner"
              portal="anchor"
              page="dashboard"
              context={{
                org_name: dashData?.org_name,
                active_deals: activeDeals.length,
                deals_needing_action: dealsNeedingAction,
                listings_with_offers: listingsWithOffers,
                pending_financing: financing?.length ?? 0,
                completed_deal_volume: completedVolume,
              }}
            />
          </div>
        )}

        {/* 2. PassportScore banner */}
        <PassportBanner passport={passport} loading={loading} size="md" />

        {/* 3. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 4. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 5. Two-column */}
        <div className="split-65" style={{ marginBottom: 24 }}>

          {/* LEFT — My Deals */}
          <div className="card">
            <div className="card-head">
              <span>Active Deals</span>
              <a href="/deals" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            <DealTable
              deals={deals}
              loading={loading}
              emptyTitle="No active deals yet."
              emptySub=""
              emptyCta={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/marketplace" className="btn btn-sm btn-blue">Browse Strike Place</a>
                  <a href="/deals/import" className="btn btn-sm btn-ghost">Finance Existing Trade</a>
                </div>
              }
            />
          </div>

          {/* RIGHT — My Listings + Financing */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head">
                <span>My Listings</span>
                <a href="/marketplace/listings/new" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>+ New</a>
              </div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2].map(i => <SkeletonBlock key={i} height={14} />)}
                </div>
              ) : listings.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No listings yet</div>
              ) : (
                <div>
                  {listings.map(item => (
                    <div key={item.listing.id} style={{
                      padding: '10px 16px', borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {item.listing.title}
                      </div>
                      {item.listing.offer_count > 0 && (
                        <span className="badge badge-offer">{item.listing.offer_count} offer{item.listing.offer_count !== 1 ? 's' : ''}</span>
                      )}
                      <span className={`badge ${dealStatusClass(item.listing.status)}`}>{item.listing.status}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/marketplace/listings/new" className="btn btn-sm btn-primary" style={{ display: 'block', textAlign: 'center' }}>Post a Listing</a>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span>Financing Requests</span></div>
              {loading ? (
                <div style={{ padding: 16 }}><SkeletonBlock height={14} /></div>
              ) : financing.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No financing requests yet</div>
              ) : (
                <div>
                  {financing.map(f => (
                    <div key={f.id} style={{
                      padding: '10px 16px', borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtCurrency(f.amount_requested)}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{f.structure_type}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span className={`badge ${financingStatusClass(f.status)}`}>{f.status.replace(/_/g, ' ')}</span>
                        {f.offer_count > 0 && <span style={{ fontSize: 11, color: 'var(--gray)' }}>{f.offer_count} offer{f.offer_count !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/deals" className="btn btn-sm btn-ghost" style={{ display: 'block', textAlign: 'center' }}>Request Financing</a>
              </div>
            </div>
          </div>
        </div>

        {/* 6. AI Insight */}
        <AIInsight
          title="Trade Intelligence"
          collapsed={true}
          prompt={`This buyer has ${activeDeals.length} active deals worth $${completedVolume.toFixed(0)} total. They have ${listings.length} Strike Place listings and ${financing.length} financing requests. What should they focus on today to accelerate their trade activity?`}
          context={{
            active_deals: activeDeals.length,
            completed_deal_volume: completedVolume,
            marketplace_listings: listings.length,
            financing_requests: financing.length,
            listings_with_offers: listingsWithOffers,
            financing_with_offers: financingWithOffers,
          }}
        />
      </div>
    </>
  )
}

// ─── SUPPLIER DASHBOARD ──────────────────────────────────────────────────────
function SupplierDashboard() {
  const user = useUser()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<SupplierData | null>(null)
  const [deals, setDeals] = useState<DealItem[]>([])
  const [financing, setFinancing] = useState<OrgFinancingReq[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [passport, setPassport] = useState<PassportData | null>(null)
  const [pendingNetworks, setPendingNetworks] = useState<any[]>([])
  const router = useRouter()

  useEffect(() => {
    const orgId = user?.org_id
    const base: Promise<unknown>[] = [
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/deals').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
      orgId
        ? fetch(`/api/passport/${orgId}`).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      fetch('/api/networks/supplier').then(r => r.ok ? r.json() : null).catch(() => null),
    ]

    Promise.all(base).then(([dash, dealsRes, finRes, notifRes, passRes, networkRes]) => {
      if ((dash as any)?.portal === 'supplier') setDashData(dash as SupplierData)
      setDeals(((dealsRes as any)?.deals ?? []) as DealItem[])
      setFinancing((((finRes as any)?.requests ?? []) as OrgFinancingReq[]).slice(0, 3))
      setNotifications(((notifRes as any)?.notifications ?? []) as NotifItem[])
      if (passRes) setPassport(passRes as PassportData)
      const nets = (networkRes as any)?.networks ?? []
      setPendingNetworks(nets.filter((n: any) => n.membership?.status === 'invited'))
      setLoading(false)
    })
  }, [user?.org_id])

  const activeDeals = deals.filter(d => !['completed', 'cancelled'].includes(d.status))
  const completedDeals = deals.filter(d => d.status === 'completed').length
  const totalFinanced = financing.filter(f => ['accepted', 'funded'].includes(f.status)).reduce((s, f) => s + f.amount_requested, 0)

  const dealsNeedingAction = deals.filter(d =>
    (d.status === 'negotiating' && d.user_role === 'supplier') || d.status === 'agreed'
  ).length
  const financingWithOffers = financing.filter(f => f.status === 'offers_received').length

  const actionCards: ActionCard[] = [
    { color: 'var(--color-amber)', label: `${dealsNeedingAction} deal${dealsNeedingAction !== 1 ? 's' : ''} awaiting your action`, count: dealsNeedingAction, href: '/deals' },
    { color: 'var(--blue)', label: `${financingWithOffers} financing offer${financingWithOffers !== 1 ? 's' : ''} to review`, count: financingWithOffers, href: '/marketplace/financing' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Deals',    value: loading ? '—' : String(activeDeals.length) },
    { label: 'Total Financed',  value: loading ? '—' : fmtCurrency(totalFinanced), valueColor: totalFinanced > 0 ? 'var(--color-green)' : undefined },
    { label: 'Completed Deals', value: loading ? '—' : String(completedDeals), sub: 'Track record' },
    { label: 'Bank Views',      value: loading ? '—' : String(passport?.bank_view_count_30d ?? 0), sub: 'Last 30 days' },
  ]

  const passportExtras = passport ? (
    <div style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 'auto', textAlign: 'right', flexShrink: 0 }}>
      <div>Viewed by <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{passport.bank_view_count_30d}</strong> banks this month</div>
      {passport.organization.passport_narrative && (
        <div style={{
          marginTop: 4, maxWidth: 220, fontStyle: 'italic',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          "{passport.organization.passport_narrative.slice(0, 120)}{passport.organization.passport_narrative.length > 120 ? '…' : ''}"
        </div>
      )}
    </div>
  ) : undefined

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page">

        {/* 1. Header */}
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '4px 0' }}>
            Good {greeting()}, {firstName}
          </h1>
          <div className="subtitle">{dashData?.org_name ?? ''}{dashData?.org_name ? ' · ' : ''}{todayFull()}</div>
        </div>

        {/* AI Overview — only mount after data loads so context is populated */}
        {!loading && (
          <div style={{ marginBottom: 20 }}>
            <AIInsightCard
              variant="banner"
              portal="supplier"
              page="dashboard"
              context={{
                org_name: dashData?.org_name,
                active_deals: activeDeals.length,
                deals_needing_action: dealsNeedingAction,
                pending_financing: financing?.length ?? 0,
                total_financed: totalFinanced,
                completed_deals: completedDeals,
                passport_score: passport?.organization?.passport_score ?? null,
              }}
            />
          </div>
        )}

        {/* 2. PassportScore banner */}
        <PassportBanner passport={passport} loading={loading} size="lg" extras={passportExtras} />

        {/* 2b. Network Invitations widget (hidden when no pending invites) */}
        {!loading && pendingNetworks.length > 0 && (
          <div className="card" style={{ marginBottom: 8, borderLeft: '3px solid var(--color-amber)', paddingLeft: 16 }}>
            <div className="card-head" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 700 }}>📬 Network Invitations</span>
              <a href="/networks" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>
                View all ({pendingNetworks.length}) →
              </a>
            </div>
            {pendingNetworks.slice(0, 2).map((item: any) => (
              <div key={item.membership.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 12,
              }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{item.anchor?.legal_name ?? 'A buyer'}</strong> invited you to{' '}
                  <em>"{item.network?.name}"</em>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => router.push('/networks')}
                    style={{
                      padding: '6px 12px', fontSize: 12, borderRadius: 'var(--radius-button)',
                      background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 3. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 4. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 5. Two-column */}
        <div className="split-65" style={{ marginBottom: 24 }}>

          {/* LEFT — My Deals */}
          <div className="card">
            <div className="card-head">
              <span>Active Deals</span>
              <a href="/deals" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            <DealTable
              deals={deals}
              loading={loading}
              emptyTitle="No active deals yet."
              emptySub="List your products on Strike Place to start receiving offers."
              emptyCta={<a href="/marketplace/listings/new" className="btn btn-sm btn-blue">List on Strike Place</a>}
            />
          </div>

          {/* RIGHT — Financing + Passport Activity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head"><span>Active Financing</span></div>
              {loading ? (
                <div style={{ padding: 16 }}><SkeletonBlock height={14} /></div>
              ) : financing.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No financing requests</div>
              ) : (
                <div>
                  {financing.map(f => (
                    <div key={f.id} style={{
                      padding: '10px 16px', borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtCurrency(f.amount_requested)}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{f.structure_type}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span className={`badge ${financingStatusClass(f.status)}`}>{f.status.replace(/_/g, ' ')}</span>
                        {f.offer_count > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--blue)' }}>{f.offer_count} offer{f.offer_count !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span>Passport Activity</span></div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2, 3].map(i => <SkeletonBlock key={i} height={12} />)}
                </div>
              ) : !passport ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
                  No passport data yet
                </div>
              ) : (
                <div className="kv-rows">
                  <div className="kv-row">
                    <span className="k">Org views · 30d</span>
                    <span className="v">{passport.org_view_count_30d}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Bank views · 30d</span>
                    <span className="v">{passport.bank_view_count_30d}</span>
                  </div>
                  {passport.avg_rating != null && (
                    <div className="kv-row">
                      <span className="k">Avg review</span>
                      <span className="v">{passport.avg_rating.toFixed(1)}/5 · {passport.review_count} review{passport.review_count !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {notifications.length === 0 && (
                    <div className="kv-row">
                      <span className="k">Last activity</span>
                      <span className="v plain" style={{ color: 'var(--gray)' }}>No recent activity</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/settings/agent" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>Improve your score →</a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const portal = usePortal()
  if (portal === 'bank')   return <BankDashboard />
  if (portal === 'anchor') return <AnchorDashboard />
  return <SupplierDashboard />
}
