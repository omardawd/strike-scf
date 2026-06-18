'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar } from '@/components/portal-shell'

interface KybOrg {
  id: string
  legal_name: string | null
  doing_business_as: string | null
  type: string
  kyb_status: string
  kyb_submitted_at: string | null
  risk_score: number | null
  risk_flags: string[] | null
  primary_contact_email: string | null
  status: string
}

interface RoomReport {
  id: string
  room_id: string
  message_id: string | null
  reason: string | null
  reported_by_name: string
  room_name: string
  message_content: string
  created_at: string
}

interface Stats {
  total_orgs: number
  active_orgs: number
  open_financing_requests: number
  deals_this_month: number
}

type ActionState =
  | { type: 'reject'; orgId: string; reason: string }
  | { type: 'more_info'; orgId: string; message: string }
  | null

function fmtDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminPage() {
  const router = useRouter()
  const user = useUser()

  const [kybOrgs, setKybOrgs] = useState<KybOrg[]>([])
  const [reports, setReports] = useState<RoomReport[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionState, setActionState] = useState<ActionState>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auth guard — redirect non-admins
  useEffect(() => {
    if (user && user.role !== 'strike_admin') {
      router.replace('/dashboard')
    }
  }, [user, router])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [kybRes, reportsRes, statsRes] = await Promise.all([
      fetch('/api/admin/kyb').then(r => r.json()).catch(() => ({ orgs: [] })),
      fetch('/api/admin/rooms/reports').then(r => r.json()).catch(() => ({ reports: [] })),
      fetch('/api/admin/stats').then(r => r.json()).catch(() => null),
    ])
    setKybOrgs(kybRes.orgs ?? [])
    setReports(reportsRes.reports ?? [])
    setStats(statsRes)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleKybAction(orgId: string, action: string, extra?: { reason?: string; message?: string }) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kyb/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Action failed'); return }
      setKybOrgs(prev => prev.filter(o => o.id !== orgId))
      setActionState(null)
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemoveMessage(messageId: string, reportId: string) {
    try {
      await fetch(`/api/admin/rooms/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove' }),
      })
      await fetch(`/api/admin/rooms/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true, resolution: 'message_removed' }),
      })
      setReports(prev => prev.filter(r => r.id !== reportId))
    } catch {
      setError('Failed to remove message')
    }
  }

  async function handleDismissReport(reportId: string) {
    try {
      await fetch(`/api/admin/rooms/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true, resolution: 'dismissed' }),
      })
      setReports(prev => prev.filter(r => r.id !== reportId))
    } catch {
      setError('Failed to dismiss report')
    }
  }

  if (!user || user.role !== 'strike_admin') return null

  const kpiCards = [
    { label: 'Total Orgs',               value: stats?.total_orgs              ?? '—' },
    { label: 'Active Orgs',              value: stats?.active_orgs             ?? '—' },
    { label: 'Open Financing Requests',  value: stats?.open_financing_requests ?? '—' },
    { label: 'Deals This Month',         value: stats?.deals_this_month        ?? '—' },
  ]

  return (
    <>
      <Topbar crumbs={[{ label: 'Admin' }, { label: 'Dashboard' }]} />

      <div className="page" style={{ maxWidth: 1400 }}>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
              Strike Admin
            </h1>
            <span className="badge" style={{ background: 'var(--color-red-bg)', color: 'var(--color-red)', borderColor: 'var(--color-red)' }}>
              Admin Only
            </span>
          </div>
          <p className="subtitle">Platform oversight, KYB decisions, and room moderation.</p>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span className="alert-icon">✕</span>
            <span className="alert-body">{error}</span>
            <button className="alert-link" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* ── Section 3: Platform Stats ── */}
        <div className="section" style={{ marginBottom: 32 }}>
          <div className="rooms-section-head" style={{ marginBottom: 12 }}>
            <span className="rooms-section-title">Platform Stats</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--border)' }}>
            {kpiCards.map(card => (
              <div key={card.label} className="fs-cell">
                <span className="fs-label">{card.label}</span>
                <span className="fs-value" style={{ fontSize: 28 }}>
                  {loading ? <span style={{ opacity: 0.3 }}>—</span> : card.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 1: KYB Escalation Queue ── */}
        <div className="section" style={{ marginBottom: 32 }}>
          <div className="rooms-section-head">
            <span className="rooms-section-title">KYB Escalation Queue</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loading ? '…' : `${kybOrgs.length} pending`}
            </span>
          </div>

          <div className="card">
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2].map(i => <div key={i} className="mp-skeleton-card" style={{ height: 48 }} />)}
              </div>
            ) : kybOrgs.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--gray)' }}>No organizations pending KYB review.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Type</th>
                    <th>Submitted</th>
                    <th>Risk Score</th>
                    <th>Risk Flags</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {kybOrgs.map(org => {
                    const name = org.doing_business_as || org.legal_name || org.id
                    const isExpandedReject    = actionState?.type === 'reject'    && actionState.orgId === org.id
                    const isExpandedMoreInfo  = actionState?.type === 'more_info' && actionState.orgId === org.id
                    return (
                      <React.Fragment key={org.id}>
                        <tr>
                          <td>
                            <div style={{ fontWeight: 500 }}>{name}</div>
                            {org.primary_contact_email && (
                              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{org.primary_contact_email}</div>
                            )}
                          </td>
                          <td>
                            <span className="badge badge-draft" style={{ textTransform: 'capitalize' }}>
                              {org.type}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-body)', fontSize: 12 }}>
                            {fmtDate(org.kyb_submitted_at)}
                          </td>
                          <td>
                            {org.risk_score != null ? (
                              <span style={{
                                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500,
                                color: org.risk_score >= 70 ? 'var(--color-green)' : org.risk_score >= 45 ? 'var(--color-amber)' : 'var(--color-red)',
                              }}>
                                {org.risk_score}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            {(org.risk_flags ?? []).length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {(org.risk_flags ?? []).slice(0, 3).map((flag, i) => (
                                  <span key={i} className="badge badge-pending" style={{ fontSize: 9 }}>{flag}</span>
                                ))}
                                {(org.risk_flags ?? []).length > 3 && (
                                  <span style={{ fontSize: 11, color: 'var(--gray)' }}>+{(org.risk_flags ?? []).length - 3}</span>
                                )}
                              </div>
                            ) : <span style={{ color: 'var(--gray)', fontSize: 12 }}>—</span>}
                          </td>
                          <td className="row-actions">
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-sm"
                                style={{ background: 'var(--color-green)', borderColor: 'var(--color-green)', color: '#fff', fontSize: 11 }}
                                disabled={submitting}
                                onClick={() => handleKybAction(org.id, 'approve')}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: 11 }}
                                onClick={() => setActionState(
                                  isExpandedMoreInfo ? null : { type: 'more_info', orgId: org.id, message: '' }
                                )}
                              >
                                More Info
                              </button>
                              <button
                                className="btn btn-sm"
                                style={{ background: 'var(--color-red-bg)', borderColor: 'var(--color-red)', color: 'var(--color-red)', fontSize: 11 }}
                                onClick={() => setActionState(
                                  isExpandedReject ? null : { type: 'reject', orgId: org.id, reason: '' }
                                )}
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Inline reject form */}
                        {isExpandedReject && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--color-red-bg)', padding: '12px 16px' }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                <div style={{ flex: 1 }}>
                                  <label className="field-label" style={{ color: 'var(--color-red)' }}>Rejection Reason</label>
                                  <input
                                    className="input"
                                    type="text"
                                    placeholder="Provide a reason to include in the email…"
                                    value={(actionState as any)?.reason ?? ''}
                                    onChange={e => setActionState(s => s ? { ...s, reason: e.target.value } as any : s)}
                                  />
                                </div>
                                <button
                                  className="btn btn-sm btn-danger"
                                  disabled={submitting}
                                  onClick={() => handleKybAction(org.id, 'reject', { reason: (actionState as any)?.reason })}
                                >
                                  {submitting ? 'Rejecting…' : 'Confirm Reject'}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setActionState(null)}>
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Inline more info form */}
                        {isExpandedMoreInfo && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--color-amber-bg)', padding: '12px 16px' }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                <div style={{ flex: 1 }}>
                                  <label className="field-label" style={{ color: 'var(--color-amber)' }}>Message to Applicant</label>
                                  <input
                                    className="input"
                                    type="text"
                                    placeholder="Describe what additional information is needed…"
                                    value={(actionState as any)?.message ?? ''}
                                    onChange={e => setActionState(s => s ? { ...s, message: e.target.value } as any : s)}
                                  />
                                </div>
                                <button
                                  className="btn btn-sm"
                                  style={{ background: 'var(--color-amber)', borderColor: 'var(--color-amber)', color: '#fff' }}
                                  disabled={submitting}
                                  onClick={() => handleKybAction(org.id, 'more_info', { message: (actionState as any)?.message })}
                                >
                                  {submitting ? 'Sending…' : 'Send Request'}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setActionState(null)}>
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Section 2: Room Reports Queue ── */}
        <div className="section">
          <div className="rooms-section-head">
            <span className="rooms-section-title">Room Reports Queue</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loading ? '…' : `${reports.length} unresolved`}
            </span>
          </div>

          <div className="card">
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2].map(i => <div key={i} className="mp-skeleton-card" style={{ height: 48 }} />)}
              </div>
            ) : reports.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--gray)' }}>No unresolved room reports.</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Message</th>
                    <th>Reason</th>
                    <th>Reported By</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(report => (
                    <tr key={report.id}>
                      <td style={{ fontWeight: 500, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {report.room_name}
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <span style={{ fontSize: 12, color: 'var(--gray)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {report.message_content
                            ? `"${report.message_content.slice(0, 80)}${report.message_content.length > 80 ? '…' : ''}"`
                            : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-pending" style={{ fontSize: 9 }}>
                          {report.reason ?? 'No reason'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--gray)' }}>{report.reported_by_name}</td>
                      <td style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray)' }}>
                        {fmtDate(report.created_at)}
                      </td>
                      <td className="row-actions">
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {report.message_id && (
                            <button
                              className="btn btn-sm btn-danger"
                              style={{ fontSize: 11 }}
                              onClick={() => handleRemoveMessage(report.message_id!, report.id)}
                            >
                              Remove Msg
                            </button>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => handleDismissReport(report.id)}
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
