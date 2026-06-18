'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

const STATUS_LABELS: Record<string, string> = {
  pending:   'Required by bank',
  submitted: 'Acknowledged by supplier',
  accepted:  'Accepted',
  waived:    'Waived',
  rejected:  'Not accepted — resubmit required',
  released:  'Released',
}

const COLLATERAL_TYPE_LABELS: Record<string, string> = {
  post_dated_cheque:         'Post-dated Cheque',
  personal_guarantee:        'Personal Guarantee',
  assignment_of_receivables: 'Assignment of Receivables',
  cash_collateral:           'Cash Collateral',
  asset_pledge:              'Asset Pledge',
  other:                     'Other',
}

function formatCollateralType(type: string): string {
  return COLLATERAL_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending':   return 'badge-pending'
    case 'submitted': return 'badge-active'
    case 'accepted':  return 'badge-funded'
    case 'rejected':  return 'badge-rejected'
    case 'waived':    return 'badge-draft'
    case 'released':  return 'badge-draft'
    default:          return 'badge-draft'
  }
}

function fmtAmt(n: number | null): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString()
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface CollateralItem {
  id: string
  level: string
  org_id: string | null
  org_name: string | null
  transaction_id: string | null
  collateral_type: string
  description: string
  required_value: number | null
  deadline: string | null
  status: string
  created_at: string
}

const FILTER_TABS = ['All', 'Pending', 'Submitted', 'Accepted', 'Rejected', 'Waived', 'Released']

const COLLATERAL_TYPES = [
  { value: 'post_dated_cheque',         label: 'Post-dated Cheque' },
  { value: 'personal_guarantee',        label: 'Personal Guarantee' },
  { value: 'assignment_of_receivables', label: 'Assignment of Receivables' },
  { value: 'cash_collateral',           label: 'Cash Collateral' },
  { value: 'asset_pledge',              label: 'Asset Pledge' },
  { value: 'other',                     label: 'Other' },
]

export default function CollateralPage() {
  const user   = useUser()
  const router = useRouter()

  const [collateral, setCollateral] = useState<CollateralItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('All')
  const [showForm, setShowForm]     = useState(false)
  const [alert, setAlert]           = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const [form, setForm] = useState({
    collateral_type: 'post_dated_cheque',
    description:     '',
    level:           'transaction' as 'onboarding' | 'transaction',
    transaction_id:  '',
    org_id:          '',
    required_value:  '',
    deadline:        '',
  })
  const [formError, setFormError]   = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => {
    if (user && !BANK_ROLES.includes(user.role) && !ORG_ROLES.includes(user.role)) {
      router.replace('/dashboard')
    }
  }, [user, router])

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/collateral')
      .then(r => r.ok ? r.json() : { collateral: [] })
      .then(d => { setCollateral(d.collateral ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'All'
    ? collateral
    : collateral.filter(c => c.status === filter.toLowerCase())

  const isBank     = BANK_ROLES.includes(user?.role ?? '')
  const isSupplier = ORG_ROLES.includes(user?.role ?? '') && user?.org?.type === 'supplier'

  async function handleAction(id: string, action: string) {
    try {
      const res  = await fetch(`/api/collateral/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setAlert({ kind: 'success', msg: `Collateral ${action}d` })
      load()
      setTimeout(() => setAlert(null), 3000)
    } catch (err) {
      setAlert({ kind: 'error', msg: err instanceof Error ? err.message : 'Action failed' })
    }
  }

  async function handleAdd() {
    setFormSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        level:           form.level,
        collateral_type: form.collateral_type,
        description:     form.description,
        deadline:        form.deadline,
      }
      if (form.level === 'transaction' && form.transaction_id.trim()) {
        body.transaction_id = form.transaction_id.trim()
      } else if (form.level === 'onboarding' && form.org_id.trim()) {
        body.org_id = form.org_id.trim()
      } else {
        setFormError(form.level === 'transaction' ? 'Transaction ID is required' : 'Organization ID is required')
        return
      }
      if (!form.description.trim()) { setFormError('Description is required'); return }
      if (!form.deadline)           { setFormError('Deadline is required'); return }
      if (form.required_value.trim()) {
        body.required_value = parseFloat(form.required_value)
      }

      const res  = await fetch('/api/collateral', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setAlert({ kind: 'success', msg: 'Requirement added' })
      setForm({
        collateral_type: 'post_dated_cheque', description: '',
        level: 'transaction', transaction_id: '', org_id: '',
        required_value: '', deadline: '',
      })
      setShowForm(false)
      load()
      setTimeout(() => setAlert(null), 3000)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add requirement')
    } finally {
      setFormSaving(false)
    }
  }

  return (
    <PortalShell activeSection="collateral">
      <Topbar
        crumbs={[
          { label: 'Collateral' },
        ]}
        actions={
          <>
            <NotifBell />
            {!showForm && isBank && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setShowForm(true)}
              >
                Add requirement
              </button>
            )}
          </>
        }
      />

      <div className="page" data-page-name="Collateral" data-ai-context={JSON.stringify({ role: (user as any)?.role, total: collateral.length, pending: collateral.filter(c => c.status === 'pending').length, submitted: collateral.filter(c => c.status === 'submitted').length, accepted: collateral.filter(c => c.status === 'accepted').length, active_filter: filter })}>
        <div className="page-header">
          <h1 className="t-page-title">Collateral</h1>
          <div className="subtitle">Track collateral requirements across transactions and onboarding</div>
        </div>

        {alert && (
          <div className={`alert ${alert.kind === 'success' ? 'alert-info' : 'alert-error'}`} style={{ marginBottom: 16 }}>
            <div className="alert-body">{alert.msg}</div>
          </div>
        )}

        {/* Add requirement form */}
        {showForm && (
          <div className="card" style={{ marginBottom: 20, maxWidth: 560 }}>
            <div className="card-head">
              <span>New collateral requirement</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="form-label">Type</label>
                  <select
                    className="form-input"
                    value={form.collateral_type}
                    onChange={e => setForm(f => ({ ...f, collateral_type: e.target.value }))}
                    style={{ width: '100%' }}
                  >
                    {COLLATERAL_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Description *</label>
                  <textarea
                    className="form-input"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Describe the collateral requirement…"
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </div>

                <div>
                  <label className="form-label">Level</label>
                  <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
                    {(['transaction', 'onboarding'] as const).map(lvl => (
                      <label key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          checked={form.level === lvl}
                          onChange={() => setForm(f => ({ ...f, level: lvl }))}
                        />
                        {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>

                {form.level === 'transaction' ? (
                  <div>
                    <label className="form-label">Transaction ID *</label>
                    <input
                      className="form-input mono"
                      value={form.transaction_id}
                      onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      style={{ width: '100%' }}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="form-label">Organization ID *</label>
                    <input
                      className="form-input mono"
                      value={form.org_id}
                      onChange={e => setForm(f => ({ ...f, org_id: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      style={{ width: '100%' }}
                    />
                  </div>
                )}

                <div>
                  <label className="form-label">Required value (optional)</label>
                  <input
                    className="form-input mono"
                    value={form.required_value}
                    onChange={e => setForm(f => ({ ...f, required_value: e.target.value }))}
                    placeholder="0.00"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label className="form-label">Deadline *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={form.deadline}
                    onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>

                {formError && (
                  <div style={{ fontSize: 12, color: '#DC2626' }}>{formError}</div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={formSaving}
                    onClick={handleAdd}
                  >
                    {formSaving ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => { setShowForm(false); setFormError(null) }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              type="button"
              className={`btn btn-sm ${filter === tab ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="card">
          {loading ? (
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-body" style={{ padding: 48, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              No collateral requirements
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Organization</th>
                  <th>Description</th>
                  <th>Level</th>
                  <th>Required value</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isPastDue = item.deadline ? new Date(item.deadline) < new Date() && item.status === 'pending' : false
                  return (
                    <tr key={item.id}>
                      <td>{formatCollateralType(item.collateral_type)}</td>
                      <td style={{ fontSize: 12 }}>
                        {item.org_name ?? (item.org_id ? item.org_id.slice(0, 8) + '…' : '—')}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description.length > 40 ? item.description.slice(0, 40) + '…' : item.description}
                      </td>
                      <td>
                        <span className="badge badge-draft">
                          {item.level === 'onboarding' ? 'Onboarding' : 'Transaction'}
                        </span>
                      </td>
                      <td>{fmtAmt(item.required_value)}</td>
                      <td style={{ color: isPastDue ? '#DC2626' : undefined }}>
                        {fmtDate(item.deadline)}
                      </td>
                      <td>
                        <span className={`badge ${statusBadge(item.status)}`}>
                          {STATUS_LABELS[item.status] ?? item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </span>
                      </td>
                      <td>
                        {isSupplier && item.status === 'pending' && (
                          <button className="btn btn-sm btn-primary" type="button" onClick={() => handleAction(item.id, 'submit')}>
                            Acknowledge
                          </button>
                        )}
                        {isBank && item.status === 'submitted' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm btn-primary" type="button" onClick={() => handleAction(item.id, 'accept')}>Accept</button>
                            <button className="btn btn-sm btn-ghost" type="button" onClick={() => handleAction(item.id, 'reject')}>Reject</button>
                          </div>
                        )}
                        {isBank && item.status === 'accepted' && (
                          <button className="btn btn-sm btn-ghost" type="button" onClick={() => handleAction(item.id, 'release')}>Release</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
