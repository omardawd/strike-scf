'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
import { pushKybDetail } from '@/lib/kyb-referrer'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'
import { PerformanceScorecard } from '@/components/performance-scorecard'
import { LineChart, PeriodToggle, type Period } from '@/components/charts'
import { RiskBadge } from '@/components/risk-badge'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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
  name?: string | null
  file_name?: string | null
  document_kind?: string | null
  created_at: string
  signed_url: string | null
}

function documentLabels(t: TFn): Record<string, string> {
  return {
    certificate_of_incorporation: t('programDetail.doc.certificateOfIncorporation'),
    ein_letter:                   t('programDetail.doc.einLetter'),
    ownership_structure:          t('programDetail.doc.ownershipStructure'),
    audited_financials:           t('programDetail.doc.auditedFinancials'),
    bank_statements:              t('programDetail.doc.bankStatements'),
    insurance_certificate:        t('programDetail.doc.insuranceCertificate'),
    banking_license:              t('supplierDetail.doc.bankingLicense'),
    aml_kyc_policy:               t('programDetail.doc.amlKycPolicy'),
    bsa_officer_letter:           t('supplierDetail.doc.bsaOfficerLetter'),
    fdic_exam_report:             t('supplierDetail.doc.fdicExamReport'),
    invoice_pdf:                  t('supplierDetail.doc.invoiceDocument'),
    purchase_order:               t('supplierDetail.doc.purchaseOrder'),
    supporting_document:          t('supplierDetail.doc.supportingDocument'),
    delivery_confirmation:        t('supplierDetail.doc.deliveryConfirmation'),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDocLabel(doc: any, t: TFn): string {
  if (doc.document_kind) {
    const label = documentLabels(t)[doc.document_kind as string]
    if (label) return label
  }
  const filename = (doc.name ?? doc.file_name) as string | undefined
  return filename?.replace(/\.[^/.]+$/, '') ?? String(doc.document_kind ?? t('supplierDetail.document'))
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

function kybLabel(s: string, t: TFn) {
  const m: Record<string, string> = {
    approved: t('programDetail.kyb.approved'), submitted: t('programDetail.kyb.submitted'), under_review: t('programDetail.kyb.underReview'),
    more_info_requested: t('programDetail.kyb.infoRequested'), rejected: t('programDetail.kyb.rejected'), draft: t('programsPage.status.draft'),
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

function collTypeLabel(type: string, t: TFn) {
  const m: Record<string, string> = {
    post_dated_cheque:         t('txnDetail.collateral.postDatedCheque'),
    personal_guarantee:        t('txnDetail.collateral.personalGuarantee'),
    assignment_of_receivables: t('txnDetail.collateral.assignmentOfReceivables'),
    cash_collateral:           t('txnDetail.collateral.cashCollateral'),
    asset_pledge:              t('txnDetail.collateral.assetPledge'),
    other:                     t('txnDetail.collateral.other'),
  }
  return m[type] ?? type
}

function supplierCollStatusLabel(s: string, t: TFn) {
  const m: Record<string, string> = {
    pending:   t('transactionsPage.pending'),
    submitted: t('programDetail.kyb.submitted'),
    accepted:  t('dealDetail.accepted'),
    rejected:  t('transactionsPage.rejected'),
    waived:    t('txnDetail.waive'),
    released:  t('txnDetail.release'),
  }
  return m[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

function txnBadge(s: string) {
  if (s === 'completed') return 'badge-funded'
  if (s === 'funded' || s === 'financing_approved') return 'badge-active'
  if (s === 'rejected') return 'badge-rejected'
  return 'badge-pending'
}

function statusLabels(t: TFn): Record<string, string> {
  return {
    pending_anchor_approval: t('anchorDetail.status.pendingAnchor'),
    pending_bank_review:     t('anchorDetail.status.pendingBank'),
    more_info_requested:     t('anchorDetail.status.moreInfo'),
    financing_approved:      t('transactionsPage.approved'),
    funded:                  t('transactionsPage.funded'),
    completed:               t('deals.status.completed'),
    rejected:                t('transactionsPage.rejected'),
  }
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
  const t = useT()

  async function save() {
    if (!desc.trim() || !deadline) { setErr(t('supplierDetail.errDescriptionDeadlineRequired')); return }
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
      if (!res.ok) throw new Error(d.error ?? t('programDetail.failed'))
      onSuccess(); onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('programDetail.failed'))
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3 className="t-card-head">{t('supplierDetail.addCollateralRequirement')}</h3>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t('common.cancel')}</button>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">{t('newTransaction.type')}</label>
          <select className="form-input" value={collType} onChange={e => setCollType(e.target.value)}>
            <option value="post_dated_cheque">{t('txnDetail.collateral.postDatedCheque')}</option>
            <option value="personal_guarantee">{t('txnDetail.collateral.personalGuarantee')}</option>
            <option value="assignment_of_receivables">{t('txnDetail.collateral.assignmentOfReceivables')}</option>
            <option value="cash_collateral">{t('txnDetail.collateral.cashCollateral')}</option>
            <option value="asset_pledge">{t('txnDetail.collateral.assetPledge')}</option>
            <option value="other">{t('txnDetail.collateral.other')}</option>
          </select>
        </div>
        <div>
          <label className="form-label">{t('listingDetail.description')}</label>
          <textarea
            className="form-input" rows={2} value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder={t('txnDetail.describeCollateralRequirement')}
          />
        </div>
        <div>
          <label className="form-label">{t('supplierDetail.deadline')}</label>
          <input className="form-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        {err && <div style={{ color: '#DC2626', fontSize: 13 }}>{err}</div>}
        <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? t('programDetail.savingEllipsis') : t('supplierDetail.addRequirement')}
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
  const t = useT()

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [riskData, setRiskData]         = useState<any>(null)
  const [scoringRisk, setScoringRisk]   = useState(false)

  const [anchorCrumbName, setAnchorCrumbName] = useState(t('transactionsPage.anchor'))

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
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&supplier_id=${supplierId}&period=${volPeriod}`),
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
            all.filter(tx => tx.supplier_id === supplierId && tx.program_id === programId)
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

        const riskRes = await fetch('/api/risk/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: supplierId }),
        })
        if (riskRes.ok) setRiskData(await riskRes.json())
      } else {
        const [kybRes, txRes, analyticsRes] = await Promise.all([
          fetch(`/api/kyb/${supplierId}`),
          fetch('/api/transactions'),
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&supplier_id=${supplierId}&period=${volPeriod}`),
        ])

        if (kybRes.ok) {
          const kybData = await kybRes.json()
          setOrg(kybData.organization ?? null)
          setDocs(kybData.documents ?? [])
        } else {
          const netRes = await fetch(`/api/programs/${programId}/network`)
          if (netRes.ok) {
            const netData = await netRes.json()
            const supplierEntry =
              (netData.suppliers ?? []).find((s: { id: string }) => s.id === supplierId) ??
              (netData.kyb_suppliers ?? []).find((s: { id: string }) => s.id === supplierId)
            if (supplierEntry) {
              setOrg({
                id: supplierEntry.id,
                legal_name: supplierEntry.legal_name,
                kyb_status: supplierEntry.kyb_status,
                status: supplierEntry.status ?? 'approved',
              })
            }
          }
        }

        if (txRes.ok) {
          const txData = await txRes.json()
          const all: TxRow[] = txData.transactions ?? txData.data ?? []
          setTransactions(
            all.filter(tx =>
              tx.supplier_id === supplierId &&
              tx.anchor_id   === anchorId   &&
              tx.program_id  === programId
            )
          )
        }

        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json())
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('txnDetail.failedToLoadGeneric'))
    } finally {
      setLoading(false)
    }
  }, [portal, supplierId, anchorId, programId, collVersion, volPeriod, t])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (org?.legal_name) {
      try { sessionStorage.setItem('breadcrumb_supplier', org.legal_name) } catch {}
    }
  }, [org?.legal_name])

  const orgName = org?.legal_name ?? t('transactionsPage.supplier')

  if (loading) {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}/anchor/${anchorId}`)}
          crumbs={[
            { label: t('programsPage.title'), onClick: () => router.push('/programs') },
            { label: '…', onClick: () => router.push(`/programs/${programId}`) },
            { label: anchorCrumbName, onClick: () => router.push(`/programs/${programId}/anchor/${anchorId}`) },
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

  // ── ANCHOR VIEW ─────────────────────────────────────────────────────────────
  // Reached only from the anchor's own "My Suppliers" list (see programs/[id]/page.tsx),
  // so any non-bank org viewer here is, structurally, the anchor of this relationship.
  if (portal === 'org') {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}`)}
          crumbs={[
            { label: t('programsPage.title'), onClick: () => router.push('/programs') },
            { label: t('programDetail.program'), onClick: () => router.push(`/programs/${programId}`) },
            { label: orgName },
          ]}
          actions={<NotifBell />}
        />
        <div
          className="page"
          data-page-name="Program Anchor-Supplier Detail"
          data-ai-context={JSON.stringify({
            role: 'anchor',
            program_id: programId,
            anchor_org_id: anchorId,
            supplier_org_id: supplierId,
            supplier_name: orgName,
            kyb_status: org?.kyb_status ?? null,
            transaction_count: transactions.length,
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
            <div className="subtitle">{t('transactionsPage.supplier')}</div>
          </div>

          <div className="split-65">
            {/* ── LEFT: Supplier info + analytics + transactions ── */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">{t('supplierDetail.supplierInfo')}</h3></div>
                <div className="kv-rows">
                  <div className="kv-row"><span className="k">{t('programDetail.legalName')}</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                  {org?.ein && (
                    <div className="kv-row"><span className="k">EIN</span><span className="v mono">{maskEIN(org.ein)}</span></div>
                  )}
                  {(org?.city || org?.state) && (
                    <div className="kv-row">
                      <span className="k">{t('anchorDetail.location')}</span>
                      <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {org?.primary_contact_name && (
                    <div className="kv-row"><span className="k">{t('anchorDetail.primaryContact')}</span><span className="v plain">{org.primary_contact_name}</span></div>
                  )}
                  {org?.business_type && (
                    <div className="kv-row"><span className="k">{t('anchorDetail.industry')}</span><span className="v plain">{org.business_type}</span></div>
                  )}
                  {org?.created_at && (
                    <div className="kv-row"><span className="k">{t('anchorDetail.memberSince')}</span><span className="v plain">{fmtDate(org.created_at)}</span></div>
                  )}
                  {org?.kyb_submitted_at && (
                    <div className="kv-row"><span className="k">{t('anchorDetail.kybSubmitted')}</span><span className="v plain">{fmtDate(org.kyb_submitted_at)}</span></div>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h3 className="t-card-head">{t('anchorDetail.analytics')}</h3>
                  <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('programDetail.transactions')}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics?.total_transactions ?? 0}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('programDetail.invoiceVolume')}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_invoice_amount) : '—'}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('anchorDetail.totalFinanced')}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_financed) : '—'}</div>
                    </div>
                  </div>
                  <style>{PULSE_KF}</style>
                  {analytics
                    ? <LineChart data={analytics.monthly_volume ?? []} height={80} color="var(--color-accent)" />
                    : <div style={{ height: 80, background: 'var(--offwhite)', borderRadius: 6, animation: 'chart-pulse 1.5s infinite' }} />
                  }
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">{t('programDetail.transactions')}</h3>
                  {/* <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => pushTransactionNew(router)}
                  >
                    <Icon name="plus" size={14} /> New
                  </button> */}
                </div>
                {transactions.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                    {t('supplierDetail.noTransactionsYetWithSupplier')}
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('newTransaction.invoiceHash')}</th>
                        <th style={{ textAlign: 'right' }}>{t('txnDetail.amount')}</th>
                        <th>{t('deals.col.status')}</th>
                        <th>{t('txnDetail.date')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map(tx => (
                        <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => pushTransactionDetail(router, tx.id)}>
                          <td style={{ fontSize: 13 }}>{tx.invoice_number ?? tx.id.slice(0, 8) + '…'}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                            {tx.financing_amount_approved != null ? fmtCurrency(tx.financing_amount_approved)
                              : tx.invoice_amount != null ? fmtCurrency(tx.invoice_amount) : '—'}
                          </td>
                          <td><span className={`badge ${txnBadge(tx.status)}`}>{statusLabels(t)[tx.status] ?? tx.status}</span></td>
                          <td style={{ fontSize: 12, color: 'var(--gray)' }}>{fmtDate(tx.created_at)}</td>
                          <td style={{ color: 'var(--gray)', fontSize: 16, textAlign: 'right' }}>›</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── RIGHT: KYB status (read-only) + documents ── */}
            <div>
              <div style={{ marginBottom: 16 }}>
                <PerformanceScorecard orgId={supplierId} showRefresh={false} />
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">{t('anchorDetail.kybStatus')}</h3></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <span className={`badge ${kybBadge(org?.kyb_status ?? 'draft')}`}>
                      {kybLabel(org?.kyb_status ?? 'draft', t)}
                    </span>
                  </div>
                  {(!org?.kyb_status || org.kyb_status === 'draft') && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('supplierDetail.kybNotSubmittedNeedsToComplete')}</div>
                  )}
                  {org?.kyb_status === 'submitted' && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('supplierDetail.kybSubmittedAwaitingReview')}</div>
                  )}
                  {org?.kyb_status === 'under_review' && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('supplierDetail.kybUnderReviewByBank')}</div>
                  )}
                  {org?.kyb_status === 'approved' && (
                    <div style={{ fontSize: 13, color: 'var(--color-green)' }}>{t('supplierDetail.kybApprovedEligible')}</div>
                  )}
                  {org?.kyb_status === 'rejected' && (
                    <div style={{ fontSize: 13, color: '#DC2626' }}>{t('supplierDetail.kybRejectedCannotParticipate')}</div>
                  )}
                  {org?.kyb_status === 'more_info_requested' && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('supplierDetail.additionalInfoRequestedFromSupplier')}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--gray)', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                    {t('supplierDetail.kybManagedByBank')}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3 className="t-card-head">{t('txnDetail.documents')}</h3></div>
                {docs.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                    {t('supplierDetail.documentsWillAppear')}
                  </div>
                ) : (
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {docs.map(doc => (
                      <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{getDocLabel(doc, t)}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray)' }}>{fmtDate(doc.created_at)}</div>
                        </div>
                        {doc.signed_url && (
                          <a href={doc.signed_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                            {t('txnDetail.download')}
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
          { label: t('programsPage.title'), onClick: () => router.push('/programs') },
          { label: t('programDetail.program'), onClick: () => router.push(`/programs/${programId}`) },
          { label: anchorCrumbName, onClick: () => router.push(`/programs/${programId}/anchor/${anchorId}`) },
          { label: orgName },
        ]}
        actions={<NotifBell />}
      />
      <div
        className="page"
        data-page-name="Program Anchor-Supplier Detail"
        data-ai-context={JSON.stringify({
          role: 'bank',
          program_id: programId,
          anchor_org_id: anchorId,
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
          <div className="subtitle">{t('supplierDetail.supplierProfile')}</div>
        </div>

        <div className="split-65">
          {/* ── LEFT: Org details + analytics + transactions ── */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">{t('anchorDetail.organization')}</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">{t('programDetail.legalName')}</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                {org?.business_type && <div className="kv-row"><span className="k">{t('anchorDetail.industry')}</span><span className="v plain">{org.business_type}</span></div>}
                {org?.ein && <div className="kv-row"><span className="k">EIN</span><span className="v mono">{org.ein}</span></div>}
                {(org?.city || org?.state) && (
                  <div className="kv-row">
                    <span className="k">{t('anchorDetail.location')}</span>
                    <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {org?.annual_revenue_range != null && (
                  <div className="kv-row"><span className="k">{t('anchorDetail.annualRevenue')}</span><span className="v plain">{fmtMoney(org.annual_revenue_range)}</span></div>
                )}
                {org?.primary_contact_name && (
                  <div className="kv-row"><span className="k">{t('anchorDetail.contact')}</span><span className="v plain">{org.primary_contact_name}</span></div>
                )}
                {org?.primary_contact_email && (
                  <div className="kv-row"><span className="k">{t('anchorDetail.email')}</span><span className="v plain">{org.primary_contact_email}</span></div>
                )}
              </div>
            </div>

            {analytics && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h3 className="t-card-head">{t('anchorDetail.analytics')}</h3>
                  <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                </div>
                <div className="card-body">
                  <div className="kpi-strip" style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('programDetail.transactions')}</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.total_transactions}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('programDetail.invoiceVolume')}</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(analytics.total_invoice_amount)}</div>
                    </div>
                    <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)' }}>
                      <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>{t('programDetail.avgRate')}</div>
                      <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.avg_financing_rate ? `${analytics.avg_financing_rate.toFixed(1)}%` : '—'}</div>
                    </div>
                  </div>
                  <LineChart data={analytics.monthly_volume ?? []} height={80} color="var(--color-accent)" />
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">{t('programDetail.transactions')}</h3>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => router.push('/transactions')}
                >
                  {t('supplierDetail.viewAll')}
                </button>
              </div>
              {transactions.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  {t('supplierDetail.noTransactionsYet')}
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('newTransaction.invoiceHash')}</th>
                      <th style={{ textAlign: 'right' }}>{t('txnDetail.amount')}</th>
                      <th>{t('deals.col.status')}</th>
                      <th>{t('txnDetail.date')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => pushTransactionDetail(router, tx.id)}>
                        <td style={{ fontSize: 13 }}>{tx.invoice_number ?? tx.id.slice(0, 8) + '…'}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {tx.financing_amount_approved != null ? fmtCurrency(tx.financing_amount_approved)
                            : tx.invoice_amount != null ? fmtCurrency(tx.invoice_amount) : '—'}
                        </td>
                        <td><span className={`badge ${txnBadge(tx.status)}`}>{statusLabels(t)[tx.status] ?? tx.status}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--gray)' }}>{fmtDate(tx.created_at)}</td>
                        <td style={{ color: 'var(--gray)', fontSize: 16, textAlign: 'right' }}>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── RIGHT: Risk Assessment + KYB + Credit score + Collateral + Documents ── */}
          <div>
            <div style={{ border: '1px solid var(--border)', background: 'var(--offwhite)', marginBottom: 16 }}>
              <div style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>{t('supplierDetail.riskAssessment')}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={async () => {
                    setScoringRisk(true)
                    const res = await fetch('/api/risk/score', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ org_id: supplierId }),
                    })
                    if (res.ok) setRiskData(await res.json())
                    setScoringRisk(false)
                  }}
                  disabled={scoringRisk}
                >
                  {scoringRisk ? t('supplierDetail.scoringEllipsis') : `↻ ${t('supplierDetail.refresh')}`}
                </button>
              </div>

              <div style={{ padding: '16px 20px' }}>
                {riskData ? (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <RiskBadge
                        score={riskData.risk_score}
                        tier={riskData.risk_tier}
                        flags={riskData.risk_flags}
                        showScore={true}
                        size="md"
                      />
                    </div>

                    <div style={{ display: 'grid', gap: '1px', background: 'var(--border)', marginBottom: 12 }}>
                      {([
                        [t('supplierDetail.kybCompliance'), riskData.breakdown?.kyb_score, 25],
                        [t('supplierDetail.tariffGeo'), riskData.breakdown?.tariff_score, 25],
                        [t('supplierDetail.performance'), riskData.breakdown?.performance_score, 25],
                        [t('supplierDetail.financial'), riskData.breakdown?.financial_score, 25],
                      ] as [string, number, number][]).map(([label, score, max]) => (
                        <div key={label} style={{
                          background: 'var(--offwhite)',
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--gray)',
                          }}>{label}</span>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            color: 'var(--ink)',
                          }}>{score}/{max}</span>
                        </div>
                      ))}
                    </div>

                    {riskData.tariff_exposure && (
                      <div style={{
                        padding: '10px 12px',
                        background: riskData.tariff_exposure.tariff_risk === 'high'
                          ? 'rgba(220,38,38,0.04)' : 'var(--offwhite)',
                        border: '1px solid',
                        borderColor: riskData.tariff_exposure.tariff_risk === 'high'
                          ? 'rgba(220,38,38,0.2)' : 'var(--border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: riskData.tariff_exposure.tariff_risk === 'high' ? '#DC2626' : 'var(--gray)',
                      }}>
                        ⚠{' '}{riskData.tariff_exposure.label}{' · '}{t('supplierDetail.htsTariffPct', { pct: riskData.tariff_exposure.hts_tariff_pct })}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--gray)',
                    letterSpacing: '0.1em',
                  }}>
                    {scoringRisk ? t('supplierDetail.analyzingSupplier') : t('supplierDetail.clickRefreshToRunRisk')}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <PerformanceScorecard orgId={supplierId} showRefresh={true} viewerRole="bank" />
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">{t('supplierDetail.kybAndCredit')}</h3></div>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0, marginBottom: 0 }}>
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') && (
                        <span className="badge badge-active">{t('anchorDetail.readyForReview')}</span>
                      )}
                      {org?.kyb_status === 'approved' && <span className="badge badge-funded">{t('programDetail.kyb.approved')}</span>}
                      {org?.kyb_status === 'rejected' && <span className="badge badge-rejected">{t('programDetail.kyb.rejected')}</span>}
                      {org?.kyb_status === 'more_info_requested' && <span className="badge badge-pending">{t('anchorDetail.moreInfoRequested')}</span>}
                      {org?.kyb_status === 'in_progress' && <span className="badge badge-pending">{t('anchorDetail.applicationInProgress')}</span>}
                      {(!org?.kyb_status || org?.kyb_status === 'not_started' || org?.kyb_status === 'draft') && (
                        <span className="badge badge-draft">{t('anchorDetail.notStarted')}</span>
                      )}
                      {org?.kyb_status === 'approved' && creditScore?.risk_tier && (
                        <span className={`badge ${riskTierBadge(creditScore.risk_tier)}`}>
                          {t('anchorDetail.riskTier', { tier: creditScore.risk_tier })}
                        </span>
                      )}
                      {org?.credit_reviewed_at && org?.kyb_status === 'approved' && (
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>
                          {t('anchorDetail.reviewedOn', { date: fmtDate(org.credit_reviewed_at) })}
                        </span>
                      )}
                    </div>
                    {(!org?.kyb_status || org?.kyb_status === 'not_started' || org?.kyb_status === 'draft') && (
                      <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('anchorDetail.kybNotSubmittedYet')}</div>
                    )}
                    {org?.kyb_status === 'rejected' && (
                      <div style={{ fontSize: 13, color: '#DC2626' }}>
                        {t('supplierDetail.kybRejectedCannotParticipate')}
                      </div>
                    )}
                    {org?.kyb_status === 'more_info_requested' && (
                      <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                        {t('supplierDetail.additionalInfoRequestedFromSupplier')}
                      </div>
                    )}
                    <div>
                      <button
                        className={(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                        type="button"
                        onClick={() => pushKybDetail(router, supplierId)}
                      >
                        {(org?.kyb_status === 'submitted' || org?.kyb_status === 'under_review') ? t('anchorDetail.reviewKybApplication') : t('anchorDetail.viewKybRecord')}
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
                        {t('anchorDetail.riskTier', { tier: creditScore.risk_tier })}
                      </span>
                    )}
                  </div>
                  <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
                    {t('supplierDetail.creditScore')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                    {t('supplierDetail.scoredOn', { date: fmtDate(creditScore.created_at) })}
                  </div>
                </div>
              ) : (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  {t('supplierDetail.creditReviewPending')}
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3 className="t-card-head">{t('supplierDetail.onboardingCollateral')}</h3>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setShowAddColl(v => !v)}
                >
                  {showAddColl ? t('common.cancel') : `+ ${t('txnDetail.add')}`}
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
                  {t('txnDetail.noCollateralRequirements')}
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
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{collTypeLabel(c.collateral_type, t)}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray)' }}>{c.description}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                          {t('supplierDetail.dueOn', { date: fmtDate(c.deadline) })}
                          {c.required_value != null && ` · ${fmtCurrency(c.required_value)}`}
                        </div>
                      </div>
                      <span className={`badge ${collBadge(c.status)}`} style={{ flexShrink: 0 }}>
                        {supplierCollStatusLabel(c.status, t)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">{t('txnDetail.documents')}</h3></div>
              {docs.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--gray)' }}>
                  {t('anchorDetail.noDocumentsUploaded')}
                </div>
              ) : (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {docs.map(doc => (
                    <div key={doc.id} className="doc-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{getDocLabel(doc, t)}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)' }}>{fmtDate(doc.created_at)}</div>
                      </div>
                      {doc.signed_url && (
                        <a
                          href={doc.signed_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          {t('txnDetail.download')}
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
