'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { pushKybDetail } from '@/lib/kyb-referrer'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

interface KYBOrg {
  id: string
  legal_name: string
  type: string
  kyb_status: string
  status: string
  kyb_submitted_at: string | null
  created_at: string
  risk_tier: string | null
  credit_score: number | null
  ein: string | null
  city: string | null
  state: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
}

function statusFilters(t: TFn) {
  return [
    { label: t('common.all'), value: '' },
    { label: t('bankKyb.status.submitted'), value: 'submitted' },
    { label: t('bankKyb.status.underReview'), value: 'under_review' },
    { label: t('bankKyb.status.moreInfoRequested'), value: 'more_info_requested' },
    { label: t('bankKyb.status.approved'), value: 'approved' },
    { label: t('bankKyb.status.rejected'), value: 'rejected' },
  ]
}

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

function kybStatusLabel(status: string, t: TFn): string {
  switch (status) {
    case 'submitted': return t('bankKyb.status.submitted')
    case 'under_review': return t('bankKyb.status.underReview')
    case 'more_info_requested': return t('bankKyb.status.moreInfoNeeded')
    case 'approved': return t('bankKyb.status.approved')
    case 'rejected': return t('bankKyb.status.rejected')
    case 'in_progress': return t('bankKyb.status.inProgress')
    case 'not_started': return t('bankKyb.status.notStarted')
    default: return status
  }
}

function daysWaiting(dateStr: string | null, t: TFn): string {
  if (!dateStr) return '—'
  const ms = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return t('bankKyb.today')
  if (days === 1) return t('bankKyb.oneDay')
  return t('bankKyb.daysCount', { count: String(days) })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function KYBQueuePage() {
  const t = useT()
  const router = useRouter()
  const user = useUser()
  const [orgs, setOrgs] = useState<KYBOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  const isAuthorized = user?.role === 'bank_admin' || user?.role === 'bank_credit_officer'

  const fetchOrgs = useCallback(async (status: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = status ? `/api/kyb?status=${encodeURIComponent(status)}` : '/api/kyb'
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? t('bankKyb.loadFailed'))
        setOrgs([])
        return
      }
      const data = await res.json() as { organizations: KYBOrg[] }
      setOrgs(data.organizations ?? [])
    } catch {
      setError(t('bankKyb.loadFailed'))
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!isAuthorized) {
      router.replace('/dashboard')
      return
    }
    fetchOrgs(statusFilter)
  }, [isAuthorized, statusFilter, fetchOrgs, router])

  if (!isAuthorized) return null

  return (
    <>
      <Topbar
        crumbs={[{ label: t('bankKyb.title') }]}
        actions={<NotifBell />}
      />
      <div className="page" data-page-name="KYB Review Queue" data-ai-context={JSON.stringify({ role: (user as any)?.role, total_applications: orgs.length, status_filter: statusFilter || 'all', pending: orgs.filter(o => o.kyb_status === 'submitted' || o.kyb_status === 'under_review').length })}>
        <div className="page-header">
          <h1 className="page-id-title">{t('bankKyb.title')}</h1>
          <div className="subtitle">{t('bankKyb.subtitle')}</div>
        </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {statusFilters(t).map(f => (
          <button
            key={f.value}
            className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ color: 'var(--color-danger)', padding: 16 }}>{error}</div>
      )}

      {loading ? (
        <div className="card">
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--gray)' }}>
            {t('common.loading')}
          </div>
        </div>
      ) : orgs.length === 0 && !error ? (
        <div className="card">
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--gray)' }}>
            {statusFilter ? t('bankKyb.noneForStatus', { status: kybStatusLabel(statusFilter, t) }) : t('bankKyb.none')}
          </div>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>{t('bankKyb.col.applicant')}</th>
                <th>{t('bankKyb.col.type')}</th>
                <th>{t('bankKyb.col.submitted')}</th>
                <th>{t('bankKyb.col.daysWaiting')}</th>
                <th>{t('bankKyb.col.kybStatus')}</th>
                <th className="row-actions">{t('bankKyb.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id}>
                  <td>
                    <div>{org.legal_name}</div>
                    {org.primary_contact_name && (
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{org.primary_contact_name}</div>
                    )}
                  </td>
                  <td style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>{org.type}</td>
                  <td className="mono">{formatDate(org.kyb_submitted_at ?? org.created_at)}</td>
                  <td className="mono">{daysWaiting(org.kyb_submitted_at ?? org.created_at, t)}</td>
                  <td><span className={kybBadgeClass(org.kyb_status)}>{kybStatusLabel(org.kyb_status, t)}</span></td>
                  <td className="row-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => pushKybDetail(router, org.id)}
                    >
                      {t('bankKyb.review')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </>
  )
}
