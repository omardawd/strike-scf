'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import type { AnchorNetwork } from '@strike-scf/types'

// ── Anchor Networks List ─────────────────────────────────────

function CreateNetworkModal({ onClose, onCreated }: { onClose: () => void; onCreated: (n: AnchorNetwork) => void }) {
  const [name, setName]       = useState('')
  const [desc, setDesc]       = useState('')
  const [vis, setVis]         = useState<'public' | 'network_only'>('public')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Network name is required'); return }
    if (name.trim().length > 60) { setError('Name must be 60 characters or fewer'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: desc || undefined, visibility_default: vis }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      onCreated(data.network)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
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
        padding: 32, width: '100%', maxWidth: 460,
        boxShadow: 'var(--shadow-elevated)',
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Create Network</h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>
              Network Name <span style={{ color: 'var(--color-red)' }}>*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Preferred Suppliers"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)',
                border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 4, textAlign: 'right' }}>{name.length}/60</div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>
              Description
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Optional description"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)',
                border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 4, textAlign: 'right' }}>{desc.length}/200</div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 10, color: 'var(--ink-soft)' }}>
              Default Visibility
            </label>
            {(['public', 'network_only'] as const).map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
                <input type="radio" name="visibility" checked={vis === v} onChange={() => setVis(v)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{v === 'public' ? 'Public' : 'Network Only'}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                    {v === 'public' ? 'Listings are visible to all verified orgs by default' : 'Listings are private to network members by default'}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {error && <p style={{ color: 'var(--color-red)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: 'var(--radius-button)',
              border: '1.5px solid var(--border)', background: 'none',
              fontSize: 14, cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={{
              padding: '10px 24px', borderRadius: 'var(--radius-button)',
              background: 'var(--blue)', color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Creating…' : 'Create Network'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VisibilityBadge({ v }: { v: string }) {
  const isPrivate = v === 'network_only'
  return (
    <span style={{
      display: 'inline-block', borderRadius: 'var(--radius-badge)',
      padding: '3px 10px', fontSize: 11, fontWeight: 600,
      background: isPrivate ? 'var(--color-amber)' + '22' : 'var(--color-green)' + '22',
      color: isPrivate ? 'var(--color-amber)' : 'var(--color-green)',
      border: `1px solid ${isPrivate ? 'var(--color-amber)' : 'var(--color-green)'}33`,
    }}>
      {isPrivate ? 'Private default' : 'Public default'}
    </span>
  )
}

function AnchorNetworksPage() {
  const router = useRouter()
  const [networks, setNetworks] = useState<AnchorNetwork[]>([])
  const [loading, setLoading]   = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/networks')
      const data = await res.json()
      setNetworks(data.networks ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ padding: '32px 32px 0' }} data-page-name="Networks" data-ai-context={JSON.stringify({ role: 'anchor', total_networks: networks.length, loading })}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>My Networks</h1>
          <button onClick={() => setShowCreate(true)} style={{
            background: 'var(--blue)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-button)', padding: '10px 20px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            + Create Network
          </button>
        </div>
        <p style={{ color: 'var(--gray)', fontSize: 14, marginBottom: 32 }}>
          Create private supplier groups, control listing visibility, and invite suppliers.
        </p>
      </div>

      <div style={{ padding: '0 32px 40px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray)' }}>Loading networks…</div>
        ) : networks.length === 0 ? (
          <div style={{
            border: '2px dashed var(--border)', borderRadius: 'var(--radius-card)',
            padding: '64px 32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🌐</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>No networks yet</h3>
            <p style={{ color: 'var(--gray)', fontSize: 14, maxWidth: 360, margin: '0 auto 24px' }}>
              You haven't created any supplier networks yet. Create one to invite suppliers and post private listings.
            </p>
            <button onClick={() => setShowCreate(true)} style={{
              background: 'var(--blue)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-button)', padding: '10px 24px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              Create your first network
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {networks.map(net => (
              <div key={net.id} style={{
                background: 'var(--white)', borderRadius: 'var(--radius-card)',
                padding: 20, boxShadow: 'var(--shadow-card)', cursor: 'pointer',
                border: '1.5px solid var(--border)',
                transition: 'box-shadow 0.15s',
              }} onClick={() => router.push(`/networks/${net.id}`)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{net.name}</div>
                  <VisibilityBadge v={net.visibility_default} />
                </div>
                {net.description && (
                  <p style={{
                    fontSize: 13, color: 'var(--gray)', marginBottom: 16,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {net.description}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <strong>{net.member_count}</strong> <span style={{ color: 'var(--gray)' }}>Active</span>
                  </span>
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 600 }}>Manage →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateNetworkModal
          onClose={() => setShowCreate(false)}
          onCreated={net => { setNetworks(prev => [net, ...prev]); setShowCreate(false) }}
        />
      )}
    </>
  )
}

// ── Supplier Networks Page ────────────────────────────────────

function SupplierNetworksPage() {
  const [data, setData]         = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [actionLoading, setAL]  = useState<string | null>(null)
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/networks/supplier')
      const json = await res.json()
      setData(json.networks ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAccept(networkId: string) {
    setAL(networkId + '-accept')
    setError('')
    try {
      const res = await fetch(`/api/networks/${networkId}/accept`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAL(null)
    }
  }

  async function handleDecline(networkId: string) {
    setAL(networkId + '-decline')
    setError('')
    try {
      const res = await fetch(`/api/networks/${networkId}/decline`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAL(null)
    }
  }

  const pending = data.filter(d => d.membership?.status === 'invited')
  const active  = data.filter(d => d.membership?.status === 'active')
  const others  = data.filter(d => !['invited', 'active'].includes(d.membership?.status))

  return (
    <div style={{ padding: '32px' }} data-page-name="Networks" data-ai-context={JSON.stringify({ role: 'supplier', total: data.length, pending: pending.length, active: active.length, others: others.length })}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>My Networks</h1>
        <p style={{ color: 'var(--gray)', fontSize: 14 }}>
          Networks are created by buyers. You'll receive an invitation when a buyer adds you.
        </p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-card)', padding: '12px 16px', marginBottom: 20, fontSize: 14, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray)' }}>Loading…</div>
      ) : data.length === 0 ? (
        <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-card)', padding: '64px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>No network invitations yet</h3>
          <p style={{ color: 'var(--gray)', fontSize: 14, maxWidth: 360, margin: '0 auto' }}>
            You haven't joined any supplier networks yet. Networks are created by buyers — you'll receive an invitation when a buyer adds you.
          </p>
        </div>
      ) : (
        <>
          {/* Pending invitations */}
          {pending.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{
                background: '#fffbeb', border: '1.5px solid var(--color-amber)',
                borderRadius: 'var(--radius-card)', padding: '12px 16px', marginBottom: 16,
                fontSize: 14, fontWeight: 600, color: '#92400e',
              }}>
                📬 You have {pending.length} pending network invitation{pending.length > 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pending.map(({ membership, network, anchor }) => (
                  <div key={membership.id} style={{
                    background: 'var(--white)', borderRadius: 'var(--radius-card)',
                    border: '1.5px solid var(--color-amber)33',
                    padding: 20, boxShadow: 'var(--shadow-card)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                      <div>
                        <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 4 }}>
                          {anchor?.legal_name ?? 'A buyer'} has invited you to join their network
                        </p>
                        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>"{network?.name}"</h3>
                        {network?.description && (
                          <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 8 }}>{network.description}</p>
                        )}
                        {anchor?.country && (
                          <span style={{ fontSize: 12, color: 'var(--gray)' }}>{anchor.country}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                        <button
                          onClick={() => handleDecline(network?.id)}
                          disabled={!!actionLoading}
                          style={{
                            padding: '9px 18px', borderRadius: 'var(--radius-button)',
                            border: '1.5px solid var(--border)', background: 'none',
                            fontSize: 14, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => handleAccept(network?.id)}
                          disabled={actionLoading === network?.id + '-accept'}
                          style={{
                            padding: '9px 18px', borderRadius: 'var(--radius-button)',
                            background: 'var(--blue)', color: '#fff', border: 'none',
                            fontSize: 14, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          {actionLoading === network?.id + '-accept' ? 'Accepting…' : 'Accept'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active networks */}
          {active.length > 0 && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Active Networks</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {active.map(({ membership, network, anchor, pending_listings_count }) => (
                  <div key={membership.id} style={{
                    background: 'var(--white)', borderRadius: 'var(--radius-card)',
                    border: '1.5px solid var(--border)', padding: 20, boxShadow: 'var(--shadow-card)',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{network?.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>
                      {anchor?.legal_name} · {anchor?.country ?? ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                        {pending_listings_count} listing{pending_listings_count !== 1 ? 's' : ''} available
                      </span>
                      <a
                        href={`/marketplace?network_id=${network?.id}`}
                        style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}
                      >
                        View Listings →
                      </a>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 8 }}>
                      Member since {membership.joined_at ? new Date(membership.joined_at).toLocaleDateString() : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray)', marginBottom: 10 }}>Other</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {others.map(({ membership, network, anchor }) => (
                  <div key={membership.id} style={{
                    background: 'var(--offwhite)', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)', padding: '14px 16px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{network?.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 8 }}>· {anchor?.legal_name}</span>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, borderRadius: 'var(--radius-badge)',
                      padding: '3px 10px', background: 'var(--border)', color: 'var(--gray)',
                    }}>
                      {membership.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Route entry ─────────────────────────────────────────────

export default function NetworksPage() {
  const portal = usePortal()

  if (portal === 'anchor') return <AnchorNetworksPage />
  return <SupplierNetworksPage />
}
