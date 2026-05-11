'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { pushKybDetail } from '@/lib/kyb-referrer'

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

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Under Review', value: 'under_review' },
  { label: 'More Info Requested', value: 'more_info_requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

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

function daysWaiting(dateStr: string | null): string {
  if (!dateStr) return '—'
  const ms = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function KYBQueuePage() {
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
        setError((body as { error?: string }).error ?? 'Failed to load KYB queue')
        setOrgs([])
        return
      }
      const data = await res.json() as { organizations: KYBOrg[] }
      setOrgs(data.organizations ?? [])
    } catch {
      setError('Failed to load KYB queue')
      setOrgs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) {
      router.replace('/dashboard')
      return
    }
    fetchOrgs(statusFilter)
  }, [isAuthorized, statusFilter, fetchOrgs, router])

  if (!isAuthorized) return null

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-id-title">KYB Review Queue</h1>
        <div className="subtitle">Review and approve business verification applications</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map(f => (
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
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-ink-3)' }}>
            Loading…
          </div>
        </div>
      ) : orgs.length === 0 && !error ? (
        <div className="card">
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-ink-3)' }}>
            No applications found{statusFilter ? ` for status "${kybStatusLabel(statusFilter)}"` : ''}.
          </div>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Type</th>
                <th>Submitted</th>
                <th>Days Waiting</th>
                <th>KYB Status</th>
                <th className="row-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id}>
                  <td>
                    <div>{org.legal_name}</div>
                    {org.primary_contact_name && (
                      <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{org.primary_contact_name}</div>
                    )}
                  </td>
                  <td style={{ color: 'var(--color-ink-2)', textTransform: 'capitalize' }}>{org.type}</td>
                  <td className="mono">{formatDate(org.kyb_submitted_at ?? org.created_at)}</td>
                  <td className="mono">{daysWaiting(org.kyb_submitted_at ?? org.created_at)}</td>
                  <td><span className={kybBadgeClass(org.kyb_status)}>{kybStatusLabel(org.kyb_status)}</span></td>
                  <td className="row-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => pushKybDetail(router, org.id)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
