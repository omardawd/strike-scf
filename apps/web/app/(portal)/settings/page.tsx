'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'

const ADMIN_ROLES = ['bank_admin', 'anchor_admin', 'supplier_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']

const ROLE_LABELS: Record<string, string> = {
  bank_admin:           'Bank Admin',
  bank_credit_officer:  'Credit Officer',
  anchor_admin:         'Anchor Admin',
  anchor_member:        'Anchor Member',
  supplier_admin:       'Supplier Admin',
  supplier_member:      'Supplier Member',
}

interface ProfileState {
  full_name: string
  job_title: string
  email: string
  role: string
}

interface Alert {
  kind: 'info' | 'error'
  msg: string
}

function ReadonlyInput({ label, value }: { label: string; value: string }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        value={value}
        readOnly
        style={{ background: 'var(--color-bg-2)', color: 'var(--color-ink-3)', cursor: 'default' }}
      />
    </div>
  )
}

function EditableInput({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  readOnly?: boolean
}) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        style={readOnly ? { background: 'var(--color-bg-2)', color: 'var(--color-ink-3)', cursor: 'default' } : undefined}
      />
    </div>
  )
}

function AlertBox({ alert }: { alert: Alert }) {
  return (
    <div className={`alert alert-${alert.kind}`} style={{ marginTop: 16 }}>
      <div className="alert-body">{alert.msg}</div>
    </div>
  )
}

export default function SettingsPage() {
  const portal   = usePortal()
  const user     = useUser()
  const router   = useRouter()

  const [tab, setTab] = useState<'profile' | 'org'>('profile')

  // ── Profile tab state ──────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileState>({
    full_name: '', job_title: '', email: '', role: '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileAlert, setProfileAlert]   = useState<Alert | null>(null)

  // ── Org tab state ──────────────────────────────────────────────
  const [orgProfile, setOrgProfile] = useState<Record<string, string>>({})
  const [orgSaving, setOrgSaving]   = useState(false)
  const [orgAlert, setOrgAlert]     = useState<Alert | null>(null)

  const isAdmin    = ADMIN_ROLES.includes(user?.role ?? '')
  const isBankUser = BANK_ROLES.includes(user?.role ?? '')

  const tabLabel = isBankUser ? 'Institution' : 'Company'

  const portalLabel = portal === 'bank'
    ? 'Bank Portal'
    : portal === 'anchor'
    ? 'Anchor Portal'
    : 'Supplier Portal'

  const initials = profile.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  // Load profile
  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then(d => {
        if (d.user) {
          setProfile({
            full_name: d.user.full_name  ?? '',
            job_title: d.user.job_title  ?? '',
            email:     d.user.email      ?? '',
            role:      d.user.role       ?? '',
          })
        }
      })
      .catch(() => {})
  }, [])

  // Load org profile
  useEffect(() => {
    fetch('/api/settings/bank')
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          const p: Record<string, string> = {}
          for (const [k, v] of Object.entries(d.profile)) {
            p[k] = v != null ? String(v) : ''
          }
          setOrgProfile(p)
        }
      })
      .catch(() => {})
  }, [])

  async function saveProfile() {
    setProfileSaving(true)
    setProfileAlert(null)
    try {
      const res  = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: profile.full_name, job_title: profile.job_title }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProfileAlert({ kind: 'error', msg: data.error ?? 'Failed to save' })
        return
      }
      setProfileAlert({ kind: 'info', msg: 'Profile updated' })
      setTimeout(() => setProfileAlert(null), 3000)
    } catch {
      setProfileAlert({ kind: 'error', msg: 'Network error. Please try again.' })
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveOrg() {
    setOrgSaving(true)
    setOrgAlert(null)
    try {
      const res  = await fetch('/api/settings/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgProfile),
      })
      const data = await res.json()
      if (!res.ok) {
        setOrgAlert({ kind: 'error', msg: data.error ?? 'Failed to save' })
        return
      }
      if (data.profile) {
        const p: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.profile)) {
          p[k] = v != null ? String(v) : ''
        }
        setOrgProfile(p)
      }
      setOrgAlert({ kind: 'info', msg: 'Details updated' })
      setTimeout(() => setOrgAlert(null), 3000)
    } catch {
      setOrgAlert({ kind: 'error', msg: 'Network error. Please try again.' })
    } finally {
      setOrgSaving(false)
    }
  }

  function orgField(field: string) {
    return orgProfile[field] ?? ''
  }

  function setOrgField(field: string, value: string) {
    setOrgProfile(p => ({ ...p, [field]: value }))
  }

  return (
    <PortalShell activeSection="settings">
      <Topbar
        crumbs={[
          { label: portalLabel, onClick: () => router.push('/dashboard') },
          { label: 'Settings' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">Settings</h1>
          <div className="subtitle">Manage your profile and organization details</div>
        </div>

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'profile' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('profile')}
          >
            My Profile
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'org' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('org')}
          >
            {tabLabel}
          </button>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => router.push('/settings/team')}
            >
              Team
            </button>
          )}
        </div>

        {/* ── Tab 1: My Profile ── */}
        {tab === 'profile' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="card-head">
              <h3 className="t-card-head">Personal details</h3>
            </div>
            <div className="card-body">
              {/* Avatar row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div
                  className="avatar"
                  style={{ width: 48, height: 48, fontSize: 18, flexShrink: 0 }}
                >
                  {initials}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.full_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 2 }}>
                    {ROLE_LABELS[profile.role] ?? profile.role}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <EditableInput
                  label="Full name"
                  value={profile.full_name}
                  onChange={v => setProfile(p => ({ ...p, full_name: v }))}
                />

                <EditableInput
                  label="Job title"
                  value={profile.job_title}
                  onChange={v => setProfile(p => ({ ...p, job_title: v }))}
                  placeholder="e.g. Finance Manager"
                />

                <div className="form-field">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    value={profile.email}
                    readOnly
                    style={{ background: 'var(--color-bg-2)', color: 'var(--color-ink-3)', cursor: 'default' }}
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--color-ink-4)', marginTop: 2 }}>
                    Contact support to change email
                  </span>
                </div>

                <div className="form-field">
                  <label className="form-label">Role</label>
                  <div style={{ paddingTop: 4 }}>
                    <span className="badge badge-active">
                      {ROLE_LABELS[profile.role] ?? profile.role}
                    </span>
                  </div>
                </div>
              </div>

              {profileAlert && <AlertBox alert={profileAlert} />}

              <div style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveProfile}
                  disabled={profileSaving}
                >
                  {profileSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 2: Org / Institution ── */}
        {tab === 'org' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="card-head">
              <h3 className="t-card-head">
                {isBankUser ? 'Institution details' : 'Organization details'}
              </h3>
            </div>
            <div className="card-body">
              {!isAdmin && (
                <div className="alert alert-warn" style={{ marginBottom: 20 }}>
                  <div className="alert-body">
                    Contact your admin to update organization details
                  </div>
                </div>
              )}

              {isBankUser ? (
                // ── Bank fields ──
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label="Legal name"            value={orgField('legal_name')}           onChange={v => setOrgField('legal_name', v)}           readOnly={!isAdmin} />
                  <EditableInput label="Display name"          value={orgField('display_name')}         onChange={v => setOrgField('display_name', v)}         readOnly={!isAdmin} />
                  <EditableInput label="Website"               value={orgField('website')}              onChange={v => setOrgField('website', v)}              readOnly={!isAdmin} />
                  <EditableInput label="Primary contact name"  value={orgField('primary_contact_name')} onChange={v => setOrgField('primary_contact_name', v)} readOnly={!isAdmin} />
                  <EditableInput label="Primary contact email" value={orgField('primary_contact_email')}onChange={v => setOrgField('primary_contact_email', v)} readOnly={!isAdmin} />

                  <div className="kv-row" style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
                    <span className="k">Routing number</span>
                    <span className="v">{orgField('routing_number') || '—'}</span>
                  </div>
                  <div className="kv-row" style={{ padding: '10px 0' }}>
                    <span className="k">Status</span>
                    <span className="v">
                      <span className="badge badge-active">
                        {orgField('status') || 'Active'}
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                // ── Org fields (anchor / supplier) ──
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label="Legal name"            value={orgField('legal_name')}           onChange={v => setOrgField('legal_name', v)}           readOnly={!isAdmin} />
                  <EditableInput label="DBA / Trade name"      value={orgField('doing_business_as')}    onChange={v => setOrgField('doing_business_as', v)}    readOnly={!isAdmin} />
                  <EditableInput label="Address line 1"        value={orgField('address_line1')}        onChange={v => setOrgField('address_line1', v)}        readOnly={!isAdmin} />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 12 }}>
                    <EditableInput label="City"  value={orgField('city')}  onChange={v => setOrgField('city', v)}  readOnly={!isAdmin} />
                    <EditableInput label="State" value={orgField('state')} onChange={v => setOrgField('state', v)} readOnly={!isAdmin} />
                    <EditableInput label="ZIP"   value={orgField('zip')}   onChange={v => setOrgField('zip', v)}   readOnly={!isAdmin} />
                  </div>

                  <EditableInput label="Primary contact phone" value={orgField('primary_contact_phone')} onChange={v => setOrgField('primary_contact_phone', v)} readOnly={!isAdmin} />

                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">EIN</span>
                      <span className="v">
                        {orgField('ein')
                          ? `**-***${orgField('ein').slice(-4)}`
                          : '—'}
                      </span>
                    </div>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">KYB Status</span>
                      <span className="v">
                        <span className={`badge ${
                          orgField('kyb_status') === 'approved' ? 'badge-active'
                          : orgField('kyb_status') === 'pending' ? 'badge-pending'
                          : 'badge-draft'
                        }`}>
                          {(orgField('kyb_status') || 'Not started')
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {orgAlert && <AlertBox alert={orgAlert} />}

              {isAdmin && (
                <div style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveOrg}
                    disabled={orgSaving}
                  >
                    {orgSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  )
}
