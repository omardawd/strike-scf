'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'
import { LineChart, PeriodToggle, type Period } from '@/components/charts'
import { BulkInviteModal } from '@/components/bulk-invite-modal'
import { RiskBadge } from '@/components/risk-badge'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Program {
  id: string
  name: string
  financing_types: string[]
  status: string
  program_limit: number | null
  per_supplier_sublimit: number | null
  min_deal_size: number | null
  max_deal_size: number | null
  standard_tenor_days: number
  currency: string
  created_at: string
  bank_id: string
}

interface SupplierEntry { id: string; legal_name: string; kyb_status: string; status: string; enrolled_at?: string | null }

interface AnchorEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  enrolled_at?: string | null
  suppliers: SupplierEntry[]
  supplier_count: number
  pending_kyb_count: number
  transaction_count: number
}

interface SupplierNetEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  enrolled_at?: string | null
  transaction_count: number
  latest_transaction_status: string | null
  risk_tier?: string | null
  risk_flags?: any[] | null
  performance_tier?: string | null
  country_of_origin?: string | null
}

interface AnchorNetEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  transaction_count: number
  outstanding_balance: number
  risk_tier?: string | null
  risk_flags?: any[] | null
  performance_tier?: string | null
  country_of_origin?: string | null
}

interface PendingAnchorInv {
  id: string
  email: string
  status: 'invited'
  invited_at: string
  expires_at: string | null
  type: 'invitation'
}

interface PendingSupplierInv {
  id: string
  email: string
  anchor_org_id: string | null
  status: 'invited' | 'pending_bank_review'
  invited_at: string
  type: 'invitation'
}

interface KybPendingEntry {
  id: string
  legal_name: string
  kyb_status: string
  anchor_org_id?: string | null
}

interface PendingAnchorRequest {
  id: string
  email: string
  anchor_org_id: string | null
  status: 'pending_bank_review'
  invited_at: string
  prefilled_kyb?: Record<string, unknown> | null
  invitee_name?: string | null
}

interface AnalyticsData {
  total_transactions: number
  total_invoice_amount: number
  total_financed: number
  total_completed: number
  total_funded: number
  total_pending: number
  active_anchors: number
  active_suppliers: number
  avg_financing_rate: number
  monthly_volume: Array<{ label: string; count: number; value: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(s: string) {
  const m: Record<string, string> = { active: 'badge-active', draft: 'badge-draft', closed: 'badge-draft', pending: 'badge-pending' }
  return m[s] ?? 'badge-draft'
}

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

function initials(name: string) {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── NetworkCard ────────────────────────────────────────────────────────────────
function NetworkCard({
  name,
  kybStatus,
  stats,
  suppliers,
  riskTier,
  riskFlags,
  countryOfOrigin,
  onClick,
}: {
  name: string
  kybStatus: string
  stats: Array<{ label: string; value: string | number; red?: boolean }>
  suppliers?: SupplierEntry[]
  riskTier?: string | null
  riskFlags?: any[] | null
  countryOfOrigin?: string | null
  onClick: () => void
}) {
  return (
    <div
      className="network-card"
      onClick={onClick}
      style={{ cursor: 'pointer', marginBottom: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div className="avatar">{initials(name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="network-name">{name}</div>
          <div className="network-meta">
            {kybStatus === 'approved' && <span className="verified-dot" />}
            <span className={`badge ${kybBadge(kybStatus)}`}>{kybLabel(kybStatus)}</span>
          </div>
          {riskTier && (
            <div style={{ marginTop: 4 }}>
              <RiskBadge
                tier={riskTier as 'green' | 'amber' | 'red'}
                flags={riskFlags?.slice(0, 1)}
                size="sm"
              />
            </div>
          )}
          {countryOfOrigin && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
              marginTop: 3,
            }}>
              ⊙ {countryOfOrigin}
            </div>
          )}
        </div>
        {suppliers && suppliers.length > 0 && (
          <div className="supplier-stack">
            {suppliers.slice(0, 3).map((s, i) => (
              <div key={i} className="savatar" title={s.legal_name}>{initials(s.legal_name)}</div>
            ))}
            {suppliers.length > 3 && (
              <span style={{ fontSize: 11, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
                +{suppliers.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        className="network-stats"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 24, flex: 1 }}
      >
        {stats.map((s, i) => (
          <div key={i}>
            <div
              className="network-stat-label"
              style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}
            >
              {s.label}
            </div>
            <div
              className="network-stat-value"
              style={{ fontSize: 14, fontWeight: 600, color: s.red ? '#DC2626' : 'var(--ink)' }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const AVAILABLE_DOCS = [
  { id: 'certificate_of_incorporation', label: 'Certificate of Incorporation' },
  { id: 'ein_letter',                   label: 'IRS EIN Confirmation Letter' },
  { id: 'ownership_structure',          label: 'Ownership Structure' },
  { id: 'audited_financials',           label: 'Audited Financials (2 years)' },
  { id: 'bank_statements',              label: 'Bank Statements (6 months)' },
  { id: 'insurance_certificate',        label: 'Certificate of Insurance' },
  { id: 'aml_kyc_policy',              label: 'AML / KYC Policy' },
  { id: 'custom_document',              label: 'Custom document (specify below)' },
]

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProgramDetailPage() {
  const portal = usePortal()
  const user   = useUser()
  const router = useRouter()
  const params = useParams()
  const id     = params.id as string

  const [program, setProgram]         = useState<Program | null>(null)
  const [anchors, setAnchors]         = useState<AnchorEntry[]>([])
  const [suppliers, setSuppliers]     = useState<SupplierNetEntry[]>([])
  const [anchorList, setAnchorList]   = useState<AnchorNetEntry[]>([])
  const [analytics, setAnalytics]         = useState<AnalyticsData | null>(null)
  const [pendingAnchors, setPendingAnchors] = useState<PendingAnchorInv[]>([])
  const [pendingSuppliers, setPendingSuppliers] = useState<PendingSupplierInv[]>([])
  const [kybAnchors, setKybAnchors] = useState<KybPendingEntry[]>([])
  const [kybSuppliers, setKybSuppliers] = useState<KybPendingEntry[]>([])
  const [signedUpAnchors, setSignedUpAnchors] = useState<Array<{ email: string }>>([])
  const [signedUpSuppliers, setSignedUpSuppliers] = useState<Array<{ email: string }>>([])
  const [pendingAnchorRequests, setPendingAnchorRequests] = useState<PendingAnchorRequest[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [isIFOnly, setIsIFOnly]       = useState(false)
  const [networkVersion, setNetworkVersion] = useState(0)
  const [volPeriod, setVolPeriod] = useState<Period>('monthly')

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteRole, setInviteRole]           = useState<'anchor' | 'supplier'>('anchor')
  const [inviteName, setInviteName]           = useState('')
  const [inviteEmail, setInviteEmail]         = useState('')
  const [inviteLoading, setInviteLoading]     = useState(false)
  const [inviteError, setInviteError]         = useState<string | null>(null)
  const [inviteSent, setInviteSent]           = useState(false)
  const [inviteMode, setInviteMode]           = useState<'standard' | 'known_counterparty' | 'custom_kyb'>('standard')
  const [prefilledKyb, setPrefilledKyb]       = useState<Record<string, string>>({})
  const [requiredDocs, setRequiredDocs]       = useState<string[]>([])
  const [customDocName, setCustomDocName]     = useState('')

  const [cancelError, setCancelError]   = useState<string | null>(null)

  const [showBulkInvite, setShowBulkInvite] = useState(false)

  const [editing, setEditing]         = useState(false)
  const [editName, setEditName]       = useState('')
  const [editLimit, setEditLimit]     = useState('')
  const [editSubLimit, setEditSubLimit] = useState('')
  const [editMinDeal, setEditMinDeal] = useState('')
  const [editMaxDeal, setEditMaxDeal] = useState('')
  const [editTenor, setEditTenor]     = useState('')
  const [editStatus, setEditStatus]   = useState('')
  const [editSaving, setEditSaving]   = useState(false)
  const [editError, setEditError]     = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState(false)

  const [activating, setActivating] = useState(false)
  const [deleting, setDeleting]     = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const fetches: Promise<Response>[] = [
        fetch(`/api/programs/${id}`),
        fetch(`/api/programs/${id}/network`),
      ]
      if (portal === 'bank') fetches.push(fetch(`/api/programs/${id}/analytics?period=${volPeriod}`))

      const results = await Promise.all(fetches)
      if (!results[0]!.ok) throw new Error(`HTTP ${results[0]!.status}`)
      const progData = await results[0]!.json()
      setProgram(progData.program)

      if (results[1]!.ok) {
        const netData = await results[1]!.json()
        const localIsIFOnly = netData.isInvoiceFactoring === true
        setIsIFOnly(localIsIFOnly)
        setAnchors(netData.anchors ?? [])
        setSuppliers(netData.suppliers ?? [])
        setAnchorList(netData.anchors ?? [])
        setPendingAnchors(netData.pending_anchors ?? [])
        setPendingSuppliers(netData.pending_suppliers ?? [])
        setKybAnchors(netData.kyb_anchors ?? [])
        setKybSuppliers(netData.kyb_suppliers ?? [])
        setSignedUpAnchors(netData.signed_up_anchors ?? [])
        setSignedUpSuppliers(netData.signed_up_suppliers ?? [])
        setPendingAnchorRequests(netData.pending_anchor_requests ?? [])
      }

      if (portal === 'bank' && results[2]?.ok) {
        setAnalytics(await results[2].json())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id, portal, volPeriod])

  useEffect(() => { load() }, [load, networkVersion])

  useEffect(() => {
    if (program?.name) {
      try { sessionStorage.setItem('breadcrumb_program', program.name) } catch {}
    }
  }, [program?.name])

  async function handleSendInvite() {
    if (!inviteEmail.includes('@')) { setInviteError('Enter a valid email'); return }
    setInviteLoading(true); setInviteError(null)
    try {
      const body: Record<string, unknown> = {
        name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole,
        invitation_mode: inviteMode,
      }
      if (inviteRole === 'supplier' && user?.org_id) body.anchor_org_id = user.org_id
      if (inviteMode === 'known_counterparty') body.prefilled_kyb = prefilledKyb
      if (inviteMode === 'custom_kyb') {
        body.required_documents = requiredDocs.map(docId =>
          docId === 'custom_document'
            ? { id: docId, label: customDocName }
            : AVAILABLE_DOCS.find(d => d.id === docId)
        )
      }
      const res = await fetch(`/api/programs/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      setInviteSent(true)
      setNetworkVersion(v => v + 1)
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setInviteLoading(false)
    }
  }

  function openInviteModal(role: 'anchor' | 'supplier') {
    setInviteRole(role); setInviteName(''); setInviteEmail(''); setInviteError(null); setInviteSent(false)
    setInviteMode('standard'); setPrefilledKyb({}); setRequiredDocs([]); setCustomDocName('')
    setShowInviteModal(true)
  }

  function startEdit() {
    if (!program) return
    setEditName(program.name)
    setEditLimit(program.program_limit != null ? String(program.program_limit) : '')
    setEditSubLimit(program.per_supplier_sublimit != null ? String(program.per_supplier_sublimit) : '')
    setEditMinDeal(program.min_deal_size != null ? String(program.min_deal_size) : '')
    setEditMaxDeal(program.max_deal_size != null ? String(program.max_deal_size) : '')
    setEditTenor(String(program.standard_tenor_days))
    setEditStatus(program.status)
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit() {
    if (!program) return
    setEditSaving(true); setEditError(null)
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        status: editStatus,
        standard_tenor_days: Number(editTenor) || program.standard_tenor_days,
      }
      if (editLimit)    body.program_limit          = Number(editLimit)
      if (editSubLimit) body.per_supplier_sublimit  = Number(editSubLimit)
      if (editMinDeal)  body.min_deal_size          = Number(editMinDeal)
      if (editMaxDeal)  body.max_deal_size          = Number(editMaxDeal)
      const res = await fetch(`/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to save')
      setProgram(d.program)
      setEditing(false)
      setEditSuccess(true)
      setTimeout(() => setEditSuccess(false), 3000)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleActivate() {
    setActivating(true)
    const res = await fetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    if (res.ok) {
      setProgram(prev => prev ? { ...prev, status: 'active' } : prev)
    }
    setActivating(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this draft program? This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    })
    if (res.ok) {
      router.push('/programs')
    }
    setDeleting(false)
  }

  async function cancelInvite(invId: string, kind: 'anchor' | 'supplier') {
    setCancelError(null)
    try {
      const res = await fetch(`/api/programs/${id}/invite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitation_id: invId, action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCancelError(data.error ?? 'Failed to cancel invitation')
        return
      }
      if (kind === 'anchor') {
        setPendingAnchors(prev => prev.filter(p => p.id !== invId))
      } else {
        setPendingSuppliers(prev => prev.filter(p => p.id !== invId))
      }
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel invitation')
    }
  }

  async function handleApproveAnchorInvite(invId: string, mode: 'standard' | 'custom_kyb') {
    try {
      const res = await fetch(`/api/programs/${id}/invite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitation_id: invId, action: 'approve', invitation_mode: mode }),
      })
      if (!res.ok) return
      setPendingAnchorRequests(prev => prev.filter(p => p.id !== invId))
      setNetworkVersion(v => v + 1)
    } catch {}
  }

  async function handleDeclineAnchorInvite(invId: string) {
    try {
      const res = await fetch(`/api/programs/${id}/invite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitation_id: invId, action: 'decline' }),
      })
      if (!res.ok) return
      setPendingAnchorRequests(prev => prev.filter(p => p.id !== invId))
    } catch {}
  }

  const typeLabel = program?.financing_types?.length
    ? program.financing_types.map(t => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(', ')
    : '—'

  if (loading) {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push('/programs')}
          crumbs={[{ label: 'My Programs', onClick: () => router.push('/programs') }, { label: '…' }]}
          actions={<NotifBell />}
        />
        <div className="page">
          <div className="page-header">
            <div style={{ height: 28, width: 220, background: 'var(--border)', borderRadius: 6 }} />
            <div style={{ height: 16, width: 180, background: 'var(--border)', borderRadius: 4, marginTop: 8 }} />
          </div>
        </div>
      </PortalShell>
    )
  }

  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push('/programs')}
        crumbs={[
          { label: 'My Programs', onClick: () => router.push('/programs') },
          { label: program?.name ?? 'Program' },
        ]}
        actions={
          <>
            {portal === 'bank' && program && (
              isIFOnly
                ? <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                    <Icon name="plus" size={14} /> Invite Supplier
                  </button>
                : <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('anchor')}>
                    <Icon name="plus" size={14} /> Invite Anchor
                  </button>
            )}
            {portal === 'anchor' && (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                <Icon name="plus" size={14} /> Invite Supplier
              </button>
            )}
            <NotifBell />
          </>
        }
      />

      <div className="page">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{error}</div>
          </div>
        )}

        {program && (
          <>
            <div className="page-header">
              <h1 className="t-page-title">
                {program.name}
                <span style={{ marginLeft: 10 }}>
                  <span className={`badge ${statusBadge(program.status)}`}>
                    {program.status.charAt(0).toUpperCase() + program.status.slice(1)}
                  </span>
                </span>
              </h1>
              <div className="subtitle">{typeLabel} · Created {fmtDate(program.created_at)}</div>
            </div>

            {/* ── BANK: Full program details ── */}
            {portal === 'bank' && (
              <>
                {editSuccess && (
                  <div className="alert alert-success" style={{ marginBottom: 16 }}>
                    <div className="alert-body">Program updated successfully.</div>
                  </div>
                )}

                <div className="card" style={{ marginBottom: 24 }}>
                  <div className="card-head">
                    <h3 className="t-card-head">Program details</h3>
                    {!editing && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {program.status === 'draft' && (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              onClick={handleActivate}
                              disabled={activating}>
                              {activating ? 'Activating…' : 'Activate'}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              onClick={handleDelete}
                              disabled={deleting}
                              style={{ color: '#DC2626' }}>
                              {deleting ? 'Deleting…' : 'Delete program'}
                            </button>
                          </>
                        )}
                        <button className="btn btn-ghost btn-sm" type="button" onClick={startEdit}>Edit</button>
                      </div>
                    )}
                  </div>
                  {editing ? (
                    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {editError && <div style={{ color: '#DC2626', fontSize: 13 }}>{editError}</div>}
                      <div>
                        <label className="form-label">Program name</label>
                        <input className="form-input" value={editName} onChange={e => setEditName(e.target.value)} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label className="form-label">Program limit ($)</label>
                          <input className="form-input" value={editLimit} onChange={e => setEditLimit(e.target.value)} placeholder="e.g. 5000000" />
                        </div>
                        <div>
                          <label className="form-label">Per-supplier sublimit ($)</label>
                          <input className="form-input" value={editSubLimit} onChange={e => setEditSubLimit(e.target.value)} placeholder="e.g. 500000" />
                        </div>
                        <div>
                          <label className="form-label">Min deal size ($)</label>
                          <input className="form-input" value={editMinDeal} onChange={e => setEditMinDeal(e.target.value)} placeholder="e.g. 10000" />
                        </div>
                        <div>
                          <label className="form-label">Max deal size ($)</label>
                          <input className="form-input" value={editMaxDeal} onChange={e => setEditMaxDeal(e.target.value)} placeholder="e.g. 1000000" />
                        </div>
                        <div>
                          <label className="form-label">Status</label>
                          <select className="form-input" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button className="btn btn-primary btn-sm" type="button" disabled={editSaving} onClick={handleSaveEdit}>
                          {editSaving ? 'Saving…' : 'Save changes'}
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="kv-rows">
                      <div className="kv-row"><span className="k">Financing type</span><span className="v plain">{typeLabel}</span></div>
                      {/* <div className="kv-row"><span className="k">Currency</span><span className="v plain">{program.currency ?? 'USD'}</span></div> */}
                      {program.min_deal_size != null && (
                        <div className="kv-row"><span className="k">Min deal size</span><span className="v plain">{fmtMoney(program.min_deal_size)}</span></div>
                      )}
                      {program.max_deal_size != null && (
                        <div className="kv-row"><span className="k">Max deal size</span><span className="v plain">{fmtMoney(program.max_deal_size)}</span></div>
                      )}
                      {program.program_limit != null && (
                        <div className="kv-row"><span className="k">Program limit</span><span className="v plain">{fmtMoney(program.program_limit)}</span></div>
                      )}
                      {program.per_supplier_sublimit != null && (
                        <div className="kv-row"><span className="k">Per-supplier sublimit</span><span className="v plain">{fmtMoney(program.per_supplier_sublimit)}</span></div>
                      )}
                      <div className="kv-row"><span className="k">Created</span><span className="v plain">{fmtDate(program.created_at)}</span></div>
                    </div>
                  )}
                </div>

                {analytics && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-head">
                      <h3 className="t-card-head">Program analytics</h3>
                      <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                    </div>
                    <div className="card-body">
                      <div className="kpi-strip" style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Total Transactions</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.total_transactions}</div>
                        </div>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)', borderRight: '1px solid var(--border)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(analytics.total_invoice_amount)}</div>
                        </div>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--offwhite)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 4, fontWeight: 500 }}>Avg Rate</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{analytics.avg_financing_rate ? analytics.avg_financing_rate.toFixed(1) + '%' : '—'}</div>
                        </div>
                      </div>
                      <LineChart data={analytics.monthly_volume ?? []} height={220} color="#2563EB" />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── ANCHOR / SUPPLIER: Simplified program card ── */}
            {portal !== 'bank' && (
              <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-head"><h3 className="t-card-head">Program details</h3></div>
                <div className="kv-rows">
                  <div className="kv-row"><span className="k">Offered By</span><span className="v plain">{program.name}</span></div>
                  <div className="kv-row"><span className="k">Started on</span><span className="v plain">{fmtDate(program.created_at)}</span></div>
                  <div className="kv-row"><span className="k">Type</span><span className="v plain">{typeLabel}</span></div>
                  <div className="kv-row">
                    <span className="k">Status</span>
                    <span className="v">
                      <span className={`badge ${statusBadge(program.status)}`}>
                        {program.status.charAt(0).toUpperCase() + program.status.slice(1)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── BANK + IF: Suppliers ── */}
            {portal === 'bank' && isIFOnly && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>Suppliers</div>
                {suppliers.length === 0 && pendingSuppliers.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>No suppliers enrolled yet.</div>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                        <Icon name="plus" size={14} /> Invite a supplier
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {cancelError && (
                      <div className="alert alert-error" style={{ marginBottom: 12 }}>
                        <Icon name="error" size={16} className="alert-icon" />
                        <div className="alert-body">{cancelError}</div>
                      </div>
                    )}
                    {suppliers.map(s => (
                      <NetworkCard
                        key={s.id}
                        name={s.legal_name}
                        kybStatus={s.kyb_status}
                        riskTier={s.risk_tier}
                        riskFlags={s.risk_flags}
                        countryOfOrigin={s.country_of_origin}
                        stats={[
                          { label: 'Transactions', value: s.transaction_count },
                          { label: 'KYB Status',   value: kybLabel(s.kyb_status) },
                          { label: 'Joined',       value: s.enrolled_at ? fmtDate(s.enrolled_at) : '—' },
                        ]}
                        onClick={() => router.push(`/programs/${id}/supplier/${s.id}`)}
                      />
                    ))}
                    {pendingSuppliers.map(inv => {
                      const emailInitials = inv.email.slice(0, 2).toUpperCase()
                      return (
                        <div
                          key={inv.id}
                          className="network-card"
                          style={{ cursor: 'default', marginBottom: 12, opacity: 0.75 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div className="avatar">{emailInitials}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {inv.email}
                              </div>
                              <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="badge badge-pending">Invited</span>
                                <span style={{ fontSize: 11, color: 'var(--gray)' }}>Invitation sent {fmtDate(inv.invited_at)}</span>
                              </div>
                            </div>
                            <button className="btn btn-ghost btn-sm" type="button" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }} onClick={() => cancelInvite(inv.id, 'supplier')}>
                              Cancel
                            </button>
                          </div>
                          <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
                            {['Transactions', 'KYB Status'].map(label => (
                              <div key={label}>
                                <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                                <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}

            {/* ── BANK: Anchor & Supplier Network ── */}
            {portal === 'bank' && !isIFOnly && (
              <>
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>Anchor &amp; Supplier Network</div>
                {anchors.length === 0 && pendingAnchors.length === 0 && kybAnchors.length === 0 && signedUpAnchors.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>No anchors enrolled yet.</div>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('anchor')}>
                        <Icon name="plus" size={14} /> Invite an anchor
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {cancelError && (
                      <div className="alert alert-error" style={{ marginBottom: 12 }}>
                        <Icon name="error" size={16} className="alert-icon" />
                        <div className="alert-body">{cancelError}</div>
                      </div>
                    )}
                    {anchors.map(anchor => (
                      <NetworkCard
                        key={anchor.id}
                        name={anchor.legal_name}
                        kybStatus={anchor.kyb_status}
                        suppliers={anchor.suppliers}
                        riskTier={(anchor as any).risk_tier}
                        riskFlags={(anchor as any).risk_flags}
                        countryOfOrigin={(anchor as any).country_of_origin}
                        stats={[
                          { label: 'Suppliers',    value: anchor.supplier_count },
                          { label: 'Transactions', value: anchor.transaction_count },
                          { label: 'KYB Pending',  value: anchor.pending_kyb_count, red: anchor.pending_kyb_count > 0 },
                          { label: 'Joined',       value: anchor.enrolled_at ? fmtDate(anchor.enrolled_at) : '—' },
                        ]}
                        onClick={() => router.push(`/programs/${id}/anchor/${anchor.id}`)}
                      />
                    ))}
                    {kybAnchors.map(org => (
                      <div
                        key={org.id}
                        className="network-card"
                        style={{ cursor: 'pointer', marginBottom: 12 }}
                        onClick={() => router.push(`/programs/${id}/anchor/${org.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div className="avatar">{initials(org.legal_name)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="network-name">{org.legal_name}</div>
                            <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`badge ${kybBadge(org.kyb_status)}`}>{kybLabel(org.kyb_status)}</span>
                              <span style={{ fontSize: 11, color: 'var(--gray)' }}>Review KYB →</span>
                            </div>
                          </div>
                        </div>
                        <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                          {['Suppliers', 'Transactions', 'KYB Pending'].map(label => (
                            <div key={label}>
                              <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                              <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {kybSuppliers.map(org => (
                      <div
                        key={org.id}
                        className="network-card"
                        style={{ cursor: 'pointer', marginBottom: 12 }}
                        onClick={() => router.push(org.anchor_org_id ? `/programs/${id}/anchor/${org.anchor_org_id}/supplier/${org.id}` : `/kyb/${org.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div className="avatar">{initials(org.legal_name)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="network-name">{org.legal_name}</div>
                            <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`badge ${kybBadge(org.kyb_status)}`}>{kybLabel(org.kyb_status)}</span>
                              <span style={{ fontSize: 11, color: 'var(--gray)' }}>Supplier · Review KYB →</span>
                            </div>
                          </div>
                        </div>
                        <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
                          {['Transactions', 'KYB Status'].map(label => (
                            <div key={label}>
                              <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                              <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>
                                {label === 'KYB Status' ? kybLabel(org.kyb_status) : '—'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {pendingAnchors.map(inv => {
                      const emailInitials = inv.email.slice(0, 2).toUpperCase()
                      return (
                        <div
                          key={inv.id}
                          className="network-card"
                          style={{ cursor: 'default', marginBottom: 12, opacity: 0.75 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div className="avatar">{emailInitials}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {inv.email}
                              </div>
                              <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="badge badge-pending">Invited</span>
                                <span style={{ fontSize: 11, color: 'var(--gray)' }}>Invitation sent {fmtDate(inv.invited_at)}</span>
                              </div>
                            </div>
                            <button className="btn btn-ghost btn-sm" type="button" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }} onClick={() => cancelInvite(inv.id, 'anchor')}>
                              Cancel
                            </button>
                          </div>
                          <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                            {['Suppliers', 'Transactions', 'KYB Pending'].map(label => (
                              <div key={label}>
                                <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                                <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {signedUpAnchors.map(su => (
                      <div
                        key={su.email}
                        className="network-card"
                        style={{ cursor: 'default', marginBottom: 12, opacity: 0.75 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div className="avatar">{su.email.slice(0, 2).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{su.email}</div>
                            <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="badge badge-draft">Setting up</span>
                              <span style={{ fontSize: 11, color: 'var(--gray)' }}>Completing onboarding</span>
                            </div>
                          </div>
                        </div>
                        <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                          {['Suppliers', 'Transactions', 'KYB Pending'].map(label => (
                            <div key={label}>
                              <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                              <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {pendingAnchorRequests.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="card-head">
                    <span>Pending Supplier Invite Requests</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, color: 'var(--amber)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}>
                      {pendingAnchorRequests.length} from anchor
                    </span>
                  </div>
                  {pendingAnchorRequests.map((inv: PendingAnchorRequest) => (
                    <div key={inv.id} style={{
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 13, color: 'var(--ink)',
                        }}>{inv.invitee_name ? `${inv.invitee_name} (${inv.email})` : inv.email}</div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10, color: 'var(--gray)',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}>
                          Requested by anchor
                        </div>
                        {inv.prefilled_kyb && Object.values(inv.prefilled_kyb).some(Boolean) && (
                          <div style={{
                            marginTop: 8,
                            padding: '8px 12px',
                            background: 'var(--offwhite)',
                            border: '1px solid var(--border)',
                          }}>
                            <div style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 9, letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: 'var(--blue)', marginBottom: 6,
                            }}>Pre-filled details from anchor</div>
                            {Object.entries(inv.prefilled_kyb)
                              .filter(([, v]) => v)
                              .slice(0, 4)
                              .map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 2 }}>
                                <span style={{
                                  color: 'var(--gray)',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 10,
                                  textTransform: 'uppercase',
                                  minWidth: 100,
                                }}>{k.replace(/_/g, ' ')}</span>
                                <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-body)' }}>{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          type="button"
                          onClick={() => handleApproveAnchorInvite(inv.id, 'standard')}>
                          Approve (Standard)
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => handleApproveAnchorInvite(inv.id, 'custom_kyb')}>
                          Custom KYB
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          style={{ color: 'var(--color-red, #DC2626)' }}
                          onClick={() => handleDeclineAnchorInvite(inv.id)}>
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </>
            )}

            {/* ── ANCHOR: My Suppliers ── */}
            {portal === 'anchor' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div className="section-title">My Suppliers</div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowBulkInvite(true)}>
                    ↑ CSV Import
                  </button>
                </div>
                {suppliers.length === 0 && pendingSuppliers.length === 0 && kybSuppliers.length === 0 && signedUpSuppliers.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>No suppliers yet.</div>
                      {user?.org_id && (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                          <Icon name="plus" size={14} /> Invite a supplier
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {cancelError && (
                      <div className="alert alert-error" style={{ marginBottom: 12 }}>
                        <Icon name="error" size={16} className="alert-icon" />
                        <div className="alert-body">{cancelError}</div>
                      </div>
                    )}
                    {suppliers.map(s => (
                      <NetworkCard
                        key={s.id}
                        name={s.legal_name}
                        kybStatus={s.kyb_status}
                        riskTier={s.risk_tier}
                        riskFlags={s.risk_flags}
                        countryOfOrigin={s.country_of_origin}
                        stats={[
                          { label: 'Transactions',  value: s.transaction_count },
                          { label: 'Latest status', value: s.latest_transaction_status ? s.latest_transaction_status.replace(/_/g, ' ') : '—' },
                          { label: 'Joined',        value: s.enrolled_at ? fmtDate(s.enrolled_at) : '—' },
                        ]}
                        onClick={() => router.push(`/programs/${id}/anchor/${user?.org_id}/supplier/${s.id}`)}
                      />
                    ))}
                    {pendingSuppliers.map(inv => {
                      const emailInitials = inv.email.slice(0, 2).toUpperCase()
                      return (
                        <div
                          key={inv.id}
                          className="network-card"
                          style={{ cursor: 'default', marginBottom: 12, opacity: 0.75 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div className="avatar">{emailInitials}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {inv.email}
                              </div>
                              <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {inv.status === 'pending_bank_review' ? (
                                  <span className="badge badge-draft">Awaiting bank review</span>
                                ) : (
                                  <span className="badge badge-pending">Invited</span>
                                )}
                                <span style={{ fontSize: 11, color: 'var(--gray)' }}>
                                  {inv.status === 'pending_bank_review'
                                    ? `Submitted ${fmtDate(inv.invited_at)}`
                                    : `Invitation sent ${fmtDate(inv.invited_at)}`}
                                </span>
                              </div>
                            </div>
                            {inv.status !== 'pending_bank_review' && (
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                                onClick={() => cancelInvite(inv.id, 'supplier')}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                          <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
                            {['Transactions', 'Latest status'].map(label => (
                              <div key={label}>
                                <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                                <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {kybSuppliers.map(org => {
                      const isApproved = org.kyb_status === 'approved'
                      return (
                        <div
                          key={org.id}
                          className="network-card"
                          style={{ cursor: isApproved ? 'pointer' : 'default', marginBottom: 12, opacity: isApproved ? 1 : 0.85 }}
                          onClick={isApproved ? () => router.push(`/programs/${id}/anchor/${user?.org_id}/supplier/${org.id}`) : undefined}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div className="avatar">{initials(org.legal_name)}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="network-name">{org.legal_name}</div>
                              <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {isApproved && <span className="verified-dot" />}
                                <span className={`badge ${kybBadge(org.kyb_status)}`}>{kybLabel(org.kyb_status)}</span>
                                <span style={{ fontSize: 11, color: 'var(--gray)' }}>
                                  {isApproved ? 'View supplier →' : 'Awaiting KYB approval'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
                            {['Transactions', 'Latest status'].map(label => (
                              <div key={label}>
                                <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                                <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {signedUpSuppliers.map(su => (
                      <div
                        key={su.email}
                        className="network-card"
                        style={{ cursor: 'default', marginBottom: 12, opacity: 0.75 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div className="avatar">{su.email.slice(0, 2).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{su.email}</div>
                            <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="badge badge-draft">Setting up</span>
                              <span style={{ fontSize: 11, color: 'var(--gray)' }}>Completing onboarding</span>
                            </div>
                          </div>
                        </div>
                        <div className="network-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
                          {['Transactions', 'Latest status'].map(label => (
                            <div key={label}>
                              <div className="network-stat-label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>{label}</div>
                              <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--gray)' }}>—</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ── SUPPLIER + IF: Anchor cards ── */}
            {portal === 'supplier' && isIFOnly && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>My Anchor</div>
                {anchorList.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
                      No anchor relationships yet.
                    </div>
                  </div>
                ) : (
                  anchorList.map(a => (
                    <NetworkCard
                      key={a.id}
                      name={a.legal_name}
                      kybStatus={a.kyb_status}
                      riskTier={a.risk_tier}
                      riskFlags={a.risk_flags}
                      countryOfOrigin={a.country_of_origin}
                      stats={[
                        { label: 'Transactions', value: a.transaction_count },
                        { label: 'KYB Status',   value: kybLabel(a.kyb_status) },
                      ]}
                      onClick={() => router.push(`/programs/${id}/anchor/${a.id}`)}
                    />
                  ))
                )}
              </div>
            )}

            {/* ── SUPPLIER: My Anchor ── */}
            {portal === 'supplier' && !isIFOnly && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>My Anchor</div>
                {anchorList.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
                      No anchor connected yet.
                    </div>
                  </div>
                ) : (
                  anchorList.map(a => (
                    <NetworkCard
                      key={a.id}
                      name={a.legal_name}
                      kybStatus={a.kyb_status}
                      riskTier={a.risk_tier}
                      riskFlags={a.risk_flags}
                      countryOfOrigin={a.country_of_origin}
                      stats={[
                        { label: 'Transactions',        value: a.transaction_count },
                        { label: 'Outstanding balance', value: a.outstanding_balance > 0 ? fmtMoney(a.outstanding_balance) : '—' },
                      ]}
                      onClick={() => router.push(`/programs/${id}/anchor/${a.id}`)}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      <BulkInviteModal
        isOpen={showBulkInvite}
        onClose={() => {
          setShowBulkInvite(false)
          load()
        }}
        programId={id}
        anchorOrgId={user?.org_id ?? ''}
      />

      {/* ── Invite modal ── */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowInviteModal(false)}
        >
          <div
            className="card"
            style={{ width: 480, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-head">
              <h3 className="t-card-head">Invite {inviteRole === 'anchor' ? 'Anchor' : 'Supplier'}</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowInviteModal(false)}>✕</button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 200 }}>
              {inviteSent ? (
                <div style={{ fontSize: 14, color: 'var(--color-green)', textAlign: 'center', padding: '12px 0' }}>
                  Invitation sent!
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '1px',
                    background: 'var(--border)',
                    marginBottom: 20,
                  }}>
                    {([
                      { id: 'standard'           as const, label: 'Standard',    desc: 'Counterparty completes\nfull onboarding' },
                      { id: 'known_counterparty' as const, label: 'Known Party', desc: 'Pre-fill their details,\nskip re-onboarding' },
                      { id: 'custom_kyb'         as const, label: 'Custom KYB',  desc: 'Specify exactly what\ndocs you require' },
                    ]).map(m => (
                      <button
                        key={m.id}
                        onClick={() => setInviteMode(m.id)}
                        style={{
                          background: inviteMode === m.id ? 'rgba(20,40,204,0.05)' : 'var(--white)',
                          border: 'none',
                          padding: '14px 12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          borderBottom: inviteMode === m.id ? '2px solid var(--blue)' : '2px solid transparent',
                        }}
                      >
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: inviteMode === m.id ? 'var(--blue)' : 'var(--gray)',
                          marginBottom: 4,
                        }}>{m.label}</div>
                        <div style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 12,
                          color: 'var(--gray)',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-line',
                        }}>{m.desc}</div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="field-label">Contact name</label>
                    <input className="input" placeholder="Jane Smith" value={inviteName} onChange={e => setInviteName(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label">Work email</label>
                    <input className="input" type="email" placeholder="jane@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                  </div>
                  {inviteMode === 'known_counterparty' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                        Pre-fill their organization details
                      </div>
                      <input className="input" placeholder="Legal name" value={prefilledKyb.legal_name ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, legal_name: e.target.value }))} />
                      <input className="input" placeholder="EIN / Tax ID" value={prefilledKyb.ein ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, ein: e.target.value }))} />
                      <select className="input" value={prefilledKyb.entity_type ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, entity_type: e.target.value }))}>
                        <option value="">Entity type</option>
                        <option value="LLC">LLC</option>
                        <option value="Corporation">Corporation</option>
                        <option value="Partnership">Partnership</option>
                        <option value="Sole Proprietor">Sole Proprietor</option>
                      </select>
                      <input className="input" placeholder="State of incorporation" value={prefilledKyb.state_of_incorporation ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, state_of_incorporation: e.target.value }))} />
                      <input className="input" placeholder="Address line 1" value={prefilledKyb.address_line_1 ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, address_line_1: e.target.value }))} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8 }}>
                        <input className="input" placeholder="City" value={prefilledKyb.city ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, city: e.target.value }))} />
                        <input className="input" placeholder="State" value={prefilledKyb.state ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, state: e.target.value }))} />
                        <input className="input" placeholder="ZIP" value={prefilledKyb.zip ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, zip: e.target.value }))} />
                      </div>
                      <input className="input" placeholder="Industry NAICS" value={prefilledKyb.industry_naics ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, industry_naics: e.target.value }))} />
                      <select className="input" value={prefilledKyb.annual_revenue_range ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, annual_revenue_range: e.target.value }))}>
                        <option value="">Annual revenue range</option>
                        <option value="<$1M">&lt;$1M</option>
                        <option value="$1M-$5M">$1M–$5M</option>
                        <option value="$5M-$10M">$5M–$10M</option>
                        <option value="$10M-$50M">$10M–$50M</option>
                        <option value="$50M-$100M">$50M–$100M</option>
                        <option value="$100M+">$100M+</option>
                      </select>
                      <input className="input" placeholder="Primary contact phone" value={prefilledKyb.primary_contact_phone ?? ''} onChange={e => setPrefilledKyb(p => ({ ...p, primary_contact_phone: e.target.value }))} />
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        color: 'var(--gray)',
                        padding: '10px 14px',
                        background: 'var(--offwhite)',
                        border: '1px solid var(--border)',
                      }}>
                        These details will be pre-filled in their onboarding. They will only need to create credentials — no KYB application required.
                      </div>
                    </div>
                  )}
                  {inviteMode === 'custom_kyb' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 4 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>
                        Required documents
                      </div>
                      {AVAILABLE_DOCS.map(doc => (
                        <label key={doc.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 0',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-body)',
                          fontSize: 13,
                          color: 'var(--ink)',
                        }}>
                          <input
                            type="checkbox"
                            checked={requiredDocs.includes(doc.id)}
                            onChange={e => {
                              if (e.target.checked) {
                                setRequiredDocs(prev => [...prev, doc.id])
                              } else {
                                setRequiredDocs(prev => prev.filter(d => d !== doc.id))
                              }
                            }}
                            style={{ accentColor: 'var(--blue)' }}
                          />
                          {doc.label}
                        </label>
                      ))}
                      {requiredDocs.includes('custom_document') && (
                        <input
                          className="input"
                          placeholder="Document name..."
                          value={customDocName}
                          onChange={e => setCustomDocName(e.target.value)}
                          style={{ marginTop: 8 }}
                        />
                      )}
                      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
                        The counterparty will be guided to upload exactly these documents during onboarding.
                      </div>
                    </div>
                  )}
                  {inviteError && <div style={{ color: '#DC2626', fontSize: 13 }}>{inviteError}</div>}
                  <button className="btn btn-primary" type="button" disabled={inviteLoading} onClick={handleSendInvite}>
                    {inviteLoading ? 'Sending…' : 'Send invite'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  )
}
