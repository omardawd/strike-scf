'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar } from '@/components/portal-shell'
import { DOC_KIND_LABELS, REQUESTABLE_DOC_KINDS } from '@/lib/kyb-document-kinds'
import { useT } from '@/lib/i18n/locale-context'

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
  | { type: 'more_info'; orgId: string; message: string; requestedDocs: string[] }
  | null

function fmtDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminPage() {
  const t = useT()
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

  async function handleKybAction(orgId: string, action: string, extra?: { reason?: string; message?: string; requested_documents?: string[] }) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kyb/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('admin.actionFailed')); return }
      setKybOrgs(prev => prev.filter(o => o.id !== orgId))
      setActionState(null)
    } catch {
      setError(t('common.networkError'))
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
      setError(t('admin.removeMessageFailed'))
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
      setError(t('admin.dismissReportFailed'))
    }
  }

  if (!user || user.role !== 'strike_admin') return null

  const kpiCards = [
    { label: t('admin.totalOrgs'),              value: stats?.total_orgs              ?? '—' },
    { label: t('admin.activeOrgs'),             value: stats?.active_orgs             ?? '—' },
    { label: t('admin.openFinancingRequests'),  value: stats?.open_financing_requests ?? '—' },
    { label: t('admin.dealsThisMonth'),         value: stats?.deals_this_month        ?? '—' },
  ]

  return (
    <>
      <Topbar crumbs={[{ label: t('admin.title') }, { label: t('admin.dashboard') }]} />

      <div className="page" style={{ maxWidth: 1400 }} data-page-name="Admin Dashboard" data-ai-context={JSON.stringify({ role: 'strike_admin', kyb_pending: kybOrgs.length, room_reports: reports.length, total_orgs: stats?.total_orgs ?? null, active_orgs: stats?.active_orgs ?? null, open_financing: stats?.open_financing_requests ?? null, deals_this_month: stats?.deals_this_month ?? null })}>

        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
              {t('admin.title')}
            </h1>
            <span className="badge" style={{ background: 'var(--color-red-bg)', color: 'var(--color-red)', borderColor: 'var(--color-red)' }}>
              {t('admin.adminOnly')}
            </span>
          </div>
          <p className="subtitle">{t('admin.subtitle')}</p>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span className="alert-icon">✕</span>
            <span className="alert-body">{error}</span>
            <button className="alert-link" onClick={() => setError(null)}>{t('common.dismiss')}</button>
          </div>
        )}

        {/* ── Section 3: Platform Stats ── */}
        <div className="section" style={{ marginBottom: 32 }}>
          <div className="rooms-section-head" style={{ marginBottom: 12 }}>
            <span className="rooms-section-title">{t('admin.platformStats')}</span>
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
            <span className="rooms-section-title">{t('admin.kybQueueTitle')}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loading ? '…' : t('admin.pendingCount', { count: String(kybOrgs.length) })}
            </span>
          </div>

          <div className="card">
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2].map(i => <div key={i} className="mp-skeleton-card" style={{ height: 48 }} />)}
              </div>
            ) : kybOrgs.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--gray)' }}>{t('admin.noneKyb')}</p>
              </div>
            ) : (
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '26%' }} />
                  <col style={{ width: '22%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('bankKyb.col.applicant')}</th>
                    <th>{t('bankKyb.col.type')}</th>
                    <th>{t('bankKyb.col.submitted')}</th>
                    <th>{t('admin.riskScore')}</th>
                    <th>{t('admin.riskFlags')}</th>
                    <th style={{ textAlign: 'right' }}>{t('bankKyb.col.action')}</th>
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
                          <td style={{ overflow: 'hidden' }}>
                            <a
                              href={`/admin/kyb/${org.id}`}
                              onClick={e => { e.preventDefault(); router.push(`/admin/kyb/${org.id}`) }}
                              style={{ fontWeight: 500, color: 'var(--blue)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {name}
                            </a>
                            {org.primary_contact_email && (
                              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.primary_contact_email}</div>
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
                          <td style={{ overflow: 'hidden' }}>
                            {(org.risk_flags ?? []).length > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <span
                                  className="badge badge-pending"
                                  title={org.risk_flags![0]}
                                  style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', display: 'inline-block' }}
                                >
                                  {org.risk_flags![0]}
                                </span>
                                {org.risk_flags!.length > 1 && (
                                  <span style={{ fontSize: 11, color: 'var(--gray)', flexShrink: 0 }}>+{org.risk_flags!.length - 1}</span>
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
                                {t('admin.approve')}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: 11 }}
                                onClick={() => setActionState(
                                  isExpandedMoreInfo ? null : { type: 'more_info', orgId: org.id, message: '', requestedDocs: [] }
                                )}
                              >
                                {t('admin.moreInfo')}
                              </button>
                              <button
                                className="btn btn-sm"
                                style={{ background: 'var(--color-red-bg)', borderColor: 'var(--color-red)', color: 'var(--color-red)', fontSize: 11 }}
                                onClick={() => setActionState(
                                  isExpandedReject ? null : { type: 'reject', orgId: org.id, reason: '' }
                                )}
                              >
                                {t('admin.reject')}
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
                                  <label className="field-label" style={{ color: 'var(--color-red)' }}>{t('admin.rejectionReason')}</label>
                                  <input
                                    className="input"
                                    type="text"
                                    placeholder={t('admin.rejectionReasonPlaceholder')}
                                    value={(actionState as any)?.reason ?? ''}
                                    onChange={e => setActionState(s => s ? { ...s, reason: e.target.value } as any : s)}
                                  />
                                </div>
                                <button
                                  className="btn btn-sm btn-danger"
                                  disabled={submitting}
                                  onClick={() => handleKybAction(org.id, 'reject', { reason: (actionState as any)?.reason })}
                                >
                                  {submitting ? t('admin.rejecting') : t('admin.confirmReject')}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setActionState(null)}>
                                  {t('onboarding.btn.cancel')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Inline more info form */}
                        {isExpandedMoreInfo && (
                          <tr>
                            <td colSpan={6} style={{ background: 'var(--color-amber-bg)', padding: '12px 16px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div>
                                  <label className="field-label" style={{ color: 'var(--color-amber)' }}>{t('admin.messageToApplicant')}</label>
                                  <input
                                    className="input"
                                    type="text"
                                    placeholder={t('admin.messageToApplicantPlaceholder')}
                                    value={(actionState as any)?.message ?? ''}
                                    onChange={e => setActionState(s => s ? { ...s, message: e.target.value } as any : s)}
                                  />
                                </div>
                                <div>
                                  <label className="field-label" style={{ color: 'var(--color-amber)' }}>{t('admin.requestDocsOptional')}</label>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                                    {REQUESTABLE_DOC_KINDS.map(kind => {
                                      const checked = (actionState as any)?.requestedDocs?.includes(kind) ?? false
                                      return (
                                        <label
                                          key={kind}
                                          style={{
                                            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                                            padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                                            border: `1px solid ${checked ? 'var(--color-amber)' : 'var(--border)'}`,
                                            background: checked ? '#fff' : 'transparent',
                                            color: checked ? 'var(--color-amber)' : 'var(--gray)',
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => setActionState(s => {
                                              if (!s || s.type !== 'more_info') return s
                                              const has = s.requestedDocs.includes(kind)
                                              return { ...s, requestedDocs: has ? s.requestedDocs.filter(k => k !== kind) : [...s.requestedDocs, kind] }
                                            })}
                                            style={{ margin: 0 }}
                                          />
                                          {DOC_KIND_LABELS[kind]}
                                        </label>
                                      )
                                    })}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  className="btn btn-sm"
                                  style={{ background: 'var(--color-amber)', borderColor: 'var(--color-amber)', color: '#fff' }}
                                  disabled={submitting || !(actionState as any)?.message?.trim()}
                                  onClick={() => handleKybAction(org.id, 'more_info', { message: (actionState as any)?.message, requested_documents: (actionState as any)?.requestedDocs })}
                                >
                                  {submitting ? t('admin.sending') : t('admin.sendRequest')}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setActionState(null)}>
                                  {t('onboarding.btn.cancel')}
                                </button>
                                </div>
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
            <span className="rooms-section-title">{t('admin.roomReportsTitle')}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
              {loading ? '…' : t('admin.unresolvedCount', { count: String(reports.length) })}
            </span>
          </div>

          <div className="card">
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2].map(i => <div key={i} className="mp-skeleton-card" style={{ height: 48 }} />)}
              </div>
            ) : reports.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--gray)' }}>{t('admin.noneReports')}</p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('admin.col.room')}</th>
                    <th>{t('admin.col.message')}</th>
                    <th>{t('admin.col.reason')}</th>
                    <th>{t('admin.col.reportedBy')}</th>
                    <th>{t('admin.col.date')}</th>
                    <th style={{ textAlign: 'right' }}>{t('bankKyb.col.action')}</th>
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
                          {report.reason ?? t('admin.noReason')}
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
                              {t('admin.removeMsg')}
                            </button>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => handleDismissReport(report.id)}
                          >
                            {t('admin.dismiss')}
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
