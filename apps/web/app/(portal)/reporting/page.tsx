'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'
import { LineChart, PeriodToggle, type Period } from '@/components/charts'
import { AIInsight } from '@/components/ai-insight'

const PULSE_KF = `@keyframes chart-pulse{0%,100%{opacity:1}50%{opacity:.45}}`

// ── Bank types ────────────────────────────────────────────────────────────────
interface MonthlyBucket { label: string; count: number; volume: number }
interface StatusBreakdown { status: string; count: number }
interface TopSupplier { id: string; name: string; total_financed: number; deal_count: number }
interface Portfolio {
  active_deals: number
  outstanding_balance: number
  total_repaid: number
  avg_rate: number | null
  total_transactions: number
}
interface BankReportingData {
  role: 'bank'
  monthly_volume: MonthlyBucket[]
  status_breakdown: StatusBreakdown[]
  top_suppliers: TopSupplier[]
  portfolio: Portfolio
}

// ── Anchor / Supplier types (Strike Place v2 — deals-based) ───────────────────
interface DealMonthlyBucket { label: string; count: number; volume: number }
interface DealStatusBreakdown { status: string; count: number }
interface CounterpartyRow { id: string; name: string; deal_count: number; total_volume: number }
interface RecentDealRow {
  id: string
  counterparty_name: string
  status: string
  value: number
  currency: string
  created_at: string
}
interface StaleDealRow {
  id: string
  counterparty_name: string
  status: string
  days_stale: number
}
interface DealKpis {
  total_deals: number
  active_deals: number
  completed_deals: number
  total_trade_volume: number
  completed_volume: number
  active_volume: number
  avg_deal_cycle_days: number | null
  avg_pipeline_age_days: number | null
  active_listings: number
  pending_financing_requests: number
  total_financing_requested: number
  total_financed: number
  avg_financing_rate: number | null
  min_financing_rate: number | null
  max_financing_rate: number | null
  dispute_rate: number | null
  cancellation_rate: number | null
  concentration_risk: number | null
  contract_completion_rate: number | null
}
interface DealsReportingData {
  role: 'anchor' | 'supplier'
  kpis: DealKpis
  monthly_volume: DealMonthlyBucket[]
  status_breakdown: DealStatusBreakdown[]
  top_counterparties: CounterpartyRow[]
  stale_deals: StaleDealRow[]
  recent_deals: RecentDealRow[]
}

type ReportingData = BankReportingData | DealsReportingData

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending_anchor_approval: 'Pending Anchor',
  pending_bank_review:     'Pending Bank',
  more_info_requested:     'More Info Requested',
  financing_approved:      'Financing Approved',
  funded:                  'Funded',
  completed:               'Completed',
  rejected:                'Rejected',
  // Deal statuses (Strike Place v2)
  negotiating:         'Negotiating',
  agreed:              'Agreed',
  contract_pending:    'Contract Pending',
  documents_pending:   'Documents Pending',
  confirmed:           'In Business',
  in_preparation:      'In Preparation',
  shipped:             'Shipped',
  delivery_confirmed:  'Delivery Confirmed',
  in_dispute:          'In Dispute',
  payment_due:         'Payment Due',
  payment_overdue:     'Payment Overdue',
  payment_confirmed:   'Payment Confirmed',
  cancelled:           'Cancelled',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtCurrencyFull(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Distinct hue per deal status so the donut + status pills read at a glance.
const STATUS_COLORS: Record<string, string> = {
  negotiating:        '#94A3B8',
  agreed:             '#6366F1',
  contract_pending:   '#7C3AED',
  documents_pending:  '#8B5CF6',
  confirmed:          '#1428CC',
  in_preparation:     '#0EA5E9',
  shipped:            '#0891B2',
  delivery_confirmed: '#0D9488',
  payment_due:        '#F59E0B',
  payment_overdue:    '#EA580C',
  payment_confirmed:  '#059669',
  completed:          '#10B981',
  in_dispute:         '#DC2626',
  cancelled:          '#9CA3AF',
}
function statusColor(s: string): string { return STATUS_COLORS[s] ?? '#94A3B8' }

// ── Hero metric band ──────────────────────────────────────────────────────────
function HeroBand({
  primaryLabel, primaryValue, stats, footnote,
}: {
  primaryLabel: string
  primaryValue: string
  stats: { label: string; value: string; tint?: string }[]
  footnote?: string
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(120deg, #0D1B4C 0%, #1428CC 46%, #5B21B6 100%)',
      borderRadius: 'var(--radius-card)',
      padding: '26px 28px',
      marginBottom: 20,
      color: '#fff',
    }}>
      <div style={{ position: 'absolute', top: -80, right: -40, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 68%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '20px 48px', position: 'relative' }}>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.72 }}>{primaryLabel}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 4 }}>{primaryValue}</div>
        </div>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', flex: 1 }}>
          {stats.map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.62 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 650, marginTop: 3, color: s.tint ?? '#fff' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      {footnote && (
        <div style={{ position: 'relative', marginTop: 16, fontSize: 11.5, opacity: 0.6 }}>{footnote}</div>
      )}
    </div>
  )
}

// ── Status donut ──────────────────────────────────────────────────────────────
function StatusDonut({ segments }: { segments: { status: string; count: number }[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  const R = 52, SW = 16, C = 2 * Math.PI * R
  let acc = 0

  if (total === 0) {
    return <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 12 }}>No deals yet</div>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
        <svg width={140} height={140} viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={70} cy={70} r={R} fill="none" stroke="var(--border)" strokeWidth={SW} opacity={0.35} />
          {segments.map(seg => {
            const frac = seg.count / total
            const dash = frac * C
            const el = (
              <circle
                key={seg.status}
                cx={70} cy={70} r={R} fill="none"
                stroke={statusColor(seg.status)} strokeWidth={SW}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc}
                strokeLinecap="butt"
              />
            )
            acc += dash
            return el
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 10.5, color: 'var(--gray)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>deals</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 150 }}>
        {segments.map(seg => (
          <div key={seg.status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: statusColor(seg.status), flexShrink: 0 }} />
            <span style={{ color: 'var(--ink)', flex: 1 }}>{STATUS_LABELS[seg.status] ?? seg.status}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{seg.count}</span>
            <span style={{ color: 'var(--gray)', fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'right' }}>{Math.round((seg.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Ranked counterparty bars ──────────────────────────────────────────────────
function RankBars({ rows, emptyLabel }: { rows: { id: string; name: string; deal_count: number; total_volume: number }[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--gray)' }}>{emptyLabel}</div>
  }
  const max = Math.max(...rows.map(r => r.total_volume), 1)
  return (
    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r, i) => (
        <div key={r.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
            <span style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--gray-soft)', fontSize: 11, marginRight: 7, fontFamily: 'var(--font-mono)' }}>{i + 1}</span>
              {r.name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtCurrency(r.total_volume)}</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max((r.total_volume / max) * 100, 3)}%`, borderRadius: 999, background: 'linear-gradient(90deg, var(--blue), var(--color-purple))', transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>{r.deal_count} deal{r.deal_count !== 1 ? 's' : ''}</div>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ReportingPage() {
  const router = useRouter()
  const user   = useUser()

  const [data,    setData]    = useState<ReportingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [volPeriod, setVolPeriod] = useState<Period>('monthly')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reporting?period=${volPeriod}`)
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Failed to load reporting data')
        return
      }
      const reportingData = await res.json() as ReportingData
      setData(reportingData)
    } catch {
      setError('Failed to load reporting data')
    } finally {
      setLoading(false)
    }
  }, [volPeriod])

  useEffect(() => {
    if (!user) return
    load()
  }, [user, load])

  if (!user) return null

  // Narrowed bank data for bank-specific computations
  const bankData = data?.role === 'bank' ? data : null
  const totalStatusCount = bankData
    ? bankData.status_breakdown.reduce((s, r) => s + r.count, 0)
    : 0

  return (
    <PortalShell activeSection="reporting">
      <Topbar
        onBack={() => router.push('/dashboard')}
        crumbs={[
          { label: 'Reporting' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page" data-page-name="Reporting" data-ai-context={JSON.stringify({ role: (user as any)?.role, has_data: !!data, ...(data ? { summary: data } : {}) })}>
        <div className="page-header">
          <h1 className="t-page-title">Reporting</h1>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <div className="alert-body">{error}</div>
          </div>
        )}

        <style>{PULSE_KF}</style>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ height: 80, background: 'var(--offwhite)', borderRadius: 6, animation: 'chart-pulse 1.5s infinite' }} />
          </div>
        ) : data?.role === 'bank' ? (
          <>
            <AIInsight
              title="Analytics Summary"
              collapsed={false}
              prompt="Analyze this bank's SCF portfolio performance. Based on transaction volumes, status breakdown, and supplier activity, identify trends, flag any concerns, and suggest one portfolio optimization action."
              context={{
                total_transactions: data.portfolio.active_deals,
                outstanding_balance: data.portfolio.outstanding_balance,
                total_repaid: data.portfolio.total_repaid,
                avg_rate: data.portfolio.avg_rate ?? 0,
                top_suppliers: data.top_suppliers.slice(0, 3),
                status_breakdown: data.status_breakdown,
              }}
            />

            {/* ── KPI strip ── */}
            <div className="kpi-strip-4" style={{ marginBottom: 24 }}>
              <div className="kpi-card-spark">
                <div className="kpi-label">Total Transactions</div>
                <div className="kpi-value">{data.portfolio.total_transactions}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Active Deals</div>
                <div className="kpi-value">{data.portfolio.active_deals}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Outstanding Balance</div>
                <div className="kpi-value">{fmtCurrency(data.portfolio.outstanding_balance)}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Avg. Financing Rate</div>
                <div className="kpi-value">
                  {data.portfolio.avg_rate != null ? `${data.portfolio.avg_rate}%` : '—'}
                </div>
              </div>
            </div>

            {/* ── Monthly volume chart ── */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3 className="t-card-head">Volume (last 6 months)</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <LineChart
                  data={(data.monthly_volume ?? []).map(m => ({ label: m.label, value: m.volume, count: m.count }))}
                  height={160}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* ── Top suppliers ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Top suppliers</h3>
                </div>
                {data.top_suppliers.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                    No supplier data yet.
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th style={{ textAlign: 'right' }}>Deals</th>
                        <th style={{ textAlign: 'right' }}>Total financed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_suppliers.map((s, i) => (
                        <tr key={s.id}>
                          <td style={{ fontSize: 13 }}>
                            <span style={{ color: 'var(--gray)', marginRight: 8, fontSize: 11 }}>
                              #{i + 1}
                            </span>
                            {s.name}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{s.deal_count}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtCurrencyFull(s.total_financed)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── Status breakdown ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Status breakdown</h3>
                </div>
                {data.status_breakdown.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                    No transactions yet.
                  </div>
                ) : (
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {data.status_breakdown.map(row => {
                      const pct = totalStatusCount > 0
                        ? Math.round((row.count / totalStatusCount) * 100)
                        : 0
                      return (
                        <div key={row.status}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: 'var(--ink)' }}>
                              {STATUS_LABELS[row.status] ?? row.status}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--gray)', fontVariantNumeric: 'tabular-nums' }}>
                              {row.count} ({pct}%)
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${pct}%`,
                              borderRadius: 3,
                              background: row.status === 'completed'
                                ? 'var(--color-green)'
                                : row.status === 'rejected'
                                  ? '#DC2626'
                                  : 'var(--color-accent)',
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Portfolio summary ── */}
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Portfolio summary</h3>
              </div>
              <div className="card-body">
                <div className="kv-rows">
                  <div className="kv-row">
                    <span className="k">Total transactions</span>
                    <span className="v">{data.portfolio.total_transactions}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Active deals</span>
                    <span className="v">{data.portfolio.active_deals}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Outstanding balance</span>
                    <span className="v">{fmtCurrencyFull(data.portfolio.outstanding_balance)}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Total repaid (completed)</span>
                    <span className="v">{fmtCurrencyFull(data.portfolio.total_repaid)}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Average financing rate</span>
                    <span className="v">
                      {data.portfolio.avg_rate != null ? `${data.portfolio.avg_rate}% APR` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>

        ) : (data?.role === 'anchor' || data?.role === 'supplier') ? (
          <>
            {/* ── Hero band ── */}
            <HeroBand
              primaryLabel={data.role === 'anchor' ? 'Total Trade Volume' : 'Total Volume Sold'}
              primaryValue={fmtCurrency(data.kpis.total_trade_volume)}
              stats={[
                { label: 'Active Value', value: fmtCurrency(data.kpis.active_volume) },
                { label: 'Completed', value: fmtCurrency(data.kpis.completed_volume) },
                { label: 'Active Deals', value: String(data.kpis.active_deals) },
                { label: 'Avg. Completed Cycle', value: data.kpis.avg_deal_cycle_days != null ? `${data.kpis.avg_deal_cycle_days}d` : '—' },
                { label: 'Avg. Pipeline Age', value: data.kpis.avg_pipeline_age_days != null ? `${data.kpis.avg_pipeline_age_days}d` : '—' },
              ]}
              footnote={data.kpis.avg_deal_cycle_days == null ? 'No completed deals yet — cycle time will appear once a deal finishes. Pipeline age reflects current active deals.' : undefined}
            />

            <AIInsight
              title={data.role === 'anchor' ? 'Payables Analytics' : 'Receivables Analytics'}
              collapsed={false}
              prompt={data.role === 'anchor'
                ? "Analyze this buyer's Strike Place deal activity. Based on deal volumes, supplier concentration, and financing usage, identify trends, flag concerns, and suggest one action to improve program efficiency."
                : "Analyze this supplier's Strike Place deal and financing activity. Based on trade volume, buyer concentration, and financing rates, suggest one action to improve cash flow or grow trade volume."}
              context={{
                kpis: data.kpis,
                monthly_volume: data.monthly_volume.slice(-3),
                status_breakdown: data.status_breakdown,
                top_counterparties: data.top_counterparties.slice(0, 3),
              }}
            />

            {/* ── Deal volume chart + status donut ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Deal volume</h3>
                  <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                </div>
                <div className="card-body">
                  <LineChart
                    data={(data.monthly_volume ?? []).map(m => ({ label: m.label, value: m.volume, count: m.count }))}
                    height={200}
                    color={data.role === 'anchor' ? 'var(--color-anchor)' : 'var(--color-green)'}
                  />
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Deal status</h3>
                </div>
                <div className="card-body">
                  <StatusDonut segments={data.status_breakdown} />
                </div>
              </div>
            </div>

            {/* ── Top counterparties + financing ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">{data.role === 'anchor' ? 'Top suppliers by volume' : 'Top buyers by volume'}</h3>
                </div>
                <RankBars rows={data.top_counterparties} emptyLabel="No counterparty data yet." />
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Financing</h3>
                </div>
                <div className="card-body">
                  <div className="fs-grid">
                    <div className="fs-cell">
                      <div className="fs-label">Pending requests</div>
                      <div className="fs-value">{data.kpis.pending_financing_requests}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">Requested (open)</div>
                      <div className="fs-value">{fmtCurrency(data.kpis.total_financing_requested)}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">{data.role === 'anchor' ? 'Financed' : 'Secured'}</div>
                      <div className="fs-value">{fmtCurrency(data.kpis.total_financed)}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">Rate range</div>
                      <div className="fs-value">
                        {data.kpis.avg_financing_rate != null
                          ? `${data.kpis.min_financing_rate}–${data.kpis.max_financing_rate}% (avg ${data.kpis.avg_financing_rate}%)`
                          : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Audit & risk ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3 className="t-card-head">Audit &amp; Risk</h3>
              </div>
              <div className="card-body">
                <div className="fs-grid">
                  <div className="fs-cell">
                    <div className="fs-label">Dispute rate</div>
                    <div className="fs-value" style={{ color: (data.kpis.dispute_rate ?? 0) > 10 ? 'var(--color-red)' : undefined }}>
                      {data.kpis.dispute_rate != null ? `${data.kpis.dispute_rate}%` : '—'}
                    </div>
                  </div>
                  <div className="fs-cell">
                    <div className="fs-label">Cancellation rate</div>
                    <div className="fs-value">
                      {data.kpis.cancellation_rate != null ? `${data.kpis.cancellation_rate}%` : '—'}
                    </div>
                  </div>
                  <div className="fs-cell">
                    <div className="fs-label">Counterparty concentration</div>
                    <div className="fs-value" style={{ color: (data.kpis.concentration_risk ?? 0) > 40 ? 'var(--color-amber)' : undefined }}>
                      {data.kpis.concentration_risk != null ? `${data.kpis.concentration_risk}%` : '—'}
                      {(data.kpis.concentration_risk ?? 0) > 40 && (
                        <span className="badge" style={{ marginLeft: 8, background: 'var(--color-amber-bg, #FEF3C7)', color: 'var(--color-amber)', fontSize: 10.5 }}>
                          Concentrated
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="fs-cell">
                    <div className="fs-label">Contract completion rate</div>
                    <div className="fs-value">
                      {data.kpis.contract_completion_rate != null ? `${data.kpis.contract_completion_rate}%` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Stale deals ── */}
            {data.stale_deals.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h3 className="t-card-head">Stale Deals</h3>
                  <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>14+ days without progressing</span>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{data.role === 'anchor' ? 'Supplier' : 'Buyer'}</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Days stale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stale_deals.map(d => (
                      <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/deals/${d.id}`)}>
                        <td style={{ fontSize: 13 }}>{d.counterparty_name}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 3, background: statusColor(d.status), flexShrink: 0 }} />
                            {STATUS_LABELS[d.status] ?? d.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--color-amber)' }}>{d.days_stale}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Recent deals ── */}
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Recent deals</h3>
                <a href="/deals" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
              </div>
              {data.recent_deals.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  <p style={{ marginBottom: 12 }}>No deals yet.</p>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => router.push('/marketplace')}
                  >
                    Visit Strike Place
                  </button>
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{data.role === 'anchor' ? 'Supplier' : 'Buyer'}</th>
                      <th style={{ textAlign: 'right' }}>Value</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_deals.map(d => (
                      <tr
                        key={d.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/deals/${d.id}`)}
                      >
                        <td style={{ fontSize: 13 }}>{d.counterparty_name}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtCurrencyFull(d.value)}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 3, background: statusColor(d.status), flexShrink: 0 }} />
                            {STATUS_LABELS[d.status] ?? d.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
                          {fmtDate(d.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </PortalShell>
  )
}
