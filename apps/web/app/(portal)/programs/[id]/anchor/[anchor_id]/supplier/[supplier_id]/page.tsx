'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
import { pushKybDetail } from '@/lib/kyb-referrer'
import { PortalShell, Topbar, Icon, fmtMoney } from '@/components/portal-shell'

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
  anchor_id: string
  program_id: string
}

interface AnalyticsData {
  total_transactions: number
  total_invoice_amount: number
  total_financed: number
  total_completed: number
  total_funded: number
  total_pending: number
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
    pending:   'badge-pending',
    submitted: 'badge-active',
    accepted:  'badge-funded',
    rejected:  'badge-rejected',
    waived:    'badge-draft',
    released:  'badge-draft',
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

function maskEIN(raw: string | null | undefined) {
  const clean = (raw ?? '').replace(/\D/g, '')
  if (clean.length < 4) return '—'
  return `**-***${clean.slice(-4)}`
}

// ── BarChart ──────────────────────────────────────────────────────────────────
function BarChart({ items }: { items: Array<{ label: string; value: number; count: number }> }) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)
  const safeItems = items ?? []
  const max = Math.max(...safeItems.map(i => i.value), 1)

  if (safeItems.length === 0) {
    return (
      <div style={{
        height: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--color-ink-4)', fontSize: 12,
      }}>
        No transaction data yet
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
      {safeItems.map((item, i) => {
        const pct = max > 0 ? (item.value / max) : 0
        const barHeight = Math.max(pct * 60, item.value > 0 ? 2 : 0)
        return (
          <div key={i} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            position: 'relative',
          }}
            onMouseEnter={() => setHoveredBar(i)}
            onMouseLeave={() => setHoveredBar(null)}
          >
            {hoveredBar === i && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 6,
                background: 'var(--color-ink-1)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                zIndex: 10,
                pointerEvents: 'none',
              }}>
                {fmtMoney(item.value ?? 0)}
              </div>
            )}
            <div style={{
              width: '100%',
              height: barHeight + 'px',
              background: hoveredBar === i
                ? 'var(--color-accent)'
                : 'rgba(37,99,235,0.3)',
              borderRadius: '3px 3px 0 0',
              minHeight: 2,
              transition: 'background 0.1s',
            }} />
            <div style={{ fontSize: 10, color: 'var(--color-ink-4)' }}>{item.label}</div>
          </div>
        )
      })}
    </div>
  )
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
        {err && <div style={{ color: 'var(--color-red)', fontSize: 13 }}>{err}</div>}
        <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Add requirement'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SupplierDetailPage() {
  const portal     = usePortal()
  const user       = useUser()
  const router     = useRouter()
  const params     = useParams()
  const programId  = params.id          as string
  const anchorId   = params.anchor_id   as string
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

  const [anchorCrumbName, setAnchorCrumbName] = useState('Anchor')

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('breadcrumb_anchor')
      if (stored) setAnchorCrumbName(stored)
    } catch {}
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      if (portal === 'bank') {
        const [kybRes, txRes, collRes, analyticsRes] = await Promise.all([
          fetch(`/api/kyb/${supplierId}`),
          fetch('/api/transactions'),
          fetch(`/api/collateral?org_id=${supplierId}`),
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&supplier_id=${supplierId}`),
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
      } else {
        const [kybRes, txRes, analyticsRes] = await Promise.all([
          fetch(`/api/kyb/${supplierId}`),
          fetch('/api/transactions'),
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&supplier_id=${supplierId}`),
        ])

        if (kybRes.ok) {
          const kybData = await kybRes.json()
          setOrg(kybData.organization ?? null)
          setDocs(kybData.documents ?? [])
        } else {
          const netRes = await fetch(`/api/programs/${programId}/network`)
          if (netRes.ok) {
            const netData = await netRes.json()
            const supplierEntry = (netData.suppliers ?? []).find((s: { id: string }) => s.id === supplierId)
            if (supplierEntry) {
              setOrg({
                id: supplierEntry.id,
                legal_name: supplierEntry.legal_name,
                kyb_status: supplierEntry.kyb_status,
                status: supplierEntry.status,
              })
            }
          }
        }

        if (txRes.ok) {
          const txData = await txRes.json()
          const all: TxRow[] = txData.transactions ?? txData.data ?? []
          setTransactions(
            all.filter(t =>
              t.supplier_id === supplierId &&
              t.anchor_id   === anchorId   &&
              t.program_id  === programId
            )
          )
        }

        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json())
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [portal, supplierId, anchorId, programId, collVersion])

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
          onBack={() => router.push(`/programs/${programId}/anchor/${anchorId}`)}
          crumbs={[
            { label: 'Programs', onClick: () => router.push('/programs') },
            { label: '…', onClick: () => router.push(`/programs/${programId}`) },
            { label: anchorCrumbName, onClick: () => router.push(`/programs/${programId}/anchor/${anchorId}`) },
            { label: '…' },
          ]}
        />
        <div className="page">
          <div className="page-header">
            <div style={{ height: 28, width: 200, background: 'var(--color-border)', borderRadius: 6 }} />
          </div>
        </div>
      </PortalShell>
    )
  }

  // ── ANCHOR VIEW ─────────────────────────────────────────────────────────────
  if (portal === 'anchor') {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}`)}
          crumbs={[
            { label: 'Programs', onClick: () => router.push('/programs') },
            { label: 'Program', onClick: () => router.push(`/programs/${programId}`) },
            { label: orgName },
          ]}
          // actions={
          //   <button
          //     className="btn btn-primary btn-sm"
          //     type="button"
          //     onClick={() => pushTransactionNew(router)}
          //   >
          //     <Icon name="plus" size={14} /> New Transaction
          //   </button>
          // }
        />
        <div className="page">
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 20 }}>
              <Icon name="error" size={16} className="alert-icon" />
              <div className="alert-body">{error}</div>
            </div>
          )}

          <div className="page-header">
            <h1 className="t-page-title">{orgName}</h1>
            <div className="subtitle">Supplier</div>
          </div>

          <div className="split-65">
            {/* ── LEFT: Supplier info + analytics + transactions ── */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">Supplier Info</h3></div>
                <div className="kv-rows">
                  <div className="kv-row"><span className="k">Legal name</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                  {org?.ein && (
                    <div className="kv-row"><span className="k">EIN</span><span className="v mono">{maskEIN(org.ein)}</span></div>
                  )}
                  {(org?.city || org?.state) && (
                    <div className="kv-row">
                      <span className="k">Location</span>
                      <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {org?.primary_contact_name && (
                    <div className="kv-row"><span className="k">Primary contact</span><span className="v plain">{org.primary_contact_name}</span></div>
                  )}
                  {org?.business_type && (
                    <div className="kv-row"><span className="k">Industry</span><span className="v plain">{org.business_type}</span></div>
                  )}
                  {org?.created_at && (
                    <div className="kv-row"><span className="k">Member since</span><span className="v plain">{fmtDate(org.created_at)}</span></div>
                  )}
                  {org?.kyb_submitted_at && (
                    <div className="kv-row"><span className="k">KYB submitted</span><span className="v plain">{fmtDate(org.kyb_submitted_at)}</span></div>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">Analytics</h3></div>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Transactions</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics?.total_transactions ?? 0}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_invoice_amount) : '—'}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Total Financed</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_financed) : '—'}</div>
                    </div>
                  </div>
                  <BarChart items={analytics?.monthly_volume ?? []} />
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Transactions</h3>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => pushTransactionNew(router)}
                  >
                    <Icon name="plus" size={14} /> New
                  </button>
                </div>
                {transactions.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                    No transactions yet with this supplier.
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
                          <td style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{fmtDate(t.created_at)}</td>
                          <td style={{ color: 'var(--color-ink-4)', fontSize: 16, textAlign: 'right' }}>›</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── RIGHT: KYB status (read-only) + documents ── */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">KYB Status</h3></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <span className={`badge ${kybBadge(org?.kyb_status ?? 'draft')}`}>
                      {kybLabel(org?.kyb_status ?? 'draft')}
                    </span>
                  </div>
                  {(!org?.kyb_status || org.kyb_status === 'draft') && (
                    <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>KYB not submitted yet. The supplier needs to complete their application.</div>
                  )}
                  {org?.kyb_status === 'submitted' && (
                    <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>KYB submitted and awaiting bank review.</div>
                  )}
                  {org?.kyb_status === 'under_review' && (
                    <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>KYB is currently under review by the bank.</div>
                  )}
                  {org?.kyb_status === 'approved' && (
                    <div style={{ fontSize: 13, color: 'var(--color-green)' }}>KYB approved. Supplier is eligible for financing.</div>
                  )}
                  {org?.kyb_status === 'rejected' && (
                    <div style={{ fontSize: 13, color: 'var(--color-red)' }}>KYB rejected. Supplier cannot participate in financing.</div>
                  )}
                  {org?.kyb_status === 'more_info_requested' && (
                    <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>Additional information requested from supplier.</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--color-ink-4)', paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
                    KYB approval is managed by the bank and cannot be actioned here.
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
                {docs.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                    Documents will appear here once KYB is submitted.
                  </div>
                ) : (
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {docs.map(doc => (
                      <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.file_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{fmtDate(doc.created_at)}</div>
                        </div>
                        {doc.signed_url && (
                          <a href={doc.signed_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
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

  // ── BANK VIEW ───────────────────────────────────────────────────────────────
  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push(`/programs/${programId}/anchor/${anchorId}`)}
        crumbs={[
          { label: 'Programs', onClick: () => router.push('/programs') },
          { label: 'Program', onClick: () => router.push(`/programs/${programId}`) },
          { label: anchorCrumbName, onClick: () => router.push(`/programs/${programId}/anchor/${anchorId}`) },
          { label: orgName },
        ]}
        // actions={
        //   <button
        //     className="btn btn-ghost btn-sm"
        //     type="button"
        //     onClick={() => router.push(`/kyb/${supplierId}`)}
        //   >
        //     Full KYB
        //   </button>
        // }
      />
      <div className="page">
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
                <div className="card-head"><h3 className="t-card-head">Analytics</h3></div>
                <div className="card-body">
                  <div className="kpi-strip" style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Transactions</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics.total_transactions}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(analytics.total_invoice_amount)}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Avg Rate</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics.avg_financing_rate ? `${analytics.avg_financing_rate.toFixed(1)}%` : '—'}</div>
                    </div>
                  </div>
                  <BarChart items={analytics.monthly_volume ?? []} />
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
                <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
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
                        <td style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{fmtDate(t.created_at)}</td>
                        <td style={{ color: 'var(--color-ink-4)', fontSize: 16, textAlign: 'right' }}>›</td>
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
              <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 0, marginBottom: 0 }}>
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
                        <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                          Reviewed {fmtDate(org.credit_reviewed_at)}
                        </span>
                      )}
                    </div>
                    {(!org?.kyb_status || org?.kyb_status === 'not_started' || org?.kyb_status === 'draft') && (
                      <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>KYB not submitted yet.</div>
                    )}
                    {org?.kyb_status === 'rejected' && (
                      <div style={{ fontSize: 13, color: 'var(--color-red)' }}>
                        KYB rejected. Supplier cannot participate in financing.
                      </div>
                    )}
                    {org?.kyb_status === 'more_info_requested' && (
                      <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
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
                    <span style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink-1)', lineHeight: 1 }}>
                      {creditScore.total_score ?? '—'}
                    </span>
                    {creditScore.risk_tier && (
                      <span className={`badge ${riskTierBadge(creditScore.risk_tier)}`}>
                        Risk {creditScore.risk_tier}
                      </span>
                    )}
                  </div>
                  <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)' }}>
                    Credit score
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-4)' }}>
                    Scored {fmtDate(creditScore.created_at)}
                  </div>
                </div>
              ) : (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
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
                <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
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
                              ? 'var(--color-red)'
                              : 'var(--color-amber)',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{collTypeLabel(c.collateral_type)}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{c.description}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginTop: 2 }}>
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
                <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                  No documents uploaded.
                </div>
              ) : (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {docs.map(doc => (
                    <div key={doc.id} className="doc-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.file_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{fmtDate(doc.created_at)}</div>
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
