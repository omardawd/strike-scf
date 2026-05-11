'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { KYB_REFERRER_KEY } from '@/lib/kyb-referrer'
import type { CreditDecision, RiskTier } from '@strike-scf/types'

interface Document {
  id: string
  file_name: string
  storage_path: string
  created_at: string
  signed_url: string | null
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

  return (
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
          </h1>
        )}
        {org && (
          <div className="subtitle" style={{ marginTop: 6 }}>
            {org.ein && <span>EIN {org.ein}</span>}
            {org.city && org.state && <span> · {org.city}, {org.state}</span>}
            {org.kyb_submitted_at && <span> · Submitted {formatDate(org.kyb_submitted_at)}</span>}
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
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-ink-3)' }}>Loading…</div>
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
                <div className="kv-row"><span className="k">Application submitted</span><span className="v plain">{formatDate(org.kyb_submitted_at)}</span></div>
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
                <div style={{ padding: '16px', color: 'var(--color-ink-3)' }}>No documents uploaded.</div>
              ) : (
                <div>
                  {documents.map(doc => (
                    <div key={doc.id} className="doc-row">
                      <svg width={14} height={14} className="doc-icon" aria-hidden="true"><use href="#i-doc" /></svg>
                      <span className="doc-name">{doc.file_name}</span>
                      <span className="doc-date">{formatDate(doc.created_at)}</span>
                      {doc.signed_url ? (
                        <a className="doc-link" href={doc.signed_url} target="_blank" rel="noopener noreferrer">View</a>
                      ) : (
                        <span className="doc-link" style={{ color: 'var(--color-ink-4)' }}>Unavailable</span>
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
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-ink-2)' }}>
                          Reason: {latestDecision.rejection_reason}
                        </div>
                      )}
                      {latestDecision.info_request_message && (
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-ink-2)' }}>
                          Message: {latestDecision.info_request_message}
                        </div>
                      )}
                      {latestDecision.override_reason && (
                        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-ink-2)' }}>
                          Override note: {latestDecision.override_reason}
                        </div>
                      )}
                      <div className="tl-time">{formatDate(latestDecision.created_at)}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — Sticky decision panel or read-only status */}
          <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
            {['submitted', 'under_review', 'in_progress', 'more_info_requested'].includes(org.kyb_status) ? (
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
            ) : (
              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Decision</h3></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {org.kyb_status === 'approved' && (
                    <>
                      <span className="badge badge-active" style={{ alignSelf: 'flex-start' }}>Approved</span>
                      {org.credit_reviewed_at && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                          Reviewed {formatDate(org.credit_reviewed_at)}
                        </div>
                      )}
                      {org.risk_tier && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-2)' }}>
                          Risk tier: <strong>{org.risk_tier}</strong>
                        </div>
                      )}
                      {latestDecision?.rejection_reason && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                          {latestDecision.rejection_reason}
                        </div>
                      )}
                      {org.credit_score != null && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-2)' }}>
                          Credit score: <strong>{org.credit_score}</strong>
                        </div>
                      )}
                    </>
                  )}
                  {org.kyb_status === 'rejected' && (
                    <>
                      <span className="badge badge-rejected" style={{ alignSelf: 'flex-start' }}>Rejected</span>
                      {org.credit_reviewed_at && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                          Decided {formatDate(org.credit_reviewed_at)}
                        </div>
                      )}
                      {latestDecision?.rejection_reason && (
                        <div style={{ fontSize: 13, color: 'var(--color-red)' }}>
                          Reason: {latestDecision.rejection_reason}
                        </div>
                      )}
                    </>
                  )}
                  {!['approved', 'rejected'].includes(org.kyb_status) && (
                    <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
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
  )
}
