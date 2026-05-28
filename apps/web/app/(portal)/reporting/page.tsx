'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
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

// ── Anchor types ──────────────────────────────────────────────────────────────
interface AnchorMonthlyBucket { label: string; count: number; total_invoice_amount: number }
interface AnchorSupplierRow { legal_name: string; transaction_count: number; total_volume: number }
interface AnchorReportingData {
  role: 'anchor'
  enrolled_programs: number
  monthly_volume: AnchorMonthlyBucket[]
  payables_summary: Record<string, { count: number; total: number }>
  top_suppliers: AnchorSupplierRow[]
}

// ── Supplier types ────────────────────────────────────────────────────────────
interface SupplierMonthlyBucket { label: string; count: number; total_financed: number }
interface SupplierReceivables {
  outstanding_count: number
  outstanding_balance: number
  approved_count: number
  approved_balance: number
  avg_rate: number | null
  total_fees_paid: number
}

interface SupplierTxnRow {
  id: string
  invoice_number: string | null
  invoice_amount: number | null
  financing_amount_approved: number | null
  status: string
  created_at: string
}
interface SupplierReportingData {
  role: 'supplier'
  enrolled_programs: number
  monthly_volume: SupplierMonthlyBucket[]
  receivables: SupplierReceivables
  recent_transactions: SupplierTxnRow[]
  acceptance_rate: number | null
}

type ReportingData = BankReportingData | AnchorReportingData | SupplierReportingData

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending_anchor_approval: 'Pending Anchor',
  pending_bank_review:     'Pending Bank',
  more_info_requested:     'More Info Requested',
  financing_approved:      'Financing Approved',
  funded:                  'Funded',
  completed:               'Completed',
  rejected:                'Rejected',
}

const PAYABLE_STAGES = [
  { key: 'pending_anchor_approval', label: 'Pending your approval' },
  { key: 'pending_bank_review',     label: 'Pending bank review' },
  { key: 'financing_approved',      label: 'Approved — awaiting disbursement' },
  { key: 'funded',                  label: 'Funded' },
  { key: 'completed',               label: 'Completed' },
]

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
      console.log('Reporting data:', reportingData)
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

  const portalLabel =
    user.role?.startsWith('bank')     ? 'Bank Portal'
    : user.role?.startsWith('anchor') ? 'Anchor Portal'
    : 'Supplier Portal'

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
          { label: portalLabel },
          { label: 'Reporting' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
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

        ) : data?.role === 'anchor' ? (
          <>
            <AIInsight
              title="Payables Analytics"
              collapsed={false}
              prompt="Analyze this anchor's SCF program usage. Based on invoice volumes, supplier activity, and payables pipeline, identify trends and suggest one action to improve program efficiency."
              context={{
                enrolled_programs: data.enrolled_programs,
                monthly_volume: data.monthly_volume.slice(-3),
                payables_summary: data.payables_summary,
                top_suppliers: data.top_suppliers.slice(0, 3),
              }}
            />

            {/* ── KPI strip ── */}
            <div className="kpi-strip-4" style={{ marginBottom: 24 }}>
              <div className="kpi-card-spark">
                <div className="kpi-label">Enrolled Programs</div>
                <div className="kpi-value">{data.enrolled_programs}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Total Transactions</div>
                <div className="kpi-value">
                  {Object.values(data.payables_summary).reduce((s, v) => s + v.count, 0)}
                </div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Pending Approval</div>
                <div className="kpi-value">
                  {data.payables_summary['pending_anchor_approval']?.count ?? 0}
                </div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Active Suppliers</div>
                <div className="kpi-value">{data.top_suppliers.length}</div>
              </div>
            </div>

            {/* ── Monthly invoice volume ── */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3 className="t-card-head">Invoice volume (last 6 months)</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <LineChart
                  data={(data.monthly_volume ?? []).map(m => ({ label: m.label, value: m.total_invoice_amount, count: m.count }))}
                  height={160}
                  color="var(--color-anchor)"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* ── Payables pipeline ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Payables pipeline</h3>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {PAYABLE_STAGES.map(stage => {
                    const bucket = data.payables_summary[stage.key]
                    if (!bucket) return null
                    return (
                      <div key={stage.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--ink)' }}>{stage.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--gray)', fontVariantNumeric: 'tabular-nums' }}>
                          {bucket.count} · {fmtCurrency(bucket.total)}
                        </span>
                      </div>
                    )
                  })}
                  {Object.keys(data.payables_summary).length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>No payables yet.</div>
                  )}
                </div>
              </div>

              {/* ── Top suppliers ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Top suppliers by invoice volume</h3>
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
                        <th style={{ textAlign: 'right' }}>Invoices</th>
                        <th style={{ textAlign: 'right' }}>Total volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_suppliers.map((s, i) => (
                        <tr key={s.legal_name}>
                          <td style={{ fontSize: 13 }}>
                            <span style={{ color: 'var(--gray)', marginRight: 8, fontSize: 11 }}>
                              #{i + 1}
                            </span>
                            {s.legal_name}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{s.transaction_count}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtCurrencyFull(s.total_volume)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>

        ) : data?.role === 'supplier' ? (
          <>
            <AIInsight
              title="Receivables Analytics"
              collapsed={false}
              prompt="Analyze this supplier's SCF financing activity. Based on their receivables, advance rates, and fees paid, suggest how they can optimize their use of the program to improve cash flow."
              context={{
                enrolled_programs: data.enrolled_programs,
                outstanding_balance: data.receivables.outstanding_balance,
                avg_rate: data.receivables.avg_rate ?? 0,
                total_fees_paid: data.receivables.total_fees_paid,
                monthly_volume: data.monthly_volume.slice(-3),
              }}
            />

            {/* ── KPI strip ── */}
            <div className="kpi-strip-4" style={{ marginBottom: 24 }}>
              <div className="kpi-card-spark">
                <div className="kpi-label">Enrolled Programs</div>
                <div className="kpi-value">{data.enrolled_programs}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Outstanding</div>
                <div className="kpi-value">{fmtCurrency(data.receivables.outstanding_balance)}</div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Avg Rate</div>
                <div className="kpi-value">
                  {data.receivables.avg_rate != null ? `${data.receivables.avg_rate}%` : '—'}
                </div>
              </div>
              <div className="kpi-card-spark">
                <div className="kpi-label">Total Fees Paid</div>
                <div className="kpi-value">{fmtCurrency(data.receivables.total_fees_paid)}</div>
              </div>
            </div>

            {/* ── Monthly financed volume ── */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3 className="t-card-head">Financed volume (last 6 months)</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <LineChart
                  data={(data.monthly_volume ?? []).map(m => ({ label: m.label, value: m.total_financed, count: m.count }))}
                  height={160}
                  color="var(--color-green)"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* ── Receivables summary ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Receivables</h3>
                </div>
                <div className="card-body">
                  <div className="fs-grid">
                    <div className="fs-cell">
                      <div className="fs-label">Outstanding Balance</div>
                      <div className="fs-value">{fmtCurrencyFull(data.receivables.outstanding_balance)}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">Approved (pending disbursement)</div>
                      <div className="fs-value">{fmtCurrencyFull(data.receivables.approved_balance)}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">Approved deals</div>
                      <div className="fs-value">{data.receivables.approved_count}</div>
                    </div>
                    <div className="fs-cell">
                      <div className="fs-label">Funded deals</div>
                      <div className="fs-value">{data.receivables.outstanding_count}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Recent transactions ── */}
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Recent transactions</h3>
                </div>
                {data.recent_transactions.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                    <p style={{ marginBottom: 12 }}>No transactions yet.</p>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => pushTransactionNew(router)}
                    >
                      Submit your first invoice
                    </button>
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Financed</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_transactions.map(t => (
                        <tr
                          key={t.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => pushTransactionDetail(router, t.id)}
                        >
                          <td style={{ fontSize: 13 }}>
                            {t.invoice_number ?? t.id.slice(0, 8) + '…'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                            {t.invoice_amount != null ? fmtCurrencyFull(t.invoice_amount) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                            {t.financing_amount_approved != null ? fmtCurrencyFull(t.financing_amount_approved) : '—'}
                          </td>
                          <td>
                            <span className={`badge badge-${
                              t.status === 'completed' ? 'funded'
                              : t.status === 'funded'   ? 'active'
                              : t.status === 'rejected' ? 'rejected'
                              : 'pending'
                            }`}>
                              {STATUS_LABELS[t.status] ?? t.status}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
                            {fmtDate(t.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PortalShell>
  )
}
