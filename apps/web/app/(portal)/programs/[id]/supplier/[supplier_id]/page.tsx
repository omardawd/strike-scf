'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { pushTransactionDetail } from '@/lib/transaction-referrer'
import { pushKybDetail } from '@/lib/kyb-referrer'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'
import { LineChart, PeriodToggle, type Period } from '@/components/charts'

const PULSE_KF = `@keyframes chart-pulse{0%,100%{opacity:1}50%{opacity:.45}}`

// ── Types ─────────────────────────────────────────────────────────────────────
interface OrgDetail {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  ein?: string | null
  city?: string | null
  state?: string | null
  business_type?: string | null
  annual_revenue_range?: number | null
  primary_contact_name?: string | null
  primary_contact_email?: string | null
  credit_reviewed_at?: string | null
  credit_score?: number | null
  risk_tier?: string | null
  created_at?: string | null
  kyb_submitted_at?: string | null
}

interface KYBDoc {
  id: string
  file_name: string
  created_at: string
  signed_url: string | null
}

interface CreditScore {
  id: string
  total_score: number | null
  risk_tier: string | null
  created_at: string
}

interface CollateralItem {
  id: string
  collateral_type: string
  description: string
  status: string
  deadline: string
  required_value: number | null
}

interface TxRow {
  id: string
  invoice_number: string | null
  invoice_amount: number | null
  financing_amount_approved: number | null
  status: string
  created_at: string
  supplier_id: string
  program_id: string
}

interface AnalyticsData {
  total_transactions: number
  total_invoice_amount: number
  total_financed: number
  avg_financing_rate: number
  monthly_volume: Array<{ label: string; count: number; value: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function kybBadge(s: string) {
  const m: Record<string, string> = {
    approved: 'badge-funded', submitted: 'badge-pending', under_review: 'badge-pending',
    more_info_requested: 'badge-pending', rejected: 'badge-rejected', draft: 'badge-draft',
  }
  return m[s] ?? 'badge-draft'
}

function kybLabel(s: string) {
  const m: Record<string, string> = {
    approved: 'Approved', submitted: 'Submitted', under_review: 'Under Review',
    more_info_requested: 'Info Requested', rejected: 'Rejected', draft: 'Draft',
  }
  return m[s] ?? s
}

function collBadge(s: string) {
  const m: Record<string, string> = {
    pending: 'badge-pending', submitted: 'badge-active', accepted: 'badge-funded',
    rejected: 'badge-rejected', waived: 'badge-draft', released: 'badge-draft',
  }
  return m[s] ?? 'badge-draft'
}

function collTypeLabel(t: string) {
  const m: Record<string, string> = {
    post_dated_cheque:         'Post-dated cheque',
    personal_guarantee:        'Personal guarantee',
    assignment_of_receivables: 'Assignment of receivables',
    cash_collateral:           'Cash collateral',
    asset_pledge:              'Asset pledge',
    other:                     'Other',
  }
  return m[t] ?? t
}

function txnBadge(s: string) {
  if (s === 'completed') return 'badge-funded'
  if (s === 'funded' || s === 'financing_approved') return 'badge-active'
  if (s === 'rejected') return 'badge-rejected'
  return 'badge-pending'
}

const STATUS_LABELS: Record<string, string> = {
  pending_anchor_approval: 'Pending Anchor',
  pending_bank_review:     'Pending Bank',
  more_info_requested:     'More Info',
  financing_approved:      'Approved',
  funded:                  'Funded',
  completed:               'Completed',
  rejected:                'Rejected',
}

function riskTierBadge(t: string | null | undefined) {
  if (!t) return 'badge-draft'
  const m: Record<string, string> = { A: 'badge-funded', B: 'badge-active', C: 'badge-pending', D: 'badge-rejected' }
  return m[t] ?? 'badge-draft'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── AddCollateralForm ──────────────────────────────────────────────────────────
function AddCollateralForm({
  supplierId,
  onClose,
  onSuccess,
}: {
  supplierId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [collType, setCollType] = useState('post_dated_cheque')
  const [desc, setDesc]         = useState('')
  const [deadline, setDeadline] = useState('')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function save() {
    if (!desc.trim() || !deadline) { setErr('Description and deadline are required'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/collateral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'onboarding', org_id: supplierId,
          collateral_type: collType, description: desc.trim(), deadline,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      onSuccess(); onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3 className="t-card-head">Add collateral requirement</h3>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Type</label>
          <select className="form-input" value={collType} onChange={e => setCollType(e.target.value)}>
            <option value="post_dated_cheque">Post-dated cheque</option>
            <option value="personal_guarantee">Personal guarantee</option>
            <option value="assignment_of_receivables">Assignment of receivables</option>
            <option value="cash_collateral">Cash collateral</option>
            <option value="asset_pledge">Asset pledge</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="form-label">Description</label>
          <textarea
            className="form-input" rows={2} value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Describe the collateral requirement…"
          />
        </div>
        <div>
          <label className="form-label">Deadline</label>
          <input className="form-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        {err && <div style={{ color: '#DC2626', fontSize: 13 }}>{err}</div>}
        <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Add requirement'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function IFSupplierDetailPage() {
  const router     = useRouter()
  const params     = useParams()
  const programId  = params.id          as string
  const supplierId = params.supplier_id as string

  const [org, setOrg]                   = useState<OrgDetail | null>(null)
  const [docs, setDocs]                 = useState<KYBDoc[]>([])
  const [creditScore, setCreditScore]   = useState<CreditScore | null>(null)
  const [collateral, setCollateral]     = useState<CollateralItem[]>([])
  const [transactions, setTransactions] = useState<TxRow[]>([])
  const [analytics, setAnalytics]       = useState<AnalyticsData | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [showAddColl, setShowAddColl]   = useState(false)
  const [collVersion, setCollVersion]   = useState(0)
  const [volPeriod, setVolPeriod]       = useState<Period>('monthly')

  const [programCrumbName, setProgramCrumbName] = useState('Program')

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('breadcrumb_program')
      if (stored) setProgramCrumbName(stored)
    } catch {}
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [kybRes, txRes, collRes, analyticsRes] = await Promise.all([
        fetch(`/api/kyb/${supplierId}`),
        fetch('/api/transactions'),
        fetch(`/api/collateral?org_id=${supplierId}`),
        fetch(`/api/programs/${programId}/analytics?supplier_id=${supplierId}&period=${volPeriod}`),
      ])

      if (kybRes.ok) {
        const kybData = await kybRes.json()
        setOrg(kybData.organization ?? null)
        setDocs(kybData.documents ?? [])
        setCreditScore(kybData.credit_score ?? null)
      }

      if (txRes.ok) {
        const txData = await txRes.json()
        const all: TxRow[] = txData.transactions ?? txData.data ?? []
        setTransactions(
          all.filter(t => t.supplier_id === supplierId && t.program_id === programId)
             .slice(0, 20)
        )
      }

      if (collRes.ok) {
        const collData = await collRes.json()
        setCollateral((collData.collateral ?? []).filter((c: CollateralItem & { level: string }) => c.level === 'onboarding'))
      }

      if (analyticsRes.ok) {
        setAnalytics(await analyticsRes.json())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [supplierId, programId, collVersion, volPeriod])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (org?.legal_name) {
      try { sessionStorage.setItem('breadcrumb_supplier', org.legal_name) } catch {}
    }
  }, [org?.legal_name])

  const orgName = org?.legal_name ?? 'Supplier'

  if (loading) {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}`)}
          crumbs={[
            { label: 'Programs', onClick: () => router.push('/programs') },
            { label: programCrumbName, onClick: () => router.push(`/programs/${programId}`) },
            { label: '…' },
          ]}
          actions={<NotifBell />}
        />
        <div className="page">
          <div className="page-header">
            <div style={{ height: 28, width: 200, background: 'var(--border)', borderRadius: 6 }} />
          </div>
        </div>
      </PortalShell>
    )
  }

  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push(`/programs/${programId}`)}
        crumbs={[
          { label: 'Programs', onClick: () => router.push('/programs') },
          { label: programCrumbName, onClick: () => router.push(`/programs/${programId}`) },
          { label: orgName },
        ]}
        actions={<NotifBell />}
      />
      <div
        className="page"
        data-page-name="Program Supplier Detail"
        data-ai-context={JSON.stringify({
          program_id: programId,
          supplier_org_id: supplierId,
          supplier_name: orgName,
          kyb_status: org?.kyb_status ?? null,
          risk_tier: org?.risk_tier ?? null,
          credit_score: org?.credit_score ?? null,
          transaction_count: transactions.length,
          collateral_count: collateral.length,
        })}
      >
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{error}</div>
          </div>
        )}

        <div className="page-header">
          <h1 className="t-page-title">{orgName}</h1>
          <div className="subtitle">Supplier profile</div>
        </div>

        <div className="split-65">
          {/* ── LEFT: Org details + analytics + transactions ── */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">Organization</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">Legal name</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                {org?.business_type && <div className="kv-row"><span className="k">Industry</span><span className="v plain">{org.business_type}</span></div>}
                {org?.ein && <div className="kv-row"><span className="k">EIN</span><span className="v mono">{org.ein}</span></div>}
                {(org?.city || org?.state) && (
                  <div className="kv-row">
                    <span className="k">Location</span>
                    <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {org?.annual_revenue_range != null && (
                  <div className="kv-row"><span className="k">Annual revenue</span><span className="v plain">{fmtMoney(org.annual_revenue_range)}</span></div>
                )}
                {org?.primary_contact_name && (
                  <div className="kv-row"><span className="k">Contact</span><span className="v plain">{org.primary_contact_name}</span></div>
                )}
                {org?.primary_contact_email && (
                  <div className="kv-row"><span className="k">Email</span><span className="v plain">{org.primary_contact_email}</span></div>
                )}
              </div>
            </div>

            {analytics && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h3 className="t-card-head">Analytics</h3>
                  <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                </div>
                <div className="card-body">
                  <div className="kpi-strip" style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Transactions</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.total_transactions}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(analytics.total_invoice_amount)}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Avg Rate</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.avg_financing_rate ? `${analytics.avg_financing_rate.toFixed(1)}%` : '—'}</div>
                    </div>
                  </div>
                  <style>{PULSE_KF}</style>
                  <LineChart data={analytics.monthly_volume ?? []} height={80} color="var(--color-accent)" />
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Transactions</h3>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => router.push('/transactions')}
                >
                  View all
                </button>
              </div>
              {transactions.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  No transactions yet.
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pushTransactionDetail(router, t.id)}>
                        <td style={{ fontSize: 13 }}>{t.invoice_number ?? t.id.slice(0, 8) + '…'}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {t.financing_amount_approved != null ? fmtCurrency(t.financing_amount_approved)
                            : t.invoice_amount != null ? fmtCurrency(t.invoice_amount) : '—'}
                        </td>
                        <td><span className={`badge ${txnBadge(t.status)}`}>{STATUS_LABELS[t.status] ?? t.status}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--gray)' }}>{fmtDate(t.created_at)}</td>
                        <td style={{ color: 'var(--gray)', fontSize: 16, textAlign: 'right' }}>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── RIGHT: KYB + Credit score + Collateral + Documents ── */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">KYB &amp; Credit</h3></div>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0, marginBottom: 0 }}>
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') && (
                        <span className="badge badge-active">Ready for review</span>
                      )}
                      {org?.kyb_status === 'approved' && <span className="badge badge-funded">Approved</span>}
                      {org?.kyb_status === 'rejected' && <span className="badge badge-rejected">Rejected</span>}
                      {org?.kyb_status === 'more_info_requested' && <span className="badge badge-pending">More info requested</span>}
                      {org?.kyb_status === 'in_progress' && <span className="badge badge-pending">Application in progress</span>}
                      {(!org?.kyb_status || org?.kyb_status === 'not_started' || org?.kyb_status === 'draft') && (
                        <span className="badge badge-draft">Not started</span>
                      )}
                      {org?.kyb_status === 'approved' && creditScore?.risk_tier && (
                        <span className={`badge ${riskTierBadge(creditScore.risk_tier)}`}>
                          Risk {creditScore.risk_tier}
                        </span>
                      )}
                      {org?.credit_reviewed_at && org?.kyb_status === 'approved' && (
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>
                          Reviewed {fmtDate(org.credit_reviewed_at)}
                        </span>
                      )}
                    </div>
                    {(!org?.kyb_status || org?.kyb_status === 'not_started' || org?.kyb_status === 'draft') && (
                      <div style={{ fontSize: 13, color: 'var(--gray)' }}>KYB not submitted yet.</div>
                    )}
                    {org?.kyb_status === 'rejected' && (
                      <div style={{ fontSize: 13, color: '#DC2626' }}>
                        KYB rejected. Supplier cannot participate in financing.
                      </div>
                    )}
                    {org?.kyb_status === 'more_info_requested' && (
                      <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                        Additional information requested from supplier.
                      </div>
                    )}
                    <div>
                      <button
                        className={(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                        type="button"
                        onClick={() => pushKybDetail(router, supplierId)}
                      >
                        {(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') ? 'Review KYB application' : 'View KYB record'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {creditScore ? (
                <div className="score-block">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', lineHeight: 1 }}>
                      {creditScore.total_score ?? '—'}
                    </span>
                    {creditScore.risk_tier && (
                      <span className={`badge ${riskTierBadge(creditScore.risk_tier)}`}>
                        Risk {creditScore.risk_tier}
                      </span>
                    )}
                  </div>
                  <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
                    Credit score
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                    Scored {fmtDate(creditScore.created_at)}
                  </div>
                </div>
              ) : (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  Credit review pending.
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3 className="t-card-head">Onboarding Collateral</h3>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setShowAddColl(v => !v)}
                >
                  {showAddColl ? 'Cancel' : '+ Add'}
                </button>
              </div>
              {showAddColl && (
                <div className="card-body" style={{ paddingBottom: 0 }}>
                  <AddCollateralForm
                    supplierId={supplierId}
                    onClose={() => setShowAddColl(false)}
                    onSuccess={() => setCollVersion(v => v + 1)}
                  />
                </div>
              )}
              {collateral.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  No collateral requirements.
                </div>
              ) : (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {collateral.map(c => (
                    <div key={c.id} className="collateral-row">
                      <span
                        className="cdot"
                        style={{
                          background: c.status === 'accepted'
                            ? 'var(--color-green)'
                            : c.status === 'rejected'
                              ? '#DC2626'
                              : 'var(--color-amber)',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{collTypeLabel(c.collateral_type)}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray)' }}>{c.description}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                          Due {fmtDate(c.deadline)}
                          {c.required_value != null && ` · ${fmtCurrency(c.required_value)}`}
                        </div>
                      </div>
                      <span className={`badge ${collBadge(c.status)}`} style={{ flexShrink: 0 }}>
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              {docs.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  No documents uploaded.
                </div>
              ) : (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {docs.map(doc => (
                    <div key={doc.id} className="doc-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.file_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)' }}>{fmtDate(doc.created_at)}</div>
                      </div>
                      {doc.signed_url && (
                        <a
                          href={doc.signed_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}
