'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { AnchorNetwork } from '@strike-scf/types'
import { useT } from '@/lib/i18n/locale-context'

// ── Network Settings Page (owner only) ───────────────────────
// Split out from the network detail page so that page can stay a single
// combined analytics/listings/members view with no tab switching — settings
// is a separate, less-frequently-visited destination reached via a small
// gear button in the detail page's header.

export default function NetworkSettingsPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [network, setNetwork] = useState<AnchorNetwork | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setAE] = useState('')

  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editVis, setEditVis] = useState<'public' | 'network_only'>('public')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSS] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/networks/${id}`)
      if (res.status === 404 || res.status === 403) {
        setNotFound(true)
        return
      }
      const data = await res.json()
      if (data.network) {
        setNetwork(data.network)
        setIsOwner(!!data.is_owner)
        setEditName(data.network.name)
        setEditDesc(data.network.description ?? '')
        setEditVis(data.network.visibility_default)
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

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
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      setNetwork(data.network)
      setSS(true)
    } catch (err: any) {
      setAE(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteNetwork() {
    if (!network || !window.confirm(t('networksDetail.deleteConfirm', { network: network.name }))) return
    setAE('')
    try {
      const res = await fetch(`/api/networks/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('networks.failed'))
      router.push('/networks')
    } catch (err: any) {
      setAE(err.message)
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>{t('common.loading')}</div>
  }

  if (notFound || !network) {
    return <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>{t('networksDetail.notFound')}</div>
  }

  if (!isOwner) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--gray)' }}>
        {t('networksDetail.notFound')}
      </div>
    )
  }

  return (
    <div style={{ padding: '32px', maxWidth: 560 }} data-page-name="Network Settings" data-ai-context={JSON.stringify({ network_id: network.id, network_name: network.name })}>
      <button onClick={() => router.push(`/networks/${id}`)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
      }}>
        ← {network.name}
      </button>

      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>{t('networksDetail.networkSettings')}</h1>

      {actionError && (
        <div style={{ background: '#fee2e2', border: '1.5px solid #fecaca', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#dc2626' }}>
          {actionError}
        </div>
      )}

      <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networksDetail.name')}</label>
          <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={60}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }} />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink-soft)' }}>{t('networks.description')}</label>
          <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} maxLength={200}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1.5px solid var(--border)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 10, color: 'var(--ink-soft)' }}>{t('networks.defaultVisibility')}</label>
          {(['public', 'network_only'] as const).map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
              <input type="radio" name="editVis" checked={editVis === v} onChange={() => setEditVis(v)} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{v === 'public' ? t('networks.public') : t('networks.networkOnly')}</div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                  {v === 'public' ? t('networksDetail.newListingsPublic') : t('networksDetail.newListingsPrivate')}
                </div>
              </div>
            </label>
          ))}
        </div>

        {saveSuccess && <p style={{ color: 'var(--color-green)', fontSize: 13 }}>{t('networksDetail.settingsSaved')}</p>}

        <button type="submit" disabled={saving} style={{
          padding: '11px 24px', background: 'var(--blue)', color: '#fff', border: 'none',
          borderRadius: 'var(--radius-button)', fontWeight: 600, fontSize: 14, cursor: saving ? 'default' : 'pointer',
          alignSelf: 'flex-start', opacity: saving ? 0.6 : 1,
        }}>
          {saving ? t('networksDetail.savingBtn') : t('networksDetail.saveChanges')}
        </button>
      </form>

      <hr style={{ border: 'none', borderTop: '1.5px solid var(--border)', marginBottom: 24 }} />

      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>{t('networksDetail.dangerZone')}</h3>
        <button
          onClick={handleDeleteNetwork}
          disabled={network.member_count > 0}
          title={network.member_count > 0 ? t('networksDetail.removeMembersFirst') : ''}
          style={{
            padding: '10px 20px', background: network.member_count > 0 ? '#f3f4f6' : '#fee2e2',
            color: network.member_count > 0 ? '#9ca3af' : '#dc2626',
            border: '1.5px solid', borderColor: network.member_count > 0 ? 'var(--border)' : '#fecaca',
            borderRadius: 'var(--radius-button)', fontSize: 14, fontWeight: 600,
            cursor: network.member_count > 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {t('networksDetail.deleteNetwork')}
        </button>
        {network.member_count > 0 && (
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>{t('networksDetail.removeMembersFirst')}</p>
        )}
      </div>
    </div>
  )
}
