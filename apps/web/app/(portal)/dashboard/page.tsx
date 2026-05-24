'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { VolumeChart, ProgramPieChart, PeriodToggle, type Period } from '@/components/charts'
import { AIInsight } from '@/components/ai-insight'

// ============== Types ==============
interface DashProgram { id: string; name: string; financing_types: string[]; status: string }
interface BankData { portal: 'bank'; bank_name: string | null; program_count: number; active_program_count: number; enrolled_org_count: number; kyb_pending: number; pending_bank_review: number; active_transactions: number }
interface AnchorData { portal: 'anchor'; org_name: string | null; programs: DashProgram[]; enrolled_supplier_count: number; pending_approval: number }
interface SupplierData { portal: 'supplier'; org_name: string | null; programs: DashProgram[]; active_transactions: number }
type DashData = BankData | AnchorData | SupplierData

interface RouteState {
  screen: string
  programId?: string
}

interface BankSnapshot {
  role: 'bank'
  monthly_volume: Array<{ label: string; count: number; volume: number }>
  status_breakdown: Array<{ status: string; count: number }>
  program_breakdown?: Array<{ name: string; volume: number }>
  portfolio: {
    total_transactions: number
    active_deals: number
    outstanding_balance: number
    total_repaid: number
    avg_rate?: number | null
  }
}
interface AnchorSnapshot {
  role: 'anchor'
  monthly_volume: Array<{ label: string; count: number; total_invoice_amount: number }>
  program_breakdown?: Array<{ name: string; volume: number }>
}
interface SupplierSnapshot {
  role: 'supplier'
  monthly_volume: Array<{ label: string; count: number; total_financed: number }>
  receivables?: { outstanding_count: number; outstanding_balance: number }
  acceptance_rate?: number | null
  program_breakdown?: Array<{ name: string; volume: number }>
}
type ReportingSnapshot = BankSnapshot | AnchorSnapshot | SupplierSnapshot

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

// ============== Icon ==============
function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}

// ============== Topbar ==============
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

interface NotifItem {
  id: string
  title: string
  body: string
  created_at: string
  read: boolean
  deep_link?: string | null
}

function NotifBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/notifications')
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
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => {})
  }

  function markAllRead() {
    const ids = notifications.filter(n => !n.read).map(n => n.id)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    ids.forEach(id => fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => {}))
  }

  function fmtTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000)    return 'Just now'
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(o => !o)}
        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--gray)' }}
      >
        <Icon name="bell" size={16} />
      </button>
      {unreadCount > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          background: 'var(--color-red)', color: 'white',
          borderRadius: '50%', width: 16, height: 16,
          fontSize: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 600, pointerEvents: 'none',
        }}>{unreadCount}</span>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: 48, right: 0, width: 320,
          background: 'var(--color-card)', border: '1px solid var(--color-border)',
          borderRadius: 10, boxShadow: '0 4px 16px var(--color-shadow)', zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" style={{ fontSize: 12, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 13 }}>
              No notifications yet
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.slice(0, 5).map(n => (
                <div
                  key={n.id}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    borderLeft: n.read ? '2px solid transparent' : '2px solid var(--color-accent)',
                  }}
                  onClick={() => {
                    if (!n.read) markRead(n.id)
                    if (n.deep_link) router.push(n.deep_link)
                    setOpen(false)
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{n.title}</div>
                  <div style={{ color: 'var(--color-ink-3)', fontSize: 12, marginTop: 2 }}>{n.body}</div>
                  <div style={{ color: 'var(--color-ink-4)', fontSize: 11, marginTop: 4 }}>{fmtTime(n.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============== Chart Helpers ==============
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  const first = points[0]!
  let d = `M ${first[0]} ${first[1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`
  }
  return d
}

function Sparkline({ data, color = 'var(--color-green)', height = 36, fill = false }: {
  data: number[]
  color?: string
  height?: number
  fill?: boolean
}) {
  if (data.length < 2) return <div style={{ height }} />
  const w = 200, h = height, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts: [number, number][] = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (w - pad * 2),
    h - pad - ((v - min) / range) * (h - pad * 2),
  ])
  const d = smoothPath(pts)
  const lastPt = pts[pts.length - 1]!
  const firstPt = pts[0]!
  const area = `${d} L ${lastPt[0]} ${h} L ${firstPt[0]} ${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {fill && <path d={area} fill={color} fillOpacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ============== BANK DASHBOARD ==============
function PortfolioBar({ activeProgramCount = 0 }: { activeProgramCount?: number }) {
  return (
    <div>
      <div className="portfolio-bar">
        <div style={{ width: '100%', height: '100%', background: 'var(--color-border)', borderRadius: 4 }} />
      </div>
      <div className="portfolio-meta">
        {activeProgramCount} active program{activeProgramCount !== 1 ? 's' : ''} · No portfolio data yet
      </div>
    </div>
  )
}

function ScreenBankDashboard({ navigate: _navigate, data, reportingSnap, volPeriod, setVolPeriod }: { navigate: (r: RouteState) => void; data: BankData | null; reportingSnap: ReportingSnapshot | null; volPeriod: Period; setVolPeriod: (p: Period) => void }) {
  const user = useUser()
  const router = useRouter()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'

  const bankSnap    = reportingSnap?.role === 'bank' ? reportingSnap : null
  const bankMonthly = bankSnap?.monthly_volume.map(m => m.count) ?? []
  const bankVolItems = (bankSnap?.monthly_volume ?? []).map(m => ({ label: m.label, value: m.volume, count: m.count }))
  const bankProgramBreakdown = bankSnap?.program_breakdown ?? []

  const kpis = [
    { label: 'Active Programs', value: data ? String(data.active_program_count) : '—', delta: data ? `${data.program_count} total` : 'Loading',                                                          deltaClass: 'kpi-delta-mut',                                                                              color: 'var(--color-accent)', sparkData: [] as number[] },
    { label: 'Enrolled Orgs',   value: data ? String(data.enrolled_org_count) : '—',   delta: 'Across programs',                                                                                         deltaClass: 'kpi-delta-mut',                                                                              color: 'var(--color-green)',  sparkData: [] as number[] },
    { label: 'KYB Pending',     value: data ? String(data.kyb_pending) : '—',          delta: 'Awaiting review',                                                                                         deltaClass: (data?.kyb_pending ?? 0) > 0 ? 'kpi-delta-warn' : 'kpi-delta-mut',                         color: 'var(--color-amber)',  sparkData: [] as number[] },
    { label: 'Pending Review',  value: data ? String(data.pending_bank_review) : '—',  delta: (data?.pending_bank_review ?? 0) > 0 ? 'Needs review' : 'None pending',                                  deltaClass: (data?.pending_bank_review ?? 0) > 0 ? 'kpi-delta-warn' : 'kpi-delta-mut',              color: 'var(--color-amber)',  sparkData: [] as number[] },
    { label: 'Active Deals',    value: data ? String(data.active_transactions) : '—',  delta: (data?.active_transactions ?? 0) > 0 ? 'In progress' : 'None active',                                    deltaClass: 'kpi-delta-mut',                                                                              color: 'var(--color-ink-4)', sparkData: bankMonthly },
  ]

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Dashboard' }]}
      />
      <div className="page">
        <div className="page-header">
          <div className="eyebrow">{data?.bank_name ?? 'Bank'} · Portfolio Command</div>
          <h1 className="t-page-title">Good morning, {firstName}</h1>
          <div className="subtitle">
            {data && data.kyb_pending > 0 ? `${data.kyb_pending} KYB review${data.kyb_pending !== 1 ? 's' : ''} pending · ` : ''}
            {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        <AIInsight
          title="Portfolio Overview"
          collapsed={true}
          prompt="Based on this bank's current portfolio data, provide a brief executive summary. Highlight key metrics, any concentration risks, and one recommended action for today."
          context={{
            active_programs: data?.active_program_count ?? 0,
            pending_kyb: data?.kyb_pending ?? 0,
            pending_review: data?.pending_bank_review ?? 0,
            active_deals: data?.active_transactions ?? 0,
            enrolled_orgs: data?.enrolled_org_count ?? 0,
          }}
        />

        <div className="kpi-strip-5" style={{ marginTop: 24, gap: '1px', background: 'var(--border)' }}>
          {kpis.map((k, i) => (
            <div key={i} className="kpi-card-spark" style={{ background: 'var(--white)', padding: 24 }}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value mono">{k.value}</div>
              <div className={`kpi-delta ${k.deltaClass}`}>{k.delta}</div>
              <Sparkline data={k.sparkData} color={k.color} fill />
            </div>
          ))}
        </div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">Volume · last 6 months</h3>
              <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
            </div>
            <div className="card-body">
              <VolumeChart data={bankVolItems} height={160} color="#2563EB" />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Action required</h3></div>
            <div className="action-list">
              {(data?.kyb_pending ?? 0) > 0 && (
                <button className="action-row" data-tone="amber" onClick={() => router.push('/kyb')}>
                  <div>
                    <div className="action-label">KYB applications pending</div>
                    <div className="action-sub">Review business verification applications</div>
                  </div>
                  <span className="action-num">{data!.kyb_pending}</span>
                  <Icon name="chev-right" size={14} className="action-chev" />
                </button>
              )}
              {(data?.pending_bank_review ?? 0) > 0 && (
                <button className="action-row" data-tone="amber" onClick={() => router.push('/transactions')}>
                  <div>
                    <div className="action-label">Transactions pending review</div>
                    <div className="action-sub">Awaiting bank approval</div>
                  </div>
                  <span className="action-num">{data!.pending_bank_review}</span>
                  <Icon name="chev-right" size={14} className="action-chev" />
                </button>
              )}
              {(data?.kyb_pending ?? 0) === 0 && (data?.pending_bank_review ?? 0) === 0 && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
                  No actions required
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid-1-1-1" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Program usage</h3></div>
            <div className="card-body">
              <ProgramPieChart segments={bankProgramBreakdown.map(p => ({ name: p.name, volume: p.volume }))} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Status breakdown</h3></div>
            {(bankSnap?.status_breakdown ?? []).length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
                No transactions yet
              </div>
            ) : (
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(bankSnap!.status_breakdown ?? []).slice(0, 5).map(row => {
                  const total = bankSnap!.status_breakdown.reduce((s, r) => s + r.count, 0)
                  const pct   = total > 0 ? Math.round((row.count / total) * 100) : 0
                  const STATUS_LABELS: Record<string, string> = {
                    pending_anchor_approval: 'Anchor Review', pending_bank_review: 'Bank Review',
                    financing_approved: 'Approved', funded: 'Funded', completed: 'Completed', rejected: 'Rejected',
                  }
                  return (
                    <div key={row.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: 'var(--color-ink-2)' }}>{STATUS_LABELS[row.status] ?? row.status}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{row.count} ({pct}%)</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${pct}%`, borderRadius: 2, transition: 'width 0.4s',
                          background: row.status === 'completed' ? 'var(--color-green)' : row.status === 'rejected' ? 'var(--color-red)' : 'var(--color-accent)',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h3 className="t-card-head">Portfolio summary</h3></div>
            {bankSnap ? (
              <div className="card-body">
                <div className="kv-rows">
                  <div className="kv-row"><span className="k">Total transactions</span><span className="v">{bankSnap.portfolio.total_transactions}</span></div>
                  <div className="kv-row"><span className="k">Active deals</span><span className="v">{bankSnap.portfolio.active_deals}</span></div>
                  <div className="kv-row"><span className="k">Outstanding</span><span className="v">{fmtCurrency(bankSnap.portfolio.outstanding_balance)}</span></div>
                  <div className="kv-row"><span className="k">Total repaid</span><span className="v">{fmtCurrency(bankSnap.portfolio.total_repaid)}</span></div>
                  {bankSnap.portfolio.avg_rate != null && (
                    <div className="kv-row"><span className="k">Avg rate</span><span className="v">{bankSnap.portfolio.avg_rate}%</span></div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>No data yet</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ============== ANCHOR DASHBOARD ==============
function ScreenAnchorDashboard({ navigate: _navigate, data, reportingSnap, volPeriod, setVolPeriod }: { navigate: (r: RouteState) => void; data: AnchorData | null; reportingSnap: ReportingSnapshot | null; volPeriod: Period; setVolPeriod: (p: Period) => void }) {
  const user = useUser()
  const router = useRouter()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'

  const anchorSnap           = reportingSnap?.role === 'anchor' ? reportingSnap : null
  const anchorMonthly        = anchorSnap?.monthly_volume?.map(m => m.total_invoice_amount) ?? []
  const anchorVolItems       = (anchorSnap?.monthly_volume ?? []).map(m => ({ label: m.label, value: m.total_invoice_amount, count: m.count }))
  const lastMonth            = anchorSnap?.monthly_volume?.length ? anchorSnap.monthly_volume[anchorSnap.monthly_volume.length - 1] : null
  const currentMonthFinanced = lastMonth?.total_invoice_amount ?? null
  const totalPayablesFinanced = anchorSnap?.monthly_volume?.reduce((s, m) => s + m.total_invoice_amount, 0) ?? null
  const anchorProgramBreakdown = anchorSnap?.program_breakdown ?? []

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Dashboard' }]}
      />
      <div className="page">
        <div className="page-header">
          <div className="eyebrow">{data?.org_name ?? 'Organization'} · Overview</div>
          <h1 className="t-page-title">Good morning, {firstName}</h1>
          <div className="subtitle">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <AIInsight
          title="Payables Snapshot"
          collapsed={true}
          prompt="Based on this anchor's current payables data, provide a brief summary. Highlight pending approvals, upcoming obligations, and one recommended action."
          context={{
            pending_approval: data?.pending_approval ?? 0,
            enrolled_programs: data?.programs?.length ?? 0,
            total_invoice_volume: totalPayablesFinanced ?? 0,
          }}
        />

        <div className="kpi-strip-4" style={{ marginTop: 24, gap: '1px', background: 'var(--border)' }}>
          {[
            { label: 'Payables financed',   value: totalPayablesFinanced != null && totalPayablesFinanced > 0 ? fmtCurrency(totalPayablesFinanced) : '—', delta: totalPayablesFinanced != null && totalPayablesFinanced > 0 ? 'Last 6 months' : 'No data yet', color: 'var(--color-anchor)', sparkData: anchorMonthly },
            { label: 'Pending approval',    value: data ? String(data.pending_approval) : '—',                                          delta: (data?.pending_approval ?? 0) > 0 ? 'Awaiting action' : 'Up to date',  color: 'var(--color-amber)',  sparkData: [] as number[] },
            { label: 'Financed this month', value: currentMonthFinanced != null && currentMonthFinanced > 0 ? fmtCurrency(currentMonthFinanced) : '—', delta: currentMonthFinanced != null && currentMonthFinanced > 0 ? 'This month' : 'No data yet', color: 'var(--color-green)',  sparkData: anchorMonthly },
            { label: 'Due in 30 days',      value: '—',                                                                                        delta: 'No data yet',                                                              color: 'var(--color-amber)',  sparkData: [] as number[] },
          ].map((k, i) => (
            <div key={i} className="kpi-card-spark" style={{ background: 'var(--white)', padding: 24 }}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value mono">{k.value}</div>
              <div className="kpi-delta kpi-delta-mut">{k.delta}</div>
              <Sparkline data={k.sparkData} color={k.color} fill />
            </div>
          ))}
        </div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Invoice approvals</h3></div>
              {(data?.pending_approval ?? 0) > 0 ? (
                <div className="action-list">
                  <button className="action-row" data-tone="amber" onClick={() => router.push('/transactions')}>
                    <div>
                      <div className="action-label">{data!.pending_approval} invoice{data!.pending_approval !== 1 ? 's' : ''} awaiting approval</div>
                      <div className="action-sub">Review and approve or reject</div>
                    </div>
                    <Icon name="chev-right" size={14} className="action-chev" />
                  </button>
                </div>
              ) : (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
                  No invoices awaiting approval
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Invoice volume · last 6 months</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <VolumeChart data={anchorVolItems} height={140} color="#0F766E" />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Program usage</h3></div>
              <div className="card-body">
                <ProgramPieChart segments={anchorProgramBreakdown.map(p => ({ name: p.name, volume: p.volume }))} />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">My programs</h3></div>
              <div className="prog-mini-list">
                {(data?.programs ?? []).length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>No enrolled programs</div>
                ) : (data?.programs ?? []).map((p) => {
                  const typeLabel = p.financing_types?.[0]?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? 'SCF'
                  return (
                    <button key={p.id} className="prog-mini" onClick={() => router.push('/programs')}>
                      <div>
                        <div className="prog-mini-name">{p.name}</div>
                        <div className="prog-mini-bank">{typeLabel}</div>
                      </div>
                      <span className="program-type-pill">{typeLabel}</span>
                      <span className="badge badge-active">Active</span>
                      <Icon name="chev-right" size={14} className="chev" />
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Repayment schedule</h3></div>
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
                No repayments scheduled
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ============== SUPPLIER DASHBOARD ==============
function ScreenSupplierDashboard({ navigate: _navigate, data, reportingSnap, volPeriod, setVolPeriod }: { navigate: (r: RouteState) => void; data: SupplierData | null; reportingSnap: ReportingSnapshot | null; volPeriod: Period; setVolPeriod: (p: Period) => void }) {
  const user = useUser()
  const router = useRouter()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'

  function isSupplierSnapshot(s: ReportingSnapshot | null): s is SupplierSnapshot {
    return s?.role === 'supplier'
  }

  const supplierSnap = isSupplierSnapshot(reportingSnap) ? reportingSnap : null
  const outstandingCount = supplierSnap?.receivables?.outstanding_count ?? 0
  const outstandingBalance = supplierSnap?.receivables?.outstanding_balance ?? 0
  const supplierMonthly  = supplierSnap?.monthly_volume?.map(m => m.total_financed) ?? []
  const supplierVolItems = (supplierSnap?.monthly_volume ?? []).map(m => ({ label: m.label, value: m.total_financed, count: m.count }))
  const financedYTD      = supplierSnap?.monthly_volume?.reduce((s, m) => s + m.total_financed, 0) ?? null
  const avgNetProceeds = outstandingCount > 0 ? outstandingBalance / outstandingCount : null
  const acceptanceRate = supplierSnap?.acceptance_rate ?? null
  const supplierProgramBreakdown = supplierSnap?.program_breakdown ?? []

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Dashboard' }]}
      />
      <div className="page">
        <div className="page-header">
          <div className="eyebrow">{data?.org_name ?? 'Organization'} · Overview</div>
          <h1 className="t-page-title">Good morning, {firstName}</h1>
          <div className="subtitle">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <AIInsight
          title="Receivables Snapshot"
          collapsed={true}
          prompt="Based on this supplier's current receivables data, provide a brief summary. Highlight outstanding financing, any pending actions needed, and one tip to optimize their cash flow."
          context={{
            active_transactions: data?.active_transactions ?? 0,
            outstanding_balance: supplierSnap?.receivables?.outstanding_balance ?? 0,
            enrolled_programs: data?.programs?.length ?? 0,
          }}
        />

        <div className="kpi-strip-4" style={{ marginTop: 24, gap: '1px', background: 'var(--border)' }}>
          {[
            { label: 'Financed YTD',        value: financedYTD != null && financedYTD > 0 ? fmtCurrency(financedYTD) : '—',  delta: financedYTD != null && financedYTD > 0 ? 'Year to date' : 'No data yet',  color: 'var(--color-green)',  sparkData: supplierMonthly },
            { label: 'Active transactions',  value: data ? String(data.active_transactions) : '—',                            delta: (data?.active_transactions ?? 0) > 0 ? 'In progress' : 'None active',        color: 'var(--color-ink-3)', sparkData: [] as number[] },
            { label: 'Avg net proceeds',     value: avgNetProceeds != null ? fmtCurrency(avgNetProceeds) : '—',           delta: avgNetProceeds != null ? 'Per funded deal' : 'No data yet',                    color: 'var(--color-green)', sparkData: supplierMonthly },
            { label: 'Acceptance rate',      value: acceptanceRate != null ? `${acceptanceRate}%` : '—',                   delta: acceptanceRate != null ? 'Of submitted txns' : 'No data yet',            color: 'var(--color-green)', sparkData: [] as number[] },
          ].map((k, i) => (
            <div key={i} className="kpi-card-spark" style={{ background: 'var(--white)', padding: 24 }}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value mono">{k.value}</div>
              <div className="kpi-delta kpi-delta-mut">{k.delta}</div>
              <Sparkline data={k.sparkData} color={k.color} fill />
            </div>
          ))}
        </div>

        <div className="grid-2-1" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Financing activity · last 6 months</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <VolumeChart data={supplierVolItems} height={160} color="#059669" />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Active transactions</h3></div>
              {(data?.active_transactions ?? 0) > 0 ? (
                <div className="action-list">
                  <button className="action-row" onClick={() => router.push('/transactions')}>
                    <div>
                      <div className="action-label">{data!.active_transactions} transaction{data!.active_transactions !== 1 ? 's' : ''} in progress</div>
                      <div className="action-sub">View and manage your transactions</div>
                    </div>
                    <Icon name="chev-right" size={14} className="action-chev" />
                  </button>
                </div>
              ) : (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
                  No active transactions
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Program usage</h3></div>
              <div className="card-body">
                <ProgramPieChart segments={supplierProgramBreakdown.map(p => ({ name: p.name, volume: p.volume }))} />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">My programs</h3></div>
              <div className="prog-mini-list">
                {(data?.programs ?? []).length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>No enrolled programs</div>
                ) : (data?.programs ?? []).map((p) => {
                  const typeLabel = p.financing_types?.[0]?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? 'SCF'
                  return (
                    <button key={p.id} className="prog-mini" onClick={() => router.push('/programs')}>
                      <div>
                        <div className="prog-mini-name">{p.name}</div>
                        <div className="prog-mini-bank">{typeLabel}</div>
                      </div>
                      <span className="program-type-pill">{typeLabel}</span>
                      <span className="badge badge-active">Active</span>
                      <Icon name="chev-right" size={14} className="chev" />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ============== Coming Soon ==============
function ComingSoon({ screen }: { screen: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="t-page-title">{screen.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</h1>
        <div className="subtitle">Coming soon</div>
      </div>
      <div className="card">
        <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-3)' }}>
          This section is under construction.
        </div>
      </div>
    </div>
  )
}

// ============== Dashboard Page ==============
const noNavigate = (_r: RouteState) => {}

export default function DashboardPage() {
  const portal = usePortal()
  const [dashData, setDashData] = useState<DashData | null>(null)
  const [reportingSnap, setReportingSnap] = useState<ReportingSnapshot | null>(null)
  const [volPeriod, setVolPeriod] = useState<Period>('monthly')

  const fetchReporting = useCallback((period: Period) => {
    fetch(`/api/reporting?period=${period}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.monthly_volume) setReportingSnap(d as ReportingSnapshot) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDashData(d) })
      .catch(() => {})
    fetchReporting('monthly')
  }, [fetchReporting])

  function handlePeriodChange(p: Period) {
    setVolPeriod(p)
    fetchReporting(p)
  }

  if (portal === 'bank')
    return <ScreenBankDashboard     navigate={noNavigate} data={dashData?.portal === 'bank'     ? dashData : null} reportingSnap={reportingSnap} volPeriod={volPeriod} setVolPeriod={handlePeriodChange} />
  if (portal === 'anchor')
    return <ScreenAnchorDashboard   navigate={noNavigate} data={dashData?.portal === 'anchor'   ? dashData : null} reportingSnap={reportingSnap} volPeriod={volPeriod} setVolPeriod={handlePeriodChange} />
  return   <ScreenSupplierDashboard navigate={noNavigate} data={dashData?.portal === 'supplier' ? dashData : null} reportingSnap={reportingSnap} volPeriod={volPeriod} setVolPeriod={handlePeriodChange} />
}
