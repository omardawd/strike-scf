'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { usePortal } from '@/lib/portal-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'

interface ErpConnection {
  id: string
  erp_type: string
  base_url: string
  status: 'active' | 'error' | 'pending' | 'disconnected'
  last_synced_at: string | null
  error_message: string | null
  dispatch_token: string
  created_at: string
}

type AlertKind = 'info' | 'error' | 'success'
interface Alert { kind: AlertKind; msg: string }

const ERP_PROVIDERS = [
  { id: 'erpnext', label: 'ERPNext', badge: 'Free', desc: 'Open-source ERP — free tier on frappe.cloud' },
  { id: 'netsuite', label: 'NetSuite', badge: 'Coming Soon', desc: 'Oracle NetSuite (planned)', disabled: true },
  { id: 'sap', label: 'SAP', badge: 'Coming Soon', desc: 'SAP S/4HANA (planned)', disabled: true },
  { id: 'dynamics', label: 'Dynamics 365', badge: 'Coming Soon', desc: 'Microsoft Dynamics (planned)', disabled: true },
]

export default function ErpSettingsPage() {
  const user = useUser()
  const portal = usePortal()
  const router = useRouter()

  const [connection, setConnection] = useState<ErpConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)

  // Connect form state
  const [selectedProvider, setSelectedProvider] = useState('erpnext')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [connecting, setConnecting] = useState(false)

  const isAdmin = user?.role === 'org_admin'

  const fetchConnection = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/erp/connect')
      const json = await res.json()
      setConnection(json.connection)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchConnection() }, [fetchConnection])

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    setConnecting(true)
    setAlert(null)
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erp_type: selectedProvider, base_url: baseUrl, api_key: apiKey, api_secret: apiSecret }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAlert({ kind: 'error', msg: json.error ?? 'Connection failed' })
        return
      }
      setAlert({ kind: 'success', msg: `Connected! ERPNext user: ${json.erp_user}` })
      setBaseUrl(''); setApiKey(''); setApiSecret('')
      await fetchConnection()
    } finally {
      setConnecting(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setAlert(null)
    try {
      const res = await fetch('/api/erp/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setAlert({ kind: 'error', msg: json.error ?? 'Sync failed' })
        return
      }
      const errCount = json.errors?.length ?? 0
      setAlert({
        kind: errCount > 0 ? 'info' : 'success',
        msg: errCount > 0
          ? `Sync completed with ${errCount} error(s): ${json.errors.join(', ')}`
          : 'Sync complete — ERP data is now up to date.',
      })
      await fetchConnection()
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect your ERP? Synced data will be preserved but no new syncs will run.')) return
    setDisconnecting(true)
    try {
      await fetch('/api/erp/connect', { method: 'DELETE' })
      setConnection(null)
      setAlert({ kind: 'info', msg: 'ERP connection removed.' })
    } finally {
      setDisconnecting(false)
    }
  }

  function copyToken() {
    if (!connection?.dispatch_token) return
    void navigator.clipboard.writeText(connection.dispatch_token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusColor = connection?.status === 'active'
    ? 'var(--color-green)'
    : connection?.status === 'error'
      ? 'var(--color-red)'
      : 'var(--gray)'

  return (
    <PortalShell>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        data-page-name="ERP Integration Settings"
        data-ai-context={JSON.stringify({ portal, user_role: user?.role, page: 'erp_settings', erp_connected: !!connection })}
      >
        <Topbar
          crumbs={[{ label: 'Settings', onClick: () => router.push('/settings') }, { label: 'ERP Integration' }]}
          actions={<NotifBell />}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', maxWidth: 720 }}>

          {alert && (
            <div style={{
              padding: '12px 16px', borderRadius: 'var(--radius-input)',
              marginBottom: 20,
              background: alert.kind === 'error' ? '#FEE2E2'
                : alert.kind === 'success' ? '#EDFAF4' : '#EEF0FF',
              color: alert.kind === 'error' ? 'var(--color-red)'
                : alert.kind === 'success' ? 'var(--color-green)' : 'var(--blue)',
              fontSize: 14,
            }}>
              {alert.msg}
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--gray)', fontSize: 14 }}>Loading...</div>
          ) : connection ? (
            /* ── Connected state ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Status card */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor }} />
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {ERP_PROVIDERS.find(p => p.id === connection.erp_type)?.label ?? connection.erp_type}
                    </span>
                    <span style={{
                      fontSize: 12, padding: '2px 8px', borderRadius: 999,
                      background: connection.status === 'active' ? '#EDFAF4' : '#FEE2E2',
                      color: statusColor, fontWeight: 500,
                    }}>
                      {connection.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isAdmin && (
                      <button
                        onClick={() => void handleSync()}
                        disabled={syncing}
                        style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border-strong)', background: 'transparent', fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}
                      >
                        {syncing ? 'Syncing…' : 'Sync Now'}
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => void handleDisconnect()}
                        disabled={disconnecting}
                        style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--color-red)', background: 'transparent', fontSize: 13, cursor: 'pointer', color: 'var(--color-red)' }}
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--gray)' }}>URL</span>
                    <div style={{ color: 'var(--ink)', marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{connection.base_url}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--gray)' }}>Last synced</span>
                    <div style={{ color: 'var(--ink)', marginTop: 2 }}>
                      {connection.last_synced_at
                        ? new Date(connection.last_synced_at).toLocaleString()
                        : 'Never — click Sync Now'}
                    </div>
                  </div>
                </div>

                {connection.error_message && (
                  <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-red)', background: '#FEE2E2', padding: '8px 12px', borderRadius: 8 }}>
                    {connection.error_message}
                  </div>
                )}
              </div>

              {/* Dispatch token card */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 24 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Dispatch Token</div>
                <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 14px' }}>
                  Use this token to send commands to Strike AI from your phone, ERPNext webhooks, or any HTTP client.
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{
                    flex: 1, padding: '9px 12px', borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--border)', background: 'var(--offwhite)',
                    fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {showToken ? connection.dispatch_token : '•'.repeat(40)}
                  </div>
                  <button
                    onClick={() => setShowToken(v => !v)}
                    style={{ padding: '9px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border)', background: 'transparent', fontSize: 12, cursor: 'pointer', color: 'var(--gray)' }}
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={copyToken}
                    style={{ padding: '9px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border)', background: 'transparent', fontSize: 12, cursor: 'pointer', color: copied ? 'var(--color-green)' : 'var(--gray)' }}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--offwhite)', borderRadius: 'var(--radius-input)', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                  <div style={{ color: 'var(--gray)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Example — ERPNext webhook payload:</div>
                  {`POST https://your-strike-domain.com/api/ai/dispatch\n` +
                   `Authorization: Bearer ${showToken ? connection.dispatch_token : '<your-dispatch-token>'}\n\n` +
                   `{ "message": "Inventory is low on SKU-001, create a listing", "source": "erp_webhook" }`}
                </div>

                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--gray)' }}>
                  Or open the mobile command page:{' '}
                  <a
                    href={`/dispatch?token=${connection.dispatch_token}`}
                    target="_blank"
                    style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    /dispatch?token=…
                  </a>
                </div>
              </div>

              {/* What AI can now do */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 24 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>What Strike AI can now do</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { icon: '📦', text: 'Detect low inventory and suggest creating a PO request on Strike Marketplace' },
                    { icon: '💸', text: 'Identify overdue AR and recommend invoice factoring or early payment financing' },
                    { icon: '📉', text: 'Flag cash flow stress and suggest reverse factoring programs' },
                    { icon: '🔄', text: 'Match open purchase orders with Strike suppliers automatically' },
                    { icon: '📱', text: 'Accept commands from your phone via the Dispatch page or ERPNext webhooks' },
                  ].map(({ icon, text }) => (
                    <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-soft)' }}>
                      <span>{icon}</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          ) : (
            /* ── Connect form ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Provider selector */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 24 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Connect your ERP</div>
                <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 18px' }}>
                  Connecting an ERP gives Strike AI real-time financial signals to act on autonomously.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 24 }}>
                  {ERP_PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      disabled={p.disabled}
                      onClick={() => !p.disabled && setSelectedProvider(p.id)}
                      style={{
                        textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--radius-input)',
                        border: `2px solid ${selectedProvider === p.id ? 'var(--blue)' : 'var(--border)'}`,
                        background: selectedProvider === p.id ? 'var(--blue-light)' : 'var(--offwhite)',
                        cursor: p.disabled ? 'not-allowed' : 'pointer',
                        opacity: p.disabled ? 0.5 : 1,
                        transition: 'all .15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{p.label}</span>
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: p.badge === 'Free' ? '#EDFAF4' : 'var(--offwhite)', color: p.badge === 'Free' ? 'var(--color-green)' : 'var(--gray)', fontWeight: 500 }}>{p.badge}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gray)' }}>{p.desc}</div>
                    </button>
                  ))}
                </div>

                {selectedProvider === 'erpnext' && isAdmin && (
                  <form onSubmit={(e) => void handleConnect(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 13, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>ERPNext site URL</label>
                      <input
                        value={baseUrl}
                        onChange={e => setBaseUrl(e.target.value)}
                        placeholder="https://your-site.frappe.cloud"
                        required
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border)', fontSize: 14, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 13, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>API Key</label>
                        <input
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                          placeholder="API Key"
                          required
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border)', fontSize: 14, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 13, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>API Secret</label>
                        <input
                          type="password"
                          value={apiSecret}
                          onChange={e => setApiSecret(e.target.value)}
                          placeholder="API Secret"
                          required
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border)', fontSize: 14, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>

                    <div style={{ padding: '12px 14px', background: 'var(--blue-light)', borderRadius: 'var(--radius-input)', fontSize: 12, color: 'var(--blue)' }}>
                      <strong>Get your credentials:</strong> In ERPNext → Settings → API Access → Generate Keys.
                      Don&apos;t have an account? Sign up free at{' '}
                      <span style={{ fontWeight: 500 }}>frappe.cloud</span>
                    </div>

                    <button
                      type="submit"
                      disabled={connecting}
                      style={{ padding: '11px 0', borderRadius: 999, background: 'var(--blue)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                    >
                      {connecting ? 'Connecting…' : 'Connect ERPNext'}
                    </button>
                  </form>
                )}

                {!isAdmin && (
                  <div style={{ padding: '12px 14px', background: '#FEF3C7', borderRadius: 'var(--radius-input)', fontSize: 13, color: '#92400E' }}>
                    Only org admins can connect an ERP system.
                  </div>
                )}
              </div>

              {/* Why connect card */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 24 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>Why connect your ERP?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    'Strike AI gains real-time visibility into your cash position, AR/AP aging, inventory, and open orders',
                    'Proactive advisories appear on your dashboard before you ask — low stock, overdue invoices, cash stress',
                    'AI can autonomously create listings, submit financing requests, and match suppliers to your open POs',
                    'Command Strike AI from your phone or directly from ERPNext webhooks via the Dispatch API',
                  ].map(text => (
                    <div key={text} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--ink-soft)' }}>
                      <span style={{ color: 'var(--blue)', flexShrink: 0 }}>✓</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
