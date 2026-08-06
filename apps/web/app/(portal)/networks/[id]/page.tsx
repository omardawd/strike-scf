'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { AnchorNetwork } from '@strike-scf/types'
import { useT } from '@/lib/i18n/locale-context'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { MemberCard, type NetworkMemberRow } from '@/components/networks/MemberCard'

function PassportRing({ score }: { score?: number | null }) {
  return <PassportScoreRing score={score} size="sm" />
}

// ── Invite Modal ─────────────────────────────────────────────

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
  const t = useT()
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
      // No `type=supplier` filter — any org can be invited now.
      const res = await fetch(`/api/organizations/search?q=${encodeURIComponent(q)}`)
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
    if (!email.trim()) { setError(t('networksDetail.emailRequired')); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/networks/${networkId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', email: email.trim(), prefill_company_name: company || undefined, prefill_country: country || undefined, notes: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      setSuccess(t('networksDetail.invitationSentTo', { email }))
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
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      setSuccess(t('networksDetail.orgHasBeenInvited', { org: org.legal_name }))
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
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{t('networksDetail.inviteSupplierTo', { network: networkName })}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--gray)' }}>×</button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: 'var(--color-green-bg, #EDFAF4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M4 9.5l3.2 3.2L14 5.5" stroke="var(--color-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p style={{ fontWeight: 600, fontSize: 15 }}>{success}</p>
            <button onClick={onClose} style={{
              marginTop: 20, padding: '10px 24px', background: 'var(--blue)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius-button)',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>{t('networksDetail.done')}</button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1.5px solid var(--border)', marginBottom: 20 }}>
              {(['email', 'existing'] as const).map(tabKey => (
                <button key={tabKey} onClick={() => setTab(tabKey)} style={{
                  padding: '8px 16px', background: 'none', border: 'none',
                  borderBottom: tab === tabKey ? '2.5px solid var(--blue)' : '2.5px solid transparent',
                  color: tab === tabKey ? 'var(--blue)' : 'var(--gray)',
                  fontWeight: tab === tabKey ? 700 : 500, fontSize: 14, cursor: 'pointer',
                  marginBottom: -1.5,
                }}>
                  {tabKey === 'email' ? t('networksDetail.inviteByEmail') : t('networksDetail.addExistingOrg')}
                </button>
              ))}
            </div>

            {error && <p style={{ color: 'var(--color-red)', fontSize: 13, marginBottom: 14 }}>{error}</p>}

            {tab === 'email' && (
              <form onSubmit={handleEmailInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networksDetail.emailStar')}</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="contact@company.com"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networksDetail.companyNameOptional')}</label>
                  <input value={company} onChange={e => setCompany(e.target.value)} placeholder={t('networksDetail.prefillSignup')}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networksDetail.countryOptional')}</label>
                  <input value={country} onChange={e => setCountry(e.target.value)} placeholder={t('networksDetail.countryPlaceholder')}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networksDetail.personalNoteOptional')}</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t('networksDetail.shownInEmail')}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
                <button type="submit" disabled={loading} style={{
                  padding: '11px 0', background: 'var(--blue)', color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-button)', fontWeight: 600, fontSize: 14, cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}>
                  {loading ? t('networksDetail.sending') : t('networksDetail.sendInvitation')}
                </button>
              </form>
            )}

            {tab === 'existing' && (
              <div>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('networksDetail.searchByOrgName')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, marginBottom: 14, boxSizing: 'border-box' }} />
                {searching && <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--gray)', fontSize: 13 }}>{t('networksDetail.searching')}</div>}
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
                          {org.country ?? ''} · {org.kyb_status.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PassportRing score={org.passport_score} />
                        {confirm?.id === org.id ? (
                          <button onClick={() => handleOrgInvite(org)} disabled={loading} style={{
                            padding: '7px 14px', background: 'var(--blue)', color: '#fff',
                            border: 'none', borderRadius: 'var(--radius-button)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}>
                            {loading ? '…' : t('networksDetail.confirm')}
                          </button>
                        ) : (
                          <button onClick={() => setConfirm(org)} style={{
                            padding: '7px 14px', background: 'none', color: 'var(--blue)',
                            border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-button)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}>
                            {t('networksDetail.addBtn')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!searching && search.length > 0 && results.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: '20px 0' }}>
                      {t('networksDetail.noOrgsFound')}
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

// ── Analytics section ────────────────────────────────────────

interface NetworkAnalytics {
  active_members: number
  active_listings: number
  active_listings_value: number
  deal_count: number
  deal_volume: number
  spend_by_month: { label: string; amount: number }[]
  top_counterparties: { org_id: string; name: string; deal_count: number; deal_volume: number }[]
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function NetworkAnalyticsSection({ networkId }: { networkId: string }) {
  const t = useT()
  const router = useRouter()
  const [data, setData] = useState<NetworkAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/networks/${networkId}/analytics`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [networkId])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
  }
  if (!data) {
    return <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray)' }}>Analytics unavailable.</div>
  }

  const maxSpend = Math.max(1, ...data.spend_by_month.map(b => b.amount))
  const maxCounterparty = Math.max(1, ...data.top_counterparties.map(c => c.deal_volume))

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>Active members</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.active_members}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>Active listings</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.active_listings}</div>
          <div style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{fmtCurrency(data.active_listings_value)} total</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>Deal volume</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCurrency(data.deal_volume)}</div>
          <div style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{data.deal_count} deal{data.deal_count === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Spend across the network (last 6 months)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110 }}>
            {data.spend_by_month.map(b => (
              <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--gray)' }}>{b.amount > 0 ? fmtCurrency(b.amount) : ''}</div>
                <div style={{
                  width: '100%', maxWidth: 28,
                  height: Math.max(4, (b.amount / maxSpend) * 70),
                  background: 'var(--blue)', borderRadius: 4,
                }} />
                <div style={{ fontSize: 10, color: 'var(--gray-soft)' }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Top counterparties by volume</div>
          {data.top_counterparties.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>No deals between network members yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.top_counterparties.map(c => (
                <div
                  key={c.org_id}
                  onClick={() => router.push(`/passport/${c.org_id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{c.name}</span>
                    <span style={{ fontWeight: 600 }}>{fmtCurrency(c.deal_volume)}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--offwhite)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(c.deal_volume / maxCounterparty) * 100}%`, background: 'var(--blue)', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Listings snippet ──────────────────────────────────────────

interface NetworkListingRow {
  id: string
  title: string
  listing_type: string
  target_price: number | null
  currency: string | null
  poster_name: string | null
  created_at: string
}

function NetworkListingsSnippet({ networkId, isOwner }: { networkId: string; isOwner: boolean }) {
  const t = useT()
  const router = useRouter()
  const [listings, setListings] = useState<NetworkListingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/networks/${networkId}/listings?limit=6`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setListings(d.listings ?? []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [networkId])

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('networksDetail.tab.listings')}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href={`/marketplace?network_id=${networkId}`} style={{
            background: 'none', color: 'var(--blue)', textDecoration: 'none',
            border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-button)', padding: '8px 16px',
            fontSize: 13, fontWeight: 600,
          }}>
            View in Strike Place →
          </a>
          {isOwner && (
            <a href={`/marketplace/listings/new?network_id=${networkId}&visibility=network_only`} style={{
              background: 'var(--blue)', color: '#fff', textDecoration: 'none',
              borderRadius: 'var(--radius-button)', padding: '8px 16px',
              fontSize: 13, fontWeight: 600,
            }}>
              {t('networksDetail.postNewListing')}
            </a>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
      ) : listings.length === 0 ? (
        <div className="card" style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>
          No listings on this network yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {listings.map(l => (
            <div
              key={l.id}
              className="card card-interactive"
              style={{ padding: 16, cursor: 'pointer' }}
              onClick={() => router.push(`/marketplace/listings/${l.id}`)}
            >
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{l.title}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 8 }}>
                {l.listing_type === 'po_request' ? 'PO Request' : 'Product / Service'} · {l.poster_name ?? 'Unknown'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>
                {l.target_price != null ? `${l.currency ?? 'USD'} ${l.target_price.toLocaleString()}` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Network Detail Page ──────────────────────────────────────

export default function NetworkDetailPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [network, setNetwork]   = useState<AnchorNetwork | null>(null)
  const [isOwner, setIsOwner]   = useState(false)
  const [members, setMembers]   = useState<NetworkMemberRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [actionError, setAE]    = useState('')
  const [joiningRoom, setJoiningRoom] = useState(false)

  const loadNetwork = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [netRes, memRes] = await Promise.all([
        fetch(`/api/networks/${id}`),
        fetch(`/api/networks/${id}/members`),
      ])
      if (netRes.status === 404 || netRes.status === 403) {
        setNotFound(true)
        return
      }
      const netData = await netRes.json()
      const memData = await memRes.json()
      if (netData.network) {
        setNetwork(netData.network)
        setIsOwner(!!netData.is_owner)
      }
      setMembers(memData.members ?? [])
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadNetwork() }, [loadNetwork])

  async function handleRemoveMember(orgId: string) {
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}/members/${orgId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
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
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      loadNetwork()
    } catch (err: any) {
      setAE(err.message)
    }
  }

  async function handleOpenRoom() {
    setJoiningRoom(true)
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}/room`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      router.push(`/rooms/${data.room_id}`)
    } catch (err: any) {
      setAE(err.message)
      setJoiningRoom(false)
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
  }

  if (notFound || !network) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>{t('networksDetail.notFound')}</div>
  }

  return (
    <>
      <div style={{ padding: '32px 32px 24px' }} data-page-name="Network Detail" data-ai-context={JSON.stringify({ is_owner: isOwner, network_name: network.name, network_id: network.id, member_count: members.length })}>
        <button onClick={() => router.push('/networks')} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
        }}>
          ← {t('networksDetail.backToNetworks')}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{network.name}</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={handleOpenRoom} disabled={joiningRoom} style={{
              background: 'none', color: 'var(--blue)', border: '1.5px solid var(--blue)',
              borderRadius: 'var(--radius-button)', padding: '10px 18px',
              fontSize: 14, fontWeight: 600, cursor: joiningRoom ? 'default' : 'pointer',
              opacity: joiningRoom ? 0.6 : 1,
            }}>
              {joiningRoom ? '…' : 'Network Room'}
            </button>
            {isOwner && (
              <button onClick={() => setShowInvite(true)} style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-button)', padding: '10px 20px',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                {t('networksDetail.inviteSupplierPlus')}
              </button>
            )}
            {isOwner && (
              <button
                onClick={() => router.push(`/networks/${id}/settings`)}
                title={t('networksDetail.tab.settings')}
                aria-label={t('networksDetail.tab.settings')}
                style={{
                  background: 'none', color: 'var(--gray)', border: '1.5px solid var(--border)',
                  borderRadius: 'var(--radius-button)', width: 40, height: 40,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M16.2 12.4a1.4 1.4 0 00.28 1.54l.05.05a1.7 1.7 0 11-2.4 2.4l-.05-.05a1.4 1.4 0 00-1.54-.28 1.4 1.4 0 00-.85 1.28v.14a1.7 1.7 0 01-3.4 0v-.08a1.4 1.4 0 00-.91-1.28 1.4 1.4 0 00-1.54.28l-.05.05a1.7 1.7 0 11-2.4-2.4l.05-.05a1.4 1.4 0 00.28-1.54 1.4 1.4 0 00-1.28-.85h-.14a1.7 1.7 0 010-3.4h.08a1.4 1.4 0 001.28-.91 1.4 1.4 0 00-.28-1.54l-.05-.05a1.7 1.7 0 112.4-2.4l.05.05a1.4 1.4 0 001.54.28h.06a1.4 1.4 0 00.85-1.28v-.14a1.7 1.7 0 013.4 0v.08a1.4 1.4 0 00.85 1.28h.06a1.4 1.4 0 001.54-.28l.05-.05a1.7 1.7 0 112.4 2.4l-.05.05a1.4 1.4 0 00-.28 1.54v.06a1.4 1.4 0 001.28.85h.14a1.7 1.7 0 010 3.4h-.08a1.4 1.4 0 00-1.28.85z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {network.description && (
          <p style={{ color: 'var(--gray)', fontSize: 14 }}>{network.description}</p>
        )}
      </div>

      <div style={{ padding: '0 32px 40px' }}>
        {actionError && (
          <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#dc2626' }}>
            {actionError}
          </div>
        )}

        <NetworkAnalyticsSection networkId={id} />

        <NetworkListingsSnippet networkId={id} isOwner={isOwner} />

        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
            {t('networksDetail.tab.members')} ({members.length})
          </h2>
          {members.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray)', fontSize: 14 }}>
              {t('networksDetail.noMembersYet')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {members.map(m => (
                <MemberCard
                  key={m.id}
                  member={m}
                  isOwner={isOwner}
                  onSuspend={orgId => handleUpdateMemberStatus(orgId, 'suspended')}
                  onReactivate={orgId => handleUpdateMemberStatus(orgId, 'active')}
                  onRemove={handleRemoveMember}
                />
              ))}
            </div>
          )}
        </div>
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
