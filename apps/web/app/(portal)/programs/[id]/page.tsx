'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, Icon, fmtMoney } from '@/components/portal-shell'

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

interface SupplierEntry { id: string; legal_name: string; kyb_status: string; status: string }

interface AnchorEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
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
  transaction_count: number
  latest_transaction_status: string | null
}

interface AnchorNetEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  transaction_count: number
  outstanding_balance: number
}

interface PendingAnchorInv {
  id: string
  email: string
  status: 'invited'
  invited_at: string
  expires_at: string | null
  type: 'invitation'
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

// ── BarChart ──────────────────────────────────────────────────────────────────
function BarChart({ items }: { items: Array<{ label: string; value: number; count: number }> }) {
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 88 }}>
      {items.map((item, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div
            title={`${item.count} txns`}
            style={{
              width: '100%',
              height: Math.max(Math.round((item.value / max) * 60), item.value > 0 ? 3 : 1),
              background: 'var(--color-accent)',
              borderRadius: '3px 3px 0 0',
              opacity: 0.85,
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--color-ink-4)' }}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── NetworkCard ────────────────────────────────────────────────────────────────
function NetworkCard({
  name,
  kybStatus,
  stats,
  suppliers,
  onClick,
}: {
  name: string
  kybStatus: string
  stats: Array<{ label: string; value: string | number; red?: boolean }>
  suppliers?: SupplierEntry[]
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
        </div>
        {suppliers && suppliers.length > 0 && (
          <div className="supplier-stack">
            {suppliers.slice(0, 3).map((s, i) => (
              <div key={i} className="savatar" title={s.legal_name}>{initials(s.legal_name)}</div>
            ))}
            {suppliers.length > 3 && (
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)', whiteSpace: 'nowrap' }}>
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
              style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}
            >
              {s.label}
            </div>
            <div
              className="network-stat-value"
              style={{ fontSize: 14, fontWeight: 600, color: s.red ? 'var(--color-red)' : 'var(--color-ink-1)' }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [networkVersion, setNetworkVersion] = useState(0)

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteRole, setInviteRole]           = useState<'anchor' | 'supplier'>('anchor')
  const [inviteName, setInviteName]           = useState('')
  const [inviteEmail, setInviteEmail]         = useState('')
  const [inviteLoading, setInviteLoading]     = useState(false)
  const [inviteError, setInviteError]         = useState<string | null>(null)
  const [inviteSent, setInviteSent]           = useState(false)

  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal'

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const fetches: Promise<Response>[] = [
        fetch(`/api/programs/${id}`),
        fetch(`/api/programs/${id}/network`),
      ]
      if (portal === 'bank') fetches.push(fetch(`/api/programs/${id}/analytics`))

      const results = await Promise.all(fetches)
      if (!results[0]!.ok) throw new Error(`HTTP ${results[0]!.status}`)
      const progData = await results[0]!.json()
      setProgram(progData.program)

      if (results[1]!.ok) {
        const netData = await results[1]!.json()
        setAnchors(netData.anchors ?? [])
        setSuppliers(netData.suppliers ?? [])
        setAnchorList(netData.anchors ?? [])
        setPendingAnchors(netData.pending_anchors ?? [])
      }

      if (portal === 'bank' && results[2]?.ok) {
        setAnalytics(await results[2].json())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id, portal])

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
      const body: Record<string, unknown> = { name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole }
      if (inviteRole === 'supplier' && user?.org_id) body.anchor_org_id = user.org_id
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
    setShowInviteModal(true)
  }

  async function cancelAnchorInvite(invId: string) {
    await fetch(`/api/programs/${id}/invite`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitation_id: invId, action: 'cancel' }),
    })
    setNetworkVersion(v => v + 1)
  }

  const typeLabel = program?.financing_types?.length
    ? program.financing_types.map(t => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(', ')
    : '—'

  if (loading) {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push('/programs')}
          crumbs={[{ label: portalLabel }, { label: 'My Programs', onClick: () => router.push('/programs') }, { label: '…' }]}
        />
        <div className="page">
          <div className="page-header">
            <div style={{ height: 28, width: 220, background: 'var(--color-border)', borderRadius: 6 }} />
            <div style={{ height: 16, width: 180, background: 'var(--color-border)', borderRadius: 4, marginTop: 8 }} />
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
          { label: portalLabel },
          { label: 'My Programs', onClick: () => router.push('/programs') },
          { label: program?.name ?? 'Program' },
        ]}
        actions={
          <>
            {portal === 'bank' && program && (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('anchor')}>
                <Icon name="plus" size={14} /> Invite Anchor
              </button>
            )}
            {portal === 'anchor' && (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                <Icon name="plus" size={14} /> Invite Supplier
              </button>
            )}
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
                {/* <div className="card" style={{ marginBottom: 20 }}>
                  <div className="card-head"><h3 className="t-card-head">Program overview</h3></div>
                  <div className="card-body">
                    <div className="kpi-strip">
                      {program.program_limit != null && (
                        <div className="kpi-card">
                          <div className="kpi-label">Program Limit</div>
                          <div className="kpi-value">{fmtMoney(program.program_limit)}</div>
                        </div>
                      )}
                      {program.per_supplier_sublimit != null && (
                        <div className="kpi-card">
                          <div className="kpi-label">Per-Supplier Limit</div>
                          <div className="kpi-value">{fmtMoney(program.per_supplier_sublimit)}</div>
                        </div>
                      )}
                      <div className="kpi-card">
                        <div className="kpi-label">Tenor</div>
                        <div className="kpi-value">{program.standard_tenor_days} days</div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label">Currency</div>
                        <div className="kpi-value">{program.currency ?? 'USD'}</div>
                      </div>
                    </div>
                  </div>
                </div> */}

                <div className="card" style={{ marginBottom: 24 }}>
                  <div className="card-head"><h3 className="t-card-head">Program details</h3></div>
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
                    <div className="kv-row"><span className="k">Standard tenor</span><span className="v plain">{program.standard_tenor_days} days</span></div>
                    <div className="kv-row"><span className="k">Created</span><span className="v plain">{fmtDate(program.created_at)}</span></div>
                  </div>
                </div>

                {analytics && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-head"><h3 className="t-card-head">Program analytics</h3></div>
                    <div className="card-body">
                      <div className="kpi-strip" style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Total Transactions</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics.total_transactions}</div>
                        </div>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(analytics.total_invoice_amount)}</div>
                        </div>
                        <div className="kpi-card" style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)' }}>
                          <div className="kpi-label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Avg Rate</div>
                          <div className="kpi-value" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics.avg_financing_rate ? analytics.avg_financing_rate.toFixed(1) + '%' : '—'}</div>
                        </div>
                      </div>
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
                  <div className="kv-row"><span className="k">Tenor</span><span className="v plain">{program.standard_tenor_days} days</span></div>
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

            {/* ── BANK: Anchor & Supplier Network ── */}
            {portal === 'bank' && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>Anchor &amp; Supplier Network</div>
                {anchors.length === 0 && pendingAnchors.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginBottom: 16 }}>No anchors enrolled yet.</div>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('anchor')}>
                        <Icon name="plus" size={14} /> Invite an anchor
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {anchors.map(anchor => (
                      <NetworkCard
                        key={anchor.id}
                        name={anchor.legal_name}
                        kybStatus={anchor.kyb_status}
                        suppliers={anchor.suppliers}
                        stats={[
                          { label: 'Suppliers',    value: anchor.supplier_count },
                          { label: 'Transactions', value: anchor.transaction_count },
                          { label: 'KYB Pending',  value: anchor.pending_kyb_count, red: anchor.pending_kyb_count > 0 },
                        ]}
                        onClick={() => router.push(`/programs/${id}/anchor/${anchor.id}`)}
                      />
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
                              <div
                                className="network-name"
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {inv.email}
                              </div>
                              <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="badge badge-pending">Invited</span>
                                <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                                  Invitation sent {fmtDate(inv.invited_at)}
                                </span>
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                              onClick={() => cancelAnchorInvite(inv.id)}
                            >
                              Cancel
                            </button>
                          </div>
                          <div
                            className="network-stats"
                            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}
                          >
                            {['Suppliers', 'Transactions', 'KYB Pending'].map(label => (
                              <div key={label}>
                                <div
                                  className="network-stat-label"
                                  style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4)' }}
                                >
                                  {label}
                                </div>
                                <div className="network-stat-value" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>—</div>
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

            {/* ── ANCHOR: My Suppliers ── */}
            {portal === 'anchor' && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>My Suppliers</div>
                {suppliers.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginBottom: 16 }}>No suppliers yet.</div>
                      {user?.org_id && (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => openInviteModal('supplier')}>
                          <Icon name="plus" size={14} /> Invite a supplier
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  suppliers.map(s => (
                    <NetworkCard
                      key={s.id}
                      name={s.legal_name}
                      kybStatus={s.kyb_status}
                      stats={[
                        { label: 'Transactions', value: s.transaction_count },
                        { label: 'Latest status', value: s.latest_transaction_status ? s.latest_transaction_status.replace(/_/g, ' ') : '—' },
                      ]}
                      onClick={() => router.push(`/programs/${id}/anchor/${user?.org_id}/supplier/${s.id}`)}
                    />
                  ))
                )}
              </div>
            )}

            {/* ── SUPPLIER: My Anchor ── */}
            {portal === 'supplier' && (
              <div>
                <div className="section-title" style={{ marginBottom: 12 }}>My Anchor</div>
                {anchorList.length === 0 ? (
                  <div className="card">
                    <div className="card-body" style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--color-ink-3)' }}>
                      No anchor connected yet.
                    </div>
                  </div>
                ) : (
                  anchorList.map(a => (
                    <NetworkCard
                      key={a.id}
                      name={a.legal_name}
                      kybStatus={a.kyb_status}
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
            style={{ width: 400, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-head">
              <h3 className="t-card-head">Invite {inviteRole === 'anchor' ? 'Anchor' : 'Supplier'}</h3>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowInviteModal(false)}>✕</button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {inviteSent ? (
                <div style={{ fontSize: 14, color: 'var(--color-green)', textAlign: 'center', padding: '12px 0' }}>
                  Invitation sent!
                </div>
              ) : (
                <>
                  <div>
                    <label className="form-label">Name <span style={{ color: 'var(--color-ink-4)' }}>(optional)</span></label>
                    <input
                      className="form-input"
                      placeholder="Contact name"
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input
                      className="form-input"
                      type="email"
                      placeholder={`${inviteRole}@company.com`}
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendInvite()}
                    />
                  </div>
                  {inviteError && <div style={{ color: 'var(--color-red)', fontSize: 13 }}>{inviteError}</div>}
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
