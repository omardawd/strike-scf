'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { KYB_REFERRER_KEY } from '@/lib/kyb-referrer'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { AIInsight } from '@/components/ai-insight'
import { RiskBadge } from '@/components/risk-badge'
import type { RiskTier } from '@strike-scf/types'

type CreditDecision = 'approved' | 'override_approved' | 'more_info_requested' | 'rejected' | 'pending_countersign'

interface Document {
  id: string
  name: string
  document_kind: string
  storage_path: string
  created_at: string
  signed_url: string | null
}

const DOCUMENT_LABELS: Record<string, string> = {
  certificate_of_incorporation: 'Certificate of Incorporation',
  ein_letter:                   'IRS EIN Confirmation Letter',
  ownership_structure:          'Ownership Structure',
  audited_financials:           'Audited Financials (2 years)',
  bank_statements:              'Bank Statements (6 months)',
  insurance_certificate:        'Certificate of Insurance',
  banking_license:              'Banking License / Charter',
  aml_kyc_policy:               'AML / KYC Policy',
  bsa_officer_letter:           'BSA Officer Letter',
  fdic_exam_report:             'FDIC Exam Report',
  invoice_pdf:                  'Invoice Document',
  purchase_order:               'Purchase Order',
  supporting_document:          'Supporting Document',
  delivery_confirmation:        'Delivery Confirmation',
  // additional document kinds
  articles_of_organization:     'Articles of Organization',
  memorandum_of_association:    'Memorandum of Association',
  business_license:             'Business License',
  tax_id:                       'Tax Identification',
  bank_statement:               'Bank Statement',
  management_accounts:          'Management Accounts',
  balance_sheet:                'Balance Sheet',
  profit_loss:                  'Profit & Loss Statement',
  accounts_receivable_aging:    'Accounts Receivable Aging',
  accounts_payable_aging:       'Accounts Payable Aging',
  trade_reference:              'Trade Reference Letter',
  id_passport:                  'Government-Issued ID / Passport',
  proof_of_address:             'Proof of Address',
  shareholder_register:         'Shareholder Register',
  ubo_declaration:              'Ultimate Beneficial Owner Declaration',
  other:                        'Supporting Document',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDocLabel(doc: any): string {
  if (doc.document_kind) {
    const label = DOCUMENT_LABELS[doc.document_kind as string]
    if (label) return label
  }
  const filename = doc.name as string | undefined
  return filename?.replace(/\.[^/.]+$/, '') ?? String(doc.document_kind ?? 'Document')
}

interface CreditScore {
  id: string
  total_score: number
  risk_tier: string | null
  created_at: string
}

interface DecisionRecord {
  id: string
  decision: string
  decided_by_user_id: string
  score_at_decision: number | null
  risk_tier_at_decision: string | null
  override_reason: string | null
  rejection_reason: string | null
  info_request_message: string | null
  created_at: string
}

interface Organization {
  id: string
  legal_name: string
  type: string
  kyb_status: string
  status: string
  ein: string | null
  city: string | null
  state: string | null
  risk_tier: string | null
  credit_score: number | null
  kyb_submitted_at: string | null
  created_at: string
  credit_reviewed_at: string | null
}

type DecisionMode = 'none' | 'approve' | 'request_info' | 'reject'

function kybBadgeClass(status: string): string {
  switch (status) {
    case 'submitted': return 'badge badge-pending'
    case 'under_review': return 'badge badge-signing'
    case 'more_info_requested': return 'badge badge-offer'
    case 'approved': return 'badge badge-active'
    case 'rejected': return 'badge badge-rejected'
    case 'in_progress': return 'badge badge-pending'
    default: return 'badge badge-draft'
  }
}

function kybStatusLabel(status: string): string {
  switch (status) {
    case 'submitted': return 'Submitted'
    case 'under_review': return 'Under Review'
    case 'more_info_requested': return 'More Info Needed'
    case 'approved': return 'Approved'
    case 'rejected': return 'Rejected'
    case 'in_progress': return 'In Progress'
    case 'not_started': return 'Not Started'
    default: return status
  }
}

function decisionLabel(decision: string): string {
  switch (decision) {
    case 'approved': return 'Approved'
    case 'override_approved': return 'Override Approved'
    case 'rejected': return 'Rejected'
    case 'more_info_requested': return 'Requested More Info'
    case 'pending_countersign': return 'Pending Countersign'
    default: return decision
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function tierBadgeStyle(tier: string | null) {
  if (!tier) return {}
  const map: Record<string, { background: string; color: string }> = {
    A: { background: 'var(--color-green-bg)', color: 'var(--color-green)' },
    B: { background: 'var(--color-amber-bg)', color: 'var(--color-amber)' },
    C: { background: 'var(--color-amber-bg)', color: 'var(--color-amber)' },
    D: { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
  }
  return map[tier] ?? {}
}

function scoreBarClass(score: number): string {
  if (score >= 75) return 'bar-green'
  if (score >= 50) return 'bar-amber'
  return 'bar-red'
}

export default function KYBDetailPage() {
  const router = useRouter()
  const params = useParams()
  const orgId = params.org_id as string
  const user = useUser()

  const [org, setOrg] = useState<Organization | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [creditScore, setCreditScore] = useState<CreditScore | null>(null)
  const [latestDecision, setLatestDecision] = useState<DecisionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [riskData, setRiskData] = useState<any>(null)

  // Decision panel state
  const [mode, setMode] = useState<DecisionMode>('none')
  const [riskTier, setRiskTier] = useState<RiskTier | ''>('')
  const [creditScoreInput, setCreditScoreInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [approvalBanner, setApprovalBanner] = useState(false)
  const [referrer, setReferrer] = useState('/kyb')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [internalDocs, setInternalDocs] = useState<any[]>([])
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const isAuthorized = user?.role === 'bank_admin' || user?.role === 'bank_credit_officer'

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/kyb/${orgId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to load application')
        return
      }
      const data = await res.json() as {
        organization: Organization
        documents: Document[]
        credit_score: CreditScore | null
        latest_decision: DecisionRecord | null
      }
      setOrg(data.organization)
      setDocuments(data.documents ?? [])
      setCreditScore(data.credit_score)
      setLatestDecision(data.latest_decision)
    } catch {
      setError('Failed to load application')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Read referrer but do not remove here: React Strict Mode (dev) runs this effect twice;
  // removing on first run leaves storage empty on remount and resets referrer to /kyb.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(KYB_REFERRER_KEY)
      if (stored) setReferrer(stored)
    } catch {}
  }, [])

  useEffect(() => {
    if (!isAuthorized) {
      router.replace('/dashboard')
      return
    }
    fetchData()
  }, [isAuthorized, fetchData, router])

  useEffect(() => {
    if (!isAuthorized || !orgId) return
    fetch('/api/risk/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId }),
    }).then(res => { if (res.ok) res.json().then(setRiskData) }).catch(() => {})
  }, [isAuthorized, orgId])

  useEffect(() => {
    if (!isAuthorized || !orgId) return
    fetch(`/api/kyb/${orgId}/documents`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setInternalDocs(d.documents ?? []) })
      .catch(() => {})
  }, [isAuthorized, orgId])

  async function handleInternalDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingDoc(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('entity_type', 'organization')
      fd.append('entity_id', orgId)
      fd.append('document_kind', 'internal_bank')
      const res = await fetch(`/api/kyb/${orgId}/documents`, { method: 'POST', body: fd })
      if (res.ok) {
        const docsRes = await fetch(`/api/kyb/${orgId}/documents`)
        if (docsRes.ok) {
          const d = await docsRes.json()
          setInternalDocs(d.documents ?? [])
        }
      }
    } finally {
      setUploadingDoc(false)
      e.target.value = ''
    }
  }

  async function submitDecision(decision: CreditDecision) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: Record<string, unknown> = { decision }
      if (decision === 'approved' || decision === 'override_approved') {
        if (riskTier) body.risk_tier = riskTier
        if (creditScoreInput) body.credit_score = parseInt(creditScoreInput, 10)
        if (overrideReason) body.override_reason = overrideReason
      } else if (decision === 'more_info_requested') {
        body.info_request_message = infoMessage
      } else if (decision === 'rejected') {
        body.rejection_reason = rejectionReason
      }

      const res = await fetch(`/api/kyb/${orgId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setSubmitError(data.error ?? 'Failed to submit decision')
        return
      }
      // Reset state and refresh
      setMode('none')
      setRiskTier('')
      setCreditScoreInput('')
      setOverrideReason('')
      setInfoMessage('')
      setRejectionReason('')
      if (decision === 'rejected') {
        router.push(referrer)
        return
      }
      if (decision === 'approved' || decision === 'override_approved') {
        setApprovalBanner(true)
      }
      await fetchData()
    } catch {
      setSubmitError('Failed to submit decision')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isAuthorized) return null

  const submittedDate = org?.kyb_submitted_at
    ? new Date(org.kyb_submitted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—'

  return (
    <>
      <Topbar
        crumbs={[{ label: 'KYB Review', onClick: () => router.push('/kyb') }, { label: org?.legal_name ?? '…' }]}
        actions={<NotifBell />}
      />
    <div className="page">
      <div className="page-header">
        <button
          className="back-btn"
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(KYB_REFERRER_KEY)
            } catch {}
            router.push(referrer)
          }}
        >
          ← Back
        </button>
        {org && (
          <h1 className="page-id-title">
            <span className="id-text">{org.legal_name}</span>
            <span className={kybBadgeClass(org.kyb_status)}>{kybStatusLabel(org.kyb_status)}</span>
            <span className="badge badge-draft" style={{ textTransform: 'capitalize' }}>{org.type}</span>
            {riskData && (
              <RiskBadge
                score={riskData.risk_score}
                tier={riskData.risk_tier}
                flags={riskData.risk_flags}
                showScore={true}
                size="sm"
              />
            )}
          </h1>
        )}
        {org && (
          <div className="subtitle" style={{ marginTop: 6 }}>
            {org.ein && <span>EIN {org.ein}</span>}
            {org.city && org.state && <span> · {org.city}, {org.state}</span>}
            {org.kyb_submitted_at && <span> · Submitted {submittedDate}</span>}
          </div>
        )}
      </div>

      {approvalBanner && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <div className="alert-body">
            Organization approved — they will receive platform access shortly.
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ color: 'var(--color-danger)', padding: 16 }}>{error}</div>
      )}

      {loading ? (
        <div className="card">
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div>
        </div>
      ) : org ? (
        <div className="split-60">
          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Business details */}
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Business details</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">Legal name</span><span className="v">{org.legal_name}</span></div>
                <div className="kv-row"><span className="k">Type</span><span className="v" style={{ textTransform: 'capitalize' }}>{org.type}</span></div>
                {org.ein && <div className="kv-row"><span className="k">EIN</span><span className="v mono">{org.ein}</span></div>}
                {(org.city || org.state) && (
                  <div className="kv-row"><span className="k">Location</span><span className="v">{[org.city, org.state].filter(Boolean).join(', ')}</span></div>
                )}
                <div className="kv-row"><span className="k">KYB status</span><span className="v"><span className={kybBadgeClass(org.kyb_status)}>{kybStatusLabel(org.kyb_status)}</span></span></div>
                <div className="kv-row"><span className="k">Application submitted</span><span className="v plain">{submittedDate}</span></div>
                {org.credit_reviewed_at && (
                  <div className="kv-row"><span className="k">Last reviewed</span><span className="v plain">{formatDate(org.credit_reviewed_at)}</span></div>
                )}
              </div>
            </div>

            {/* Credit score */}
            {creditScore && (
              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Credit score</h3></div>
                <div className="score-head">
                  <div className="num">{creditScore.total_score}</div>
                  <div className="col">
                    {creditScore.risk_tier && (
                      <span className="badge" style={tierBadgeStyle(creditScore.risk_tier)}>
                        Tier {creditScore.risk_tier}
                      </span>
                    )}
                    <div className="progress">
                      <div className={scoreBarClass(creditScore.total_score)} style={{ width: `${creditScore.total_score}%` }} />
                    </div>
                  </div>
                </div>
                <div className="dim-note">Score recorded {formatDate(creditScore.created_at)}</div>
              </div>
            )}

            {/* Documents */}
            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              {documents.length === 0 ? (
                <div style={{ padding: '16px', color: 'var(--gray)' }}>No documents uploaded.</div>
              ) : (
                <div>
                  {documents.map(doc => (
                    <div key={doc.id} className="doc-row">
                      <svg width={14} height={14} className="doc-icon" aria-hidden="true"><use href="#i-doc" /></svg>
                      <span className="doc-name">{getDocLabel(doc)}</span>
                      <span className="doc-date">{formatDate(doc.created_at)}</span>
                      {doc.signed_url ? (
                        <a className="doc-link" href={doc.signed_url} target="_blank" rel="noopener noreferrer">View</a>
                      ) : (
                        <span className="doc-link" style={{ color: 'var(--gray)' }}>Unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Decision history */}
            {latestDecision && (
              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Latest decision</h3></div>
                <div className="timeline">
                  <div className="tl-item">
                    <div className="tl-dot" />
                    <div className="tl-line" />
                    <div className="tl-body">
                      <div className="tl-actor-row">
                        <span className="tl-actor-pill bank">Bank</span>
                        <span className="tl-actor-name">
                          Credit officer{latestDecision.decided_by_user_id
                            ? ` · ${latestDecision.decided_by_user_id.slice(0, 8)}…`
                            : ''}
                        </span>
                        <span className="tl-action">{decisionLabel(latestDecision.decision)}</span>
                      </div>
                      {latestDecision.rejection_reason && (
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink)' }}>
                          Reason: {latestDecision.rejection_reason}
                        </div>
                      )}
                      {latestDecision.info_request_message && (
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink)' }}>
                          Message: {latestDecision.info_request_message}
                        </div>
                      )}
                      {latestDecision.override_reason && (
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink)' }}>
                          Override note: {latestDecision.override_reason}
                        </div>
                      )}
                      <div className="tl-time">{formatDate(latestDecision.created_at)}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Internal Documents — bank only */}
            <div className="card">
              <div className="card-head">
                <span>Internal Documents</span>
                <label
                  className="btn btn-ghost btn-sm"
                  style={{ cursor: uploadingDoc ? 'not-allowed' : 'pointer' }}>
                  {uploadingDoc ? 'Uploading…' : '+ Upload'}
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xlsx,.png,.jpg"
                    style={{ display: 'none' }}
                    disabled={uploadingDoc}
                    onChange={handleInternalDocUpload}
                  />
                </label>
              </div>
              {internalDocs.length === 0 ? (
                <div style={{
                  padding: '16px 20px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--gray)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}>
                  No internal documents
                </div>
              ) : (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                internalDocs.map((doc: any) => (
                  <div key={doc.id} className="doc-row">
                    <svg width={14} height={14} className="doc-icon" aria-hidden="true"><use href="#i-doc" /></svg>
                    <span className="doc-name">{doc.name ?? 'Document'}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--gray)',
                    }}>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                    {doc.signed_url && (
                      <button
                        type="button"
                        className="doc-link"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        onClick={async () => {
                          try {
                            const res = await fetch(doc.signed_url!)
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = doc.name || 'document'
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                            URL.revokeObjectURL(url)
                          } catch {}
                        }}
                      >Download</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT — Sticky decision panel or read-only status */}
          <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            {['submitted', 'under_review', 'in_progress', 'more_info_requested'].includes(org.kyb_status) ? (
              <>
                <AIInsight
                  title="KYB Risk Summary"
                  prompt="Based on this organization's KYB submission, provide a brief risk assessment. Highlight any concerns and recommend approve, request more info, or reject."
                  context={{
                    org_name: org?.legal_name,
                    org_type: org?.type,
                    kyb_status: org?.kyb_status,
                    city: org?.city,
                    state: org?.state,
                    industry: (org as unknown as Record<string, unknown>)?.industry_naics,
                    annual_revenue: (org as unknown as Record<string, unknown>)?.annual_revenue_range,
                    document_count: documents?.length ?? 0,
                    ein_provided: !!org?.ein,
                    risk_score: riskData?.risk_score,
                    risk_tier: riskData?.risk_tier,
                    risk_flags: riskData?.risk_flags,
                    tariff_exposure: riskData?.tariff_exposure,
                  }}
                  collapsed={false}
                />
              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Make a decision</h3></div>
                <div className="decision-panel">
                  {submitError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{submitError}</div>
                  )}

                  <div className="decision-actions">
                    <button
                      className="btn btn-primary btn-full"
                      type="button"
                      onClick={() => setMode(mode === 'approve' ? 'none' : 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-secondary btn-full"
                      type="button"
                      onClick={() => setMode(mode === 'request_info' ? 'none' : 'request_info')}
                    >
                      Request More Info
                    </button>
                    <button
                      className="btn btn-danger btn-full"
                      type="button"
                      onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
                    >
                      Reject
                    </button>
                  </div>

                  {mode === 'approve' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                      <div className="decision-divider" />
                      <div>
                        <label className="field-label" htmlFor="risk-tier">Risk tier</label>
                        <select
                          id="risk-tier"
                          className="input"
                          value={riskTier}
                          onChange={e => setRiskTier(e.target.value as RiskTier | '')}
                        >
                          <option value="">— Select tier —</option>
                          <option value="A">Tier A</option>
                          <option value="B">Tier B</option>
                          <option value="C">Tier C</option>
                          <option value="D">Tier D</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label" htmlFor="credit-score">Credit score (optional)</label>
                        <input
                          id="credit-score"
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0 – 100"
                          value={creditScoreInput}
                          onChange={e => setCreditScoreInput(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="override-note">Override note (optional)</label>
                        <textarea
                          id="override-note"
                          className="input"
                          rows={2}
                          placeholder="Add context for override if needed…"
                          value={overrideReason}
                          onChange={e => setOverrideReason(e.target.value)}
                        />
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={submitting}
                        onClick={() => submitDecision('approved')}
                      >
                        {submitting ? 'Submitting…' : 'Confirm Approval'}
                      </button>
                    </div>
                  )}

                  {mode === 'request_info' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                      <div className="decision-divider" />
                      <div>
                        <label className="field-label" htmlFor="info-message">Message to applicant</label>
                        <textarea
                          id="info-message"
                          className="input"
                          rows={4}
                          placeholder="Describe what additional information is needed…"
                          value={infoMessage}
                          onChange={e => setInfoMessage(e.target.value)}
                        />
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={submitting || infoMessage.trim().length < 10}
                        onClick={() => submitDecision('more_info_requested')}
                      >
                        {submitting ? 'Submitting…' : 'Send Request'}
                      </button>
                    </div>
                  )}

                  {mode === 'reject' && (
                    <div className="reject-block">
                      <div className="decision-divider" />
                      <div>
                        <label className="field-label" htmlFor="reject-reason">Rejection reason (required)</label>
                        <textarea
                          id="reject-reason"
                          className="input"
                          rows={3}
                          placeholder="Explain the reason for rejection…"
                          value={rejectionReason}
                          onChange={e => setRejectionReason(e.target.value)}
                        />
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        disabled={submitting || rejectionReason.trim().length < 10}
                        onClick={() => submitDecision('rejected')}
                      >
                        {submitting ? 'Submitting…' : 'Confirm Rejection'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </>
            ) : (
              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Decision</h3></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {org.kyb_status === 'approved' && (
                    <>
                      <span className="badge badge-active" style={{ alignSelf: 'flex-start' }}>Approved</span>
                      {org.credit_reviewed_at && (
                        <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                          Reviewed {formatDate(org.credit_reviewed_at)}
                        </div>
                      )}
                      {org.risk_tier && (
                        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                          Risk tier: <strong>{org.risk_tier}</strong>
                        </div>
                      )}
                      {latestDecision?.rejection_reason && (
                        <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                          {latestDecision.rejection_reason}
                        </div>
                      )}
                      {org.credit_score != null && (
                        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                          Credit score: <strong>{org.credit_score}</strong>
                        </div>
                      )}
                    </>
                  )}
                  {org.kyb_status === 'rejected' && (
                    <>
                      <span className="badge badge-rejected" style={{ alignSelf: 'flex-start' }}>Rejected</span>
                      {org.credit_reviewed_at && (
                        <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                          Decided {formatDate(org.credit_reviewed_at)}
                        </div>
                      )}
                      {latestDecision?.rejection_reason && (
                        <div style={{ fontSize: 13, color: '#DC2626' }}>
                          Reason: {latestDecision.rejection_reason}
                        </div>
                      )}
                    </>
                  )}
                  {!['approved', 'rejected'].includes(org.kyb_status) && (
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                      {kybStatusLabel(org.kyb_status)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
    </>
  )
}
