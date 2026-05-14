'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
import { pushKybDetail } from '@/lib/kyb-referrer'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'

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
  industry_naics?: string | null
  primary_contact_name?: string | null
  primary_contact_email?: string | null
  credit_reviewed_at?: string | null
  kyb_submitted_at?: string | null
}

interface KYBDoc {
  id: string
  file_name: string
  created_at: string
  signed_url: string | null
}

interface CreditScore {
  id: string
  total_score: number | null
  risk_tier: string | null
  created_at: string
}

interface SupplierEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
}

interface PendingSupplierInv {
  id: string
  email: string
  anchor_org_id: string
  status: 'invited'
  invited_at: string
  type: 'invitation'
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
  supplier_count?: number
  avg_financing_rate: number
  monthly_volume: Array<{ label: string; count: number; value: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function kybBadge(s: string) {
  const m: Record<string, string> = {
    approved: 'badge-funded', submitted: 'badge-pending', under_review: 'badge-pending',
    more_info_requested: 'badge-pending', rejected: 'badge-rejected', draft: 'badge-draft',
    not_started: 'badge-draft', in_progress: 'badge-pending',
  }
  return m[s] ?? 'badge-draft'
}

function kybLabel(s: string) {
  const m: Record<string, string> = {
    approved: 'Approved', submitted: 'Submitted', under_review: 'Under Review',
    more_info_requested: 'Info Requested', rejected: 'Rejected', draft: 'Draft',
    not_started: 'Not started', in_progress: 'In progress',
  }
  return m[s] ?? s
}

function riskTierBadge(t: string | null | undefined) {
  if (!t) return 'badge-draft'
  const m: Record<string, string> = { A: 'badge-funded', B: 'badge-active', C: 'badge-pending', D: 'badge-rejected' }
  return m[t] ?? 'badge-draft'
}

function txnBadge(s: string) {
  if (s === 'completed') return 'badge-funded'
  if (s === 'funded' || s === 'financing_approved') return 'badge-active'
  if (s === 'rejected') return 'badge-rejected'
  return 'badge-pending'
}

const STATUS_LABELS: Record<string, string> = {
  pending_anchor_approval: 'Pending Anchor',
  pending_bank_review:     'Pending Bank',
  more_info_requested:     'More Info',
  financing_approved:      'Approved',
  funded:                  'Funded',
  completed:               'Completed',
  rejected:                'Rejected',
}

function initials(name: string) {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
type Period = 'daily' | 'weekly' | 'monthly'

function PeriodToggle({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--color-bg-2)', borderRadius: 6, padding: 2 }}>
      {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            padding: '3px 10px', borderRadius: 4, border: 'none', fontSize: 10.5,
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            background: value === p ? 'var(--color-card)' : 'transparent',
            color: value === p ? 'var(--color-ink-1)' : 'var(--color-ink-4)',
            boxShadow: value === p ? '0 1px 2px var(--color-shadow)' : 'none',
          }}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  const first = points[0]!
  let d = `M ${first[0]} ${first[1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`
  }
  return d
}

function LineChart({ items, height = 88, color = 'var(--color-accent)' }: {
  items: Array<{ label: string; value: number; count?: number }>
  height?: number
  color?: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const safe = items ?? []
  const hasData = safe.some(d => d.value > 0)

  if (!hasData) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-4)', fontSize: 12 }}>
        No data yet
      </div>
    )
  }

  const W = 560, H = height - 24
  const PAD = { top: 8, right: 8, left: 4 }
  const maxVal = Math.max(...safe.map(d => d.value), 1)

  const pts: [number, number][] = safe.map((d, i) => [
    PAD.left + (safe.length > 1 ? (i / (safe.length - 1)) : 0.5) * (W - PAD.left - PAD.right),
    PAD.top + (1 - d.value / maxVal) * (H - PAD.top),
  ])

  const linePath = smoothPath(pts)
  const lastPt = pts[pts.length - 1]!
  const firstPt = pts[0]!
  const areaPath = pts.length > 1 ? `${linePath} L ${lastPt[0]} ${H} L ${firstPt[0]} ${H} Z` : ''

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}>
        {areaPath && <path d={areaPath} fill={color} fillOpacity={0.07} />}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((pt, i) => safe[i]!.value > 0 && (
          <circle key={i} cx={pt[0]} cy={pt[1]} r={hovered === i ? 4.5 : 3}
            fill={hovered === i ? color : 'var(--color-card)'} stroke={color} strokeWidth={2}
            style={{ cursor: 'default' }}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: `3px ${PAD.right}px 0 ${PAD.left}px` }}>
        {safe.map((d, i) => (
          <div key={i} style={{ fontSize: 10, color: hovered === i ? color : 'var(--color-ink-4)', textAlign: 'center', flex: 1 }}>
            {d.label}
          </div>
        ))}
      </div>
      {hovered !== null && safe[hovered] && (
        <div style={{
          position: 'absolute',
          top: Math.max(0, (pts[hovered]![1] / H) * (height - 24) - 32),
          left: `clamp(0px, calc(${(pts[hovered]![0] / W * 100).toFixed(1)}% - 44px), calc(100% - 88px))`,
          background: 'var(--color-ink-1)', color: 'white',
          padding: '3px 7px', borderRadius: 5, fontSize: 11, fontWeight: 500,
          whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
        }}>
          {fmtMoney(safe[hovered]!.value)}
        </div>
      )}
    </div>
  )
}

// ── KYB section ───────────────────────────────────────────────────────────────
function KybSection({
  status,
  creditScore,
  creditReviewedAt,
  orgId,
  orgType,
  router,
}: {
  status: string | undefined
  creditScore: CreditScore | null
  creditReviewedAt: string | null | undefined
  orgId: string
  orgType: 'Anchor' | 'Supplier'
  router: ReturnType<typeof useRouter>
}) {
  const s = status ?? 'draft'
  const isSubmitted = s === 'submitted' || s === 'under_review'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {isSubmitted && <span className="badge badge-active">Ready for review</span>}
        {s === 'approved' && <span className="badge badge-funded">Approved</span>}
        {s === 'rejected' && <span className="badge badge-rejected">Rejected</span>}
        {s === 'more_info_requested' && <span className="badge badge-pending">More info requested</span>}
        {s === 'in_progress' && <span className="badge badge-pending">Application in progress</span>}
        {(s === 'not_started' || s === 'draft') && <span className="badge badge-draft">Not started</span>}
        {!['submitted', 'under_review', 'approved', 'rejected', 'more_info_requested', 'in_progress', 'not_started', 'draft'].includes(s) && (
          <span className={`badge ${kybBadge(s)}`}>{kybLabel(s)}</span>
        )}
        {s === 'approved' && creditScore?.risk_tier && (
          <span className={`badge ${riskTierBadge(creditScore.risk_tier)}`}>Risk {creditScore.risk_tier}</span>
        )}
        {creditReviewedAt && s === 'approved' && (
          <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>Reviewed {fmtDate(creditReviewedAt)}</span>
        )}
      </div>
      {(s === 'not_started' || s === 'draft') && (
        <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>KYB not submitted yet.</div>
      )}
      {s === 'approved' && creditScore?.total_score != null && (
        <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink-1)', lineHeight: 1 }}>
          {creditScore.total_score}
        </div>
      )}
      {s === 'rejected' && (
        <div style={{ fontSize: 13, color: 'var(--color-red)' }}>
          KYB rejected. {orgType} cannot participate in financing.
        </div>
      )}
      {s === 'more_info_requested' && (
        <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
          Additional information requested from {orgType.toLowerCase()}.
        </div>
      )}
      <div>
        <button
          className={isSubmitted ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          type="button"
          onClick={() => pushKybDetail(router, orgId)}
        >
          {isSubmitted ? 'Review KYB application' : 'View KYB record'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AnchorDetailPage() {
  const portal    = usePortal()
  const user      = useUser()
  const router    = useRouter()
  const params    = useParams()
  const programId = params.id as string
  const anchorId  = params.anchor_id as string

  const [org, setOrg]                           = useState<OrgDetail | null>(null)
  const [suppliers, setSuppliers]               = useState<SupplierEntry[]>([])
  const [pendingSuppliers, setPendingSuppliers] = useState<PendingSupplierInv[]>([])
  const [docs, setDocs]                         = useState<KYBDoc[]>([])
  const [creditScore, setCreditScore]           = useState<CreditScore | null>(null)
  const [analytics, setAnalytics]               = useState<AnalyticsData | null>(null)
  const [loading, setLoading]                   = useState(true)
  const [error, setError]                       = useState<string | null>(null)
  const [transactions, setTransactions]         = useState<TxRow[]>([])
  const [networkVersion, setNetworkVersion]     = useState(0)
  const [volPeriod, setVolPeriod]               = useState<Period>('monthly')

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteName, setInviteName]           = useState('')
  const [inviteEmail, setInviteEmail]         = useState('')
  const [inviteLoading, setInviteLoading]     = useState(false)
  const [inviteError, setInviteError]         = useState<string | null>(null)
  const [inviteSent, setInviteSent]           = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      if (portal === 'bank') {
        const [netRes, kybRes, txRes, analyticsRes] = await Promise.all([
          fetch(`/api/programs/${programId}/network`),
          fetch(`/api/kyb/${anchorId}`),
          fetch('/api/transactions'),
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&period=${volPeriod}`),
        ])

        const netData = netRes.ok ? await netRes.json() : {}
        const anchorEntry = (netData.anchors ?? []).find((a: AnchorDetailEntry) => a.id === anchorId)
        setSuppliers(anchorEntry?.suppliers ?? [])
        setPendingSuppliers(
          (netData.pending_suppliers ?? []).filter(
            (s: PendingSupplierInv) => s.anchor_org_id === anchorId
          )
        )

        if (kybRes.ok) {
          const kybData = await kybRes.json()
          setOrg(kybData.organization ?? null)
          setDocs(kybData.documents ?? [])
          setCreditScore(kybData.credit_score ?? null)
        } else if (anchorEntry) {
          setOrg({ id: anchorEntry.id, legal_name: anchorEntry.legal_name, kyb_status: anchorEntry.kyb_status, status: anchorEntry.status })
        }

        if (txRes.ok) {
          const txData = await txRes.json()
          const all: TxRow[] = txData.transactions ?? txData.data ?? []
          setTransactions(all.filter(t => t.anchor_id === anchorId && t.program_id === programId))
        }

        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json())
        }
      } else {
        const [netRes, txRes, analyticsRes, kybRes] = await Promise.all([
          fetch(`/api/programs/${programId}/network`),
          fetch('/api/transactions'),
          fetch(`/api/programs/${programId}/analytics?anchor_id=${anchorId}&period=${volPeriod}`),
          fetch(`/api/kyb/${anchorId}`),
        ])

        if (kybRes.ok) {
          const kybData = await kybRes.json()
          setOrg(kybData.organization ?? null)
        } else {
          const netData = netRes.ok ? await netRes.json() : {}
          const anchorEntry = (netData.anchors ?? []).find((a: { id: string }) => a.id === anchorId)
          if (anchorEntry) {
            setOrg({ id: anchorEntry.id, legal_name: anchorEntry.legal_name, kyb_status: anchorEntry.kyb_status, status: anchorEntry.status })
          }
        }

        if (txRes.ok) {
          const txData = await txRes.json()
          const all: TxRow[] = txData.transactions ?? txData.data ?? []
          setTransactions(all.filter(t => t.anchor_id === anchorId && t.program_id === programId))
        }

        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json())
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [portal, programId, anchorId, networkVersion, volPeriod])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (org?.legal_name) {
      try { sessionStorage.setItem('breadcrumb_anchor', org.legal_name) } catch {}
    }
  }, [org?.legal_name])

  async function handleSendInvite() {
    if (!inviteEmail.includes('@')) { setInviteError('Enter a valid email'); return }
    setInviteLoading(true); setInviteError(null)
    try {
      const res = await fetch(`/api/programs/${programId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), role: 'supplier', anchor_org_id: anchorId }),
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

  function openInviteModal() {
    setInviteName(''); setInviteEmail(''); setInviteError(null); setInviteSent(false)
    setShowInviteModal(true)
  }

  async function cancelInvite(invId: string) {
    await fetch(`/api/programs/${programId}/invite`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitation_id: invId, action: 'cancel' }),
    })
    setNetworkVersion(v => v + 1)
  }

  const orgName = org?.legal_name ?? 'Anchor'

  if (loading) {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}`)}
          crumbs={[
            { label: 'My Programs', onClick: () => router.push('/programs') },
            { label: '…', onClick: () => router.push(`/programs/${programId}`) },
            { label: '…' },
          ]}
          actions={<NotifBell />}
        />
        <div className="page">
          <div className="page-header">
            <div style={{ height: 28, width: 200, background: 'var(--color-border)', borderRadius: 6 }} />
          </div>
        </div>
      </PortalShell>
    )
  }

  // ── BANK VIEW ───────────────────────────────────────────────────────────────
  if (portal === 'bank') {
    return (
      <PortalShell activeSection="programs">
        <Topbar
          onBack={() => router.push(`/programs/${programId}`)}
          crumbs={[
            { label: 'My Programs', onClick: () => router.push('/programs') },
            { label: 'Program', onClick: () => router.push(`/programs/${programId}`) },
            { label: orgName },
          ]}
          actions={
            <>
              <button className="btn btn-primary btn-sm" type="button" onClick={openInviteModal}>
                <Icon name="plus" size={14} /> Invite Supplier
              </button>
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

          <div className="page-header">
            <h1 className="t-page-title">{orgName}</h1>
            <div className="subtitle">Anchor · Program network</div>
          </div>

          <div className="split-60">
            {/* ── LEFT: Org details + analytics + suppliers ── */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">Organization</h3></div>
                <div className="kv-rows">
                  <div className="kv-row"><span className="k">Legal name</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                  {org?.business_type && (
                    <div className="kv-row"><span className="k">Industry</span><span className="v plain">{org.business_type}</span></div>
                  )}
                  {org?.ein && (
                    <div className="kv-row"><span className="k">EIN</span><span className="v mono">{org.ein}</span></div>
                  )}
                  {(org?.city || org?.state) && (
                    <div className="kv-row">
                      <span className="k">Location</span>
                      <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  
                  {org?.annual_revenue_range != null && (
                    <div className="kv-row"><span className="k">Annual revenue</span><span className="v plain">{fmtMoney(org.annual_revenue_range)}</span></div>
                  )}
                  {org?.industry_naics && (
                    <div className="kv-row"><span className="k">NAICS</span><span className="v mono">{org.industry_naics}</span></div>
                  )}
                  {org?.primary_contact_name && (
                    <div className="kv-row"><span className="k">Contact</span><span className="v plain">{org.primary_contact_name}</span></div>
                  )}
                  {org?.primary_contact_email && (
                    <div className="kv-row"><span className="k">Email</span><span className="v plain">{org.primary_contact_email}</span></div>
                  )}
                  {org?.kyb_submitted_at && (
                    <div className="kv-row"><span className="k">KYB submitted</span><span className="v plain">{fmtDate(org.kyb_submitted_at)}</span></div>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h3 className="t-card-head">Program Analytics</h3>
                  <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Transactions</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics?.total_transactions ?? 0}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_invoice_amount) : '—'}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Total Financed</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_financed) : '—'}</div>
                    </div>
                    <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Avg Rate</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics?.avg_financing_rate ? `${analytics.avg_financing_rate.toFixed(1)}%` : '—'}</div>
                    </div>
                  </div>
                  <LineChart items={analytics?.monthly_volume ?? []} color="var(--color-accent)" />
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">Suppliers in this program</h3>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={openInviteModal}>
                    <Icon name="plus" size={14} /> Invite
                  </button>
                </div>
                {suppliers.length === 0 && pendingSuppliers.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                    No suppliers yet.
                  </div>
                ) : (
                  <div className="card-body" style={{ padding: 0 }}>
                    {suppliers.map(s => (
                      <div
                        key={s.id}
                        className="network-card"
                        style={{ cursor: 'pointer', margin: '0 0 2px' }}
                        onClick={() => router.push(`/programs/${programId}/anchor/${anchorId}/supplier/${s.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div className="avatar">{initials(s.legal_name)}</div>
                          <div style={{ flex: 1 }}>
                            <div className="network-name">{s.legal_name}</div>
                            <div className="network-meta">
                              {s.kyb_status === 'approved' && <span className="verified-dot" />}
                              <span className={`badge ${kybBadge(s.kyb_status)}`}>{kybLabel(s.kyb_status)}</span>
                            </div>
                          </div>
                          <span style={{ color: 'var(--color-ink-4)', fontSize: 16 }}>›</span>
                        </div>
                      </div>
                    ))}
                    {pendingSuppliers.map(inv => (
                      <div
                        key={inv.id}
                        className="network-card"
                        style={{ cursor: 'default', margin: '0 0 2px', opacity: 0.75 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div className="avatar">{inv.email.slice(0, 2).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="network-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {inv.email}
                            </div>
                            <div className="network-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="badge badge-pending">Invited</span>
                              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>{fmtDate(inv.invited_at)}</span>
                            </div>
                          </div>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={e => { e.stopPropagation(); cancelInvite(inv.id) }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: KYB + Documents ── */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3 className="t-card-head">KYB Status</h3></div>
                <div className="card-body">
                  <KybSection
                    status={org?.kyb_status}
                    creditScore={creditScore}
                    creditReviewedAt={org?.credit_reviewed_at}
                    orgId={anchorId}
                    orgType="Anchor"
                    router={router}
                  />
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
                {docs.length === 0 ? (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                    No documents uploaded.
                  </div>
                ) : (
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {docs.map(doc => (
                      <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.file_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-ink-4)' }}>{fmtDate(doc.created_at)}</div>
                        </div>
                        {doc.signed_url && (
                          <a href={doc.signed_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                            Download
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Transactions table below split */}
          {/* <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h3 className="t-card-head">Transactions</h3>
            </div>
            {transactions.length === 0 ? (
              <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                No transactions yet.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pushTransactionDetail(router, t.id)}>
                      <td style={{ fontSize: 13 }}>{t.invoice_number ?? t.id.slice(0, 8) + '…'}</td>
                      <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                        {t.financing_amount_approved != null
                          ? fmtCurrency(t.financing_amount_approved)
                          : t.invoice_amount != null
                            ? fmtCurrency(t.invoice_amount)
                            : '—'}
                      </td>
                      <td>
                        <span className={`badge ${txnBadge(t.status)}`}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{fmtDate(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div> */}
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
                <h3 className="t-card-head">Invite Supplier</h3>
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
                        placeholder="supplier@company.com"
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

  // ── SUPPLIER VIEW ───────────────────────────────────────────────────────────
  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push(`/programs/${programId}`)}
        crumbs={[
          { label: 'My Programs', onClick: () => router.push('/programs') },
          { label: 'Program', onClick: () => router.push(`/programs/${programId}`) },
          { label: orgName },
        ]}
        actions={<NotifBell />}
      />
      <div className="page">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{error}</div>
          </div>
        )}

        <div className="page-header">
          <h1 className="t-page-title">{orgName}</h1>
          <div className="subtitle">Your anchor</div>
        </div>

        <div className="split-65">
          {/* ── LEFT: Anchor info + analytics + transactions ── */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">Anchor Info</h3></div>
              <div className="kv-rows">
                <div className="kv-row"><span className="k">Legal name</span><span className="v plain">{org?.legal_name ?? '—'}</span></div>
                {(org?.city || org?.state) && (
                  <div className="kv-row">
                    <span className="k">Location</span>
                    <span className="v plain">{[org.city, org.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {org?.business_type && (
                  <div className="kv-row"><span className="k">Industry</span><span className="v plain">{org.business_type}</span></div>
                )}
                {org?.ein && (
                  <div className="kv-row"><span className="k">EIN</span><span className="v mono">{org.ein}</span></div>
                )}
                {org?.annual_revenue_range != null && (
                  <div className="kv-row"><span className="k">Annual revenue</span><span className="v plain">{fmtMoney(org.annual_revenue_range)}</span></div>
                )}
                {org?.industry_naics && (
                  <div className="kv-row"><span className="k">NAICS</span><span className="v mono">{org.industry_naics}</span></div>
                )}
                {org?.primary_contact_name && (
                  <div className="kv-row"><span className="k">Primary contact</span><span className="v plain">{org.primary_contact_name}</span></div>
                )}
                {org?.primary_contact_email && (
                  <div className="kv-row"><span className="k">Contact email</span><span className="v plain">{org.primary_contact_email}</span></div>
                )}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3 className="t-card-head">Analytics</h3>
                <PeriodToggle value={volPeriod} onChange={setVolPeriod} />
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Transactions</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics?.total_transactions ?? 0}</div>
                  </div>
                  <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Invoice Volume</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_invoice_amount) : '—'}</div>
                  </div>
                  <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-card)' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-4)', marginBottom: 4, fontWeight: 500 }}>Total Financed</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink-1)', fontVariantNumeric: 'tabular-nums' }}>{analytics ? fmtMoney(analytics.total_financed) : '—'}</div>
                  </div>
                </div>
                <LineChart items={analytics?.monthly_volume ?? []} color="var(--color-accent)" />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Transactions</h3>
                <button className="btn btn-primary btn-sm" type="button" onClick={() => pushTransactionNew(router)}>
                  <Icon name="plus" size={14} /> New
                </button>
              </div>
              {transactions.length === 0 ? (
                <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                  No transactions yet with this anchor.
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => pushTransactionDetail(router, t.id)}>
                        <td style={{ fontSize: 13 }}>{t.invoice_number ?? t.id.slice(0, 8) + '…'}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {t.financing_amount_approved != null
                            ? fmtCurrency(t.financing_amount_approved)
                            : t.invoice_amount != null
                              ? fmtCurrency(t.invoice_amount)
                              : '—'}
                        </td>
                        <td>
                          <span className={`badge ${txnBadge(t.status)}`}>{STATUS_LABELS[t.status] ?? t.status}</span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{fmtDate(t.created_at)}</td>
                        <td style={{ color: 'var(--color-ink-4)', fontSize: 16, textAlign: 'right' }}>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── RIGHT: Program details + documents ── */}
          <div>
            {/* <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3 className="t-card-head">Program</h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                  You are enrolled in this program as a supplier under {orgName}.
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => router.push(`/programs/${programId}`)}
                >
                  View program details →
                </button>
              </div>
            </div> */}

            <div className="card">
              <div className="card-head"><h3 className="t-card-head">Documents</h3></div>
              <div className="card-body" style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                No documents shared by anchor.
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}

// local type for bank network data shape
interface AnchorDetailEntry {
  id: string
  legal_name: string
  kyb_status: string
  status: string
  suppliers: SupplierEntry[]
}
