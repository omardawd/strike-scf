'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import type { AnchorNetwork, AnchorNetworkMember } from '@strike-scf/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    active:    { bg: '#edfaf4', text: '#10B981' },
    invited:   { bg: '#fffbeb', text: '#F59E0B' },
    suspended: { bg: '#fee2e2', text: '#EF4444' },
    declined:  { bg: '#f3f4f6', text: '#6B7280' },
    removed:   { bg: '#f3f4f6', text: '#9CA3AF' },
  }
  const c = colors[status] ?? { bg: '#f3f4f6', text: '#6B7280' }
  return (
    <span style={{
      display: 'inline-block', borderRadius: 'var(--radius-badge)',
      padding: '3px 10px', fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.text,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function PassportRing({ score }: { score?: number | null }) {
  const s = score ?? 0
  const color = s >= 70 ? '#10B981' : s >= 45 ? '#F59E0B' : '#EF4444'
  const c = 2 * Math.PI * 14
  return (
    <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
      <svg width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={c - (s / 100) * c}
          strokeLinecap="round" transform="rotate(-90 18 18)"
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: 'var(--ink)',
      }}>
        {score != null ? score : '—'}
      </div>
    </div>
  )
}

// ── Invite Supplier Modal ────────────────────────────────────

function InviteModal({
  networkId,
  networkName,
  onClose,
  onInvited,
}: {
  networkId: string
  networkName: string
  onClose: () => void
  onInvited: () => void
}) {
  const [tab, setTab]         = useState<'email' | 'existing'>('email')
  const [email, setEmail]     = useState('')
  const [company, setCompany] = useState('')
  const [country, setCountry] = useState('')
  const [note, setNote]       = useState('')
  const [search, setSearch]   = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [confirm, setConfirm] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError]     = useState('')

  async function searchOrgs(q: string) {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/organizations/search?q=${encodeURIComponent(q)}&type=supplier`)
      const data = await res.json()
      setResults(data.organizations ?? [])
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => searchOrgs(search), 300)
    return () => clearTimeout(t)
  }, [search])

  async function handleEmailInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Email is required'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/networks/${networkId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', email: email.trim(), prefill_company_name: company || undefined, prefill_country: country || undefined, notes: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setSuccess(`Invitation sent to ${email}`)
      onInvited()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOrgInvite(org: any) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/networks/${networkId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'existing_org', org_id: org.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setSuccess(`${org.legal_name} has been invited`)
      setConfirm(null)
      onInvited()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--white)', borderRadius: 'var(--radius-card)',
        padding: 28, width: '100%', maxWidth: 480,
        boxShadow: 'var(--shadow-elevated)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>Invite Supplier to "{networkName}"</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--gray)' }}>×</button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600, fontSize: 15 }}>{success}</p>
            <button onClick={onClose} style={{
              marginTop: 20, padding: '10px 24px', background: 'var(--blue)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius-button)',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>Done</button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1.5px solid var(--border)', marginBottom: 20 }}>
              {(['email', 'existing'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '8px 16px', background: 'none', border: 'none',
                  borderBottom: tab === t ? '2.5px solid var(--blue)' : '2.5px solid transparent',
                  color: tab === t ? 'var(--blue)' : 'var(--gray)',
                  fontWeight: tab === t ? 700 : 500, fontSize: 14, cursor: 'pointer',
                  marginBottom: -1.5,
                }}>
                  {t === 'email' ? 'Invite by Email' : 'Add Existing Org'}
                </button>
              ))}
            </div>

            {error && <p style={{ color: 'var(--color-red)', fontSize: 13, marginBottom: 14 }}>{error}</p>}

            {tab === 'email' && (
              <form onSubmit={handleEmailInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Email *</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="supplier@company.com"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Company name (optional)</label>
                  <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Pre-fill for signup form"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Country (optional)</label>
                  <input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. United States"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Personal note (optional)</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Shown in invitation email"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
                <button type="submit" disabled={loading} style={{
                  padding: '11px 0', background: 'var(--blue)', color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-button)', fontWeight: 600, fontSize: 14, cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}>
                  {loading ? 'Sending…' : 'Send Invitation'}
                </button>
              </form>
            )}

            {tab === 'existing' && (
              <div>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by organization name…"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, marginBottom: 14, boxSizing: 'border-box' }} />
                {searching && <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--gray)', fontSize: 13 }}>Searching…</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {results.map(org => (
                    <div key={org.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)',
                      cursor: 'pointer', background: 'var(--offwhite)',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{org.legal_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                          {org.country ?? ''} · {org.kyb_status}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PassportRing score={org.passport_score} />
                        {confirm?.id === org.id ? (
                          <button onClick={() => handleOrgInvite(org)} disabled={loading} style={{
                            padding: '7px 14px', background: 'var(--blue)', color: '#fff',
                            border: 'none', borderRadius: 'var(--radius-button)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}>
                            {loading ? '…' : 'Confirm'}
                          </button>
                        ) : (
                          <button onClick={() => setConfirm(org)} style={{
                            padding: '7px 14px', background: 'none', color: 'var(--blue)',
                            border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-button)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}>
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!searching && search.length > 0 && results.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: '20px 0' }}>
                      No organizations found
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Network Detail Page ──────────────────────────────────────

export default function NetworkDetailPage() {
  const portal = usePortal()
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [network, setNetwork]   = useState<AnchorNetwork | null>(null)
  const [members, setMembers]   = useState<(AnchorNetworkMember & { organization: any })[]>([])
  const [tab, setTab]           = useState<'members' | 'listings' | 'settings'>('members')
  const [loading, setLoading]   = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [actionError, setAE]    = useState('')

  // Settings edit
  const [editName, setEditName]   = useState('')
  const [editDesc, setEditDesc]   = useState('')
  const [editVis, setEditVis]     = useState<'public' | 'network_only'>('public')
  const [saving, setSaving]       = useState(false)
  const [saveSuccess, setSS]      = useState(false)

  const loadNetwork = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [netRes, memRes] = await Promise.all([
        fetch('/api/networks'),
        fetch(`/api/networks/${id}/members`),
      ])
      const netData = await netRes.json()
      const memData = await memRes.json()
      const found = (netData.networks ?? []).find((n: AnchorNetwork) => n.id === id)
      if (found) {
        setNetwork(found)
        setEditName(found.name)
        setEditDesc(found.description ?? '')
        setEditVis(found.visibility_default)
      }
      setMembers(memData.members ?? [])
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadNetwork() }, [loadNetwork])

  // Redirect non-anchors
  if (portal !== 'anchor') {
    router.replace('/networks')
    return null
  }

  async function handleRemoveMember(orgId: string) {
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}/members/${orgId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      loadNetwork()
    } catch (err: any) {
      setAE(err.message)
    }
  }

  async function handleUpdateMemberStatus(orgId: string, status: 'active' | 'suspended') {
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}/members/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      loadNetwork()
    } catch (err: any) {
      setAE(err.message)
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSS(false)
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDesc || null, visibility_default: editVis }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setNetwork(data.network)
      setSS(true)
    } catch (err: any) {
      setAE(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteNetwork() {
    if (!window.confirm(`Delete "${network?.name}"? This cannot be undone.`)) return
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      router.push('/networks')
    } catch (err: any) {
      setAE(err.message)
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>Loading…</div>
  }

  if (!network) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>Network not found.</div>
  }

  return (
    <>
      <div style={{ padding: '32px 32px 0' }}>
        <button onClick={() => router.push('/networks')} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
        }}>
          ← Back to Networks
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{network.name}</h1>
          <button onClick={() => setShowInvite(true)} style={{
            background: 'var(--blue)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-button)', padding: '10px 20px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            + Invite Supplier
          </button>
        </div>
        {network.description && (
          <p style={{ color: 'var(--gray)', fontSize: 14, marginBottom: 16 }}>{network.description}</p>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1.5px solid var(--border)', marginTop: 8 }}>
          {(['members', 'listings', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 18px', background: 'none', border: 'none',
              borderBottom: tab === t ? '2.5px solid var(--blue)' : '2.5px solid transparent',
              color: tab === t ? 'var(--blue)' : 'var(--gray)',
              fontWeight: tab === t ? 700 : 500, fontSize: 14, cursor: 'pointer',
              marginBottom: -1.5, textTransform: 'capitalize',
            }}>
              {t}
              {t === 'members' && ` (${members.length})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 32px 40px' }}>
        {actionError && (
          <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#dc2626' }}>
            {actionError}
          </div>
        )}

        {/* Members Tab */}
        {tab === 'members' && (
          <div>
            {members.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray)', fontSize: 14 }}>
                No members yet. Use "Invite Supplier" to add your first member.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid var(--border)', textAlign: 'left' }}>
                      {['Supplier', 'Score', 'KYB', 'Member Since', 'Status', 'Notes', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', fontWeight: 600, fontSize: 12, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m: any) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 12px', fontWeight: 600 }}>{m.organization?.legal_name ?? '—'}</td>
                        <td style={{ padding: '12px 12px' }}>
                          <PassportRing score={m.organization?.passport_score} />
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <StatusBadge status={m.organization?.kyb_status ?? '—'} />
                        </td>
                        <td style={{ padding: '12px 12px', color: 'var(--gray)', fontSize: 13 }}>
                          {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <StatusBadge status={m.status} />
                        </td>
                        <td style={{ padding: '12px 12px', color: 'var(--gray)', fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.buyer_notes ?? '—'}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {m.status === 'active' && (
                              <button onClick={() => handleUpdateMemberStatus(m.supplier_org_id, 'suspended')} style={{
                                padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                                border: '1.5px solid var(--border)', background: 'none', cursor: 'pointer',
                              }}>
                                Suspend
                              </button>
                            )}
                            {m.status === 'suspended' && (
                              <button onClick={() => handleUpdateMemberStatus(m.supplier_org_id, 'active')} style={{
                                padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                                border: '1.5px solid var(--border)', background: 'none', cursor: 'pointer',
                              }}>
                                Reactivate
                              </button>
                            )}
                            <button onClick={() => handleRemoveMember(m.supplier_org_id)} style={{
                              padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                              border: '1.5px solid #fecaca', background: '#fee2e2', color: '#dc2626', cursor: 'pointer',
                            }}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Listings Tab */}
        {tab === 'listings' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <p style={{ color: 'var(--gray)', fontSize: 14 }}>Network-only listings posted to this network.</p>
              <a href={`/marketplace/listings/new?network_id=${id}&visibility=network_only`} style={{
                background: 'var(--blue)', color: '#fff', textDecoration: 'none',
                borderRadius: 'var(--radius-button)', padding: '9px 18px',
                fontSize: 14, fontWeight: 600,
              }}>
                Post New Listing
              </a>
            </div>
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray)', fontSize: 14 }}>
              View and manage listings on{' '}
              <a href={`/marketplace?network_id=${id}`} style={{ color: 'var(--blue)', fontWeight: 600 }}>Strike Place</a>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div style={{ maxWidth: 500 }}>
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Network Settings</h3>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={60}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>Description</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} maxLength={200}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 10, color: 'var(--ink-soft)' }}>Default Visibility</label>
                {(['public', 'network_only'] as const).map(v => (
                  <label key={v} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
                    <input type="radio" name="editVis" checked={editVis === v} onChange={() => setEditVis(v)} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{v === 'public' ? 'Public' : 'Network Only'}</div>
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                        {v === 'public' ? 'New listings default to visible to all' : 'New listings default to network-only'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {saveSuccess && <p style={{ color: 'var(--color-green)', fontSize: 13 }}>Settings saved.</p>}

              <button type="submit" disabled={saving} style={{
                padding: '11px 24px', background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-button)', fontWeight: 600, fontSize: 14, cursor: saving ? 'default' : 'pointer',
                alignSelf: 'flex-start', opacity: saving ? 0.6 : 1,
              }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>

            <hr style={{ border: 'none', borderTop: '1.5px solid var(--border)', marginBottom: 24 }} />

            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>Danger Zone</h3>
              <button
                onClick={handleDeleteNetwork}
                disabled={network.member_count > 0}
                title={network.member_count > 0 ? 'Remove all active members before deleting' : ''}
                style={{
                  padding: '10px 20px', background: network.member_count > 0 ? '#f3f4f6' : '#fee2e2',
                  color: network.member_count > 0 ? '#9ca3af' : '#dc2626',
                  border: '1.5px solid', borderColor: network.member_count > 0 ? 'var(--border)' : '#fecaca',
                  borderRadius: 'var(--radius-button)', fontSize: 14, fontWeight: 600,
                  cursor: network.member_count > 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Delete Network
              </button>
              {network.member_count > 0 && (
                <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>Remove all active members before deleting this network.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal
          networkId={id}
          networkName={network.name}
          onClose={() => setShowInvite(false)}
          onInvited={() => { loadNetwork(); setShowInvite(false) }}
        />
      )}
    </>
  )
}
