'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'

// ── Role constants ────────────────────────────────────────────────────────────
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

// ── Shared types ──────────────────────────────────────────────────────────────
type TabKey = 'profile' | 'org' | 'team'

interface Alert { kind: 'info' | 'error'; msg: string }

interface TeamMember {
  id: string
  full_name: string | null
  email: string
  role: string
  is_active: boolean
  created_at: string
}

interface PendingInvitation {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string
}

// ── Small shared components ───────────────────────────────────────────────────
function EditableInput({
  label, value, onChange, placeholder, readOnly,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; readOnly?: boolean
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
        style={readOnly
          ? { background: 'var(--color-bg-2)', color: 'var(--color-ink-3)', cursor: 'default' }
          : undefined}
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

function roleBadgeClass(role: string) {
  if (role.includes('admin'))         return 'badge badge-active'
  if (role === 'bank_credit_officer') return 'badge badge-signing'
  return 'badge badge-draft'
}

function memberInitials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase()
    return (parts[0]?.slice(0, 2) ?? email.slice(0, 2)).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const portal = usePortal()
  const user   = useUser()
  const router = useRouter()

  const [tab, setTab] = useState<TabKey>('profile')

  const isAdmin    = ADMIN_ROLES.includes(user?.role ?? '')
  const isBankUser = BANK_ROLES.includes(user?.role ?? '')
  const tabLabel   = isBankUser ? 'Institution' : 'Company'

  const portalLabel = portal === 'bank'
    ? 'Bank Portal'
    : portal === 'anchor'
    ? 'Anchor Portal'
    : 'Supplier Portal'

  // ── Profile tab ─────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({ full_name: '', job_title: '', email: '', role: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileAlert, setProfileAlert]   = useState<Alert | null>(null)

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then(d => {
        if (d.user) setProfile({
          full_name: d.user.full_name ?? '',
          job_title: d.user.job_title ?? '',
          email:     d.user.email     ?? '',
          role:      d.user.role      ?? '',
        })
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
      if (!res.ok) { setProfileAlert({ kind: 'error', msg: data.error ?? 'Failed to save' }); return }
      setProfileAlert({ kind: 'info', msg: 'Profile updated' })
      setTimeout(() => setProfileAlert(null), 3000)
    } catch {
      setProfileAlert({ kind: 'error', msg: 'Network error. Please try again.' })
    } finally {
      setProfileSaving(false)
    }
  }

  const initials = profile.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  // ── Org tab ──────────────────────────────────────────────────────────────────
  const [orgProfile, setOrgProfile] = useState<Record<string, string>>({})
  const [orgSaving,  setOrgSaving]  = useState(false)
  const [orgAlert,   setOrgAlert]   = useState<Alert | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoAlert,     setLogoAlert]     = useState<Alert | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/settings/bank')
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          const p: Record<string, string> = {}
          for (const [k, v] of Object.entries(d.profile)) p[k] = v != null ? String(v) : ''
          setOrgProfile(p)
        }
      })
      .catch(() => {})
  }, [])

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
      if (!res.ok) { setOrgAlert({ kind: 'error', msg: data.error ?? 'Failed to save' }); return }
      if (data.profile) {
        const p: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.profile)) p[k] = v != null ? String(v) : ''
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

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    setLogoAlert(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/settings/logo', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setLogoAlert({ kind: 'error', msg: data.error ?? 'Upload failed' }); return }
      setOrgProfile(p => ({ ...p, logo_url: data.logo_url }))
      setLogoAlert({ kind: 'info', msg: 'Logo updated' })
      setTimeout(() => setLogoAlert(null), 3000)
    } catch {
      setLogoAlert({ kind: 'error', msg: 'Upload failed. Please try again.' })
    } finally {
      setLogoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const orgField    = (f: string) => orgProfile[f] ?? ''
  const setOrgField = (f: string, v: string) => setOrgProfile(p => ({ ...p, [f]: v }))

  // ── Team tab ──────────────────────────────────────────────────────────────────
  const [members,     setMembers]     = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamError,   setTeamError]   = useState<string | null>(null)
  const [confirmId,   setConfirmId]   = useState<string | null>(null)
  const [actingId,    setActingId]    = useState<string | null>(null)
  const [actionErr,   setActionErr]   = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [inviteRole,    setInviteRole]    = useState('')
  const [inviting,      setInviting]      = useState(false)
  const [inviteError,   setInviteError]   = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const inviteableRole = user?.role === 'bank_admin'
    ? { value: 'bank_credit_officer', label: 'Credit Officer' }
    : { value: user?.role === 'anchor_admin' ? 'anchor_member' : 'supplier_member', label: 'Team Member' }

  const fetchTeam = useCallback(async () => {
    setTeamLoading(true)
    setTeamError(null)
    try {
      const res = await fetch('/api/settings/team')
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setTeamError(data.error ?? 'Failed to load team')
        return
      }
      const data = await res.json() as { users: TeamMember[]; pending_invitations: PendingInvitation[] }
      setMembers(data.users ?? [])
      setInvitations(data.pending_invitations ?? [])
    } catch {
      setTeamError('Failed to load team')
    } finally {
      setTeamLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'team' && isAdmin && members.length === 0 && !teamLoading) {
      setInviteRole(inviteableRole.value)
      fetchTeam()
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggle(memberId: string, makeActive: boolean) {
    setActingId(memberId)
    setActionErr(null)
    try {
      const res = await fetch(`/api/settings/team/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: makeActive }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setActionErr(data.error ?? 'Failed to update user')
        return
      }
      setConfirmId(null)
      await fetchTeam()
    } catch {
      setActionErr('Failed to update user')
    } finally {
      setActingId(null)
    }
  }

  async function handleCancelInvite(invId: string) {
    setCancellingId(invId)
    try {
      const res = await fetch('/api/invitations/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invId }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setActionErr(data.error ?? 'Failed to cancel invitation')
        return
      }
      setInvitations(prev => prev.filter(i => i.id !== invId))
    } catch {
      setActionErr('Failed to cancel invitation')
    } finally {
      setCancellingId(null)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setInviteError(data.error ?? 'Failed to send invitation'); return }
      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}`)
      setInviteEmail('')
      await fetchTeam()
    } catch {
      setInviteError('Failed to send invitation')
    } finally {
      setInviting(false)
    }
  }

  if (!user) return null

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
              className={`btn btn-sm ${tab === 'team' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('team')}
            >
              Team
            </button>
          )}
        </div>

        {/* ── Tab: My Profile ── */}
        {tab === 'profile' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="card-head">
              <h3 className="t-card-head">Personal details</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18, flexShrink: 0 }}>
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

        {/* ── Tab: Org / Institution ── */}
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

              {/* Logo upload */}
              <div style={{ marginBottom: 20 }}>
                <label className="form-label">Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  {orgProfile.logo_url ? (
                    <img
                      src={orgProfile.logo_url}
                      alt="Logo"
                      style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-2)' }}
                    />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 6, border: '1px dashed var(--color-border)', background: 'var(--color-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--color-ink-4)' }}>
                      No logo
                    </div>
                  )}
                  {isAdmin && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                        style={{ display: 'none' }}
                        onChange={handleLogoUpload}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={logoUploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {logoUploading ? 'Uploading…' : 'Upload logo'}
                      </button>
                      <span style={{ fontSize: 11.5, color: 'var(--color-ink-4)' }}>PNG, JPG, SVG · max 2 MB</span>
                    </>
                  )}
                </div>
                {logoAlert && <AlertBox alert={logoAlert} />}
              </div>

              {isBankUser ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label="Legal name"            value={orgField('legal_name')}            onChange={v => setOrgField('legal_name', v)}            readOnly={!isAdmin} />
                  <EditableInput label="Display name"          value={orgField('display_name')}          onChange={v => setOrgField('display_name', v)}          readOnly={!isAdmin} />
                  <EditableInput label="Website"               value={orgField('website')}               onChange={v => setOrgField('website', v)}               readOnly={!isAdmin} />
                  <EditableInput label="Primary contact name"  value={orgField('primary_contact_name')}  onChange={v => setOrgField('primary_contact_name', v)}  readOnly={!isAdmin} />
                  <EditableInput label="Primary contact email" value={orgField('primary_contact_email')} onChange={v => setOrgField('primary_contact_email', v)} readOnly={!isAdmin} />
                  <div className="kv-row" style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
                    <span className="k">Routing number</span>
                    <span className="v">{orgField('routing_number') || '—'}</span>
                  </div>
                  <div className="kv-row" style={{ padding: '10px 0' }}>
                    <span className="k">Status</span>
                    <span className="v"><span className="badge badge-active">{orgField('status') || 'Active'}</span></span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label="Legal name"            value={orgField('legal_name')}            onChange={v => setOrgField('legal_name', v)}            readOnly={!isAdmin} />
                  <EditableInput label="DBA / Trade name"      value={orgField('doing_business_as')}     onChange={v => setOrgField('doing_business_as', v)}     readOnly={!isAdmin} />
                  <EditableInput label="Address line 1"        value={orgField('address_line1')}         onChange={v => setOrgField('address_line1', v)}         readOnly={!isAdmin} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 12 }}>
                    <EditableInput label="City"  value={orgField('city')}  onChange={v => setOrgField('city', v)}  readOnly={!isAdmin} />
                    <EditableInput label="State" value={orgField('state')} onChange={v => setOrgField('state', v)} readOnly={!isAdmin} />
                    <EditableInput label="ZIP"   value={orgField('zip')}   onChange={v => setOrgField('zip', v)}   readOnly={!isAdmin} />
                  </div>
                  <EditableInput label="Primary contact phone" value={orgField('primary_contact_phone')} onChange={v => setOrgField('primary_contact_phone', v)} readOnly={!isAdmin} />
                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">EIN</span>
                      <span className="v">{orgField('ein') ? `**-***${orgField('ein').slice(-4)}` : '—'}</span>
                    </div>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">KYB Status</span>
                      <span className="v">
                        <span className={`badge ${
                          orgField('kyb_status') === 'approved' ? 'badge-active'
                          : orgField('kyb_status') === 'pending' ? 'badge-pending'
                          : 'badge-draft'
                        }`}>
                          {(orgField('kyb_status') || 'Not started').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {orgAlert && <AlertBox alert={orgAlert} />}

              {isAdmin && (
                <div style={{ marginTop: 20 }}>
                  <button type="button" className="btn btn-primary" onClick={saveOrg} disabled={orgSaving}>
                    {orgSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Team ── */}
        {tab === 'team' && isAdmin && (
          <div>
            {teamError && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <div className="alert-body">{teamError}</div>
              </div>
            )}
            {actionErr && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <div className="alert-body">{actionErr}</div>
              </div>
            )}

            {/* Members table */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3 className="t-card-head">Members</h3>
                {!teamLoading && !teamError && (
                  <span className="subtitle" style={{ marginLeft: 8 }}>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              {teamLoading ? (
                <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-4)', opacity: 0.6 }}>Loading…</div>
              ) : members.length === 0 ? (
                <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-3)' }}>No team members yet.</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Member</th><th>Role</th><th>Status</th><th>Joined</th><th className="row-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const isMe         = m.id === user.id
                      const isConfirming = confirmId === m.id
                      const isActing     = actingId  === m.id
                      return (
                        <tr key={m.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{
                                width: 32, height: 32, borderRadius: '50%',
                                background: 'var(--color-accent-bg)', color: 'var(--color-accent)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 600, flexShrink: 0, letterSpacing: '0.02em',
                              }}>
                                {memberInitials(m.full_name, m.email)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 500, fontSize: 13 }}>{m.full_name ?? '—'}</div>
                                <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{m.email}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className={roleBadgeClass(m.role)}>{ROLE_LABELS[m.role] ?? m.role}</span></td>
                          <td>
                            {m.is_active
                              ? <span className="badge badge-active">Active</span>
                              : <span className="badge badge-rejected">Inactive</span>}
                          </td>
                          <td className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 12 }}>{fmtDate(m.created_at)}</td>
                          <td className="row-actions">
                            {isMe ? (
                              <span className="badge badge-draft">You</span>
                            ) : isConfirming ? (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <span style={{ fontSize: 12, color: 'var(--color-ink-2)', whiteSpace: 'nowrap' }}>
                                  Deactivate {m.full_name?.split(' ')[0] ?? 'user'}? They will lose access.
                                </span>
                                <button className="btn btn-danger btn-sm" type="button" disabled={isActing} onClick={() => handleToggle(m.id, false)}>
                                  {isActing ? '…' : 'Confirm'}
                                </button>
                                <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => setConfirmId(null)}>
                                  Cancel
                                </button>
                              </div>
                            ) : m.is_active ? (
                              <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => setConfirmId(m.id)}>
                                Deactivate
                              </button>
                            ) : (
                              <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => handleToggle(m.id, true)}>
                                {isActing ? '…' : 'Reactivate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pending invitations */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3 className="t-card-head">Pending invitations</h3>
              </div>
              {invitations.length === 0 ? (
                <div className="card-body" style={{ padding: 24, color: 'var(--color-ink-3)', fontSize: 13 }}>
                  No pending invitations
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th><th className="row-actions" /></tr>
                  </thead>
                  <tbody>
                    {invitations.map(inv => {
                      const hoursLeft    = (new Date(inv.expires_at).getTime() - Date.now()) / 3_600_000
                      const expiringSoon = hoursLeft < 24
                      const isCancelling = cancellingId === inv.id
                      return (
                        <tr key={inv.id}>
                          <td style={{ fontSize: 13 }}>{inv.email}</td>
                          <td><span className={roleBadgeClass(inv.role)}>{ROLE_LABELS[inv.role] ?? inv.role}</span></td>
                          <td className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 12 }}>{fmtDate(inv.created_at)}</td>
                          <td className="mono" style={{ fontSize: 12, color: expiringSoon ? 'var(--color-red)' : 'var(--color-ink-3)' }}>
                            {fmtDate(inv.expires_at)}
                          </td>
                          <td className="row-actions">
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={isCancelling}
                              onClick={() => handleCancelInvite(inv.id)}
                            >
                              {isCancelling ? '…' : 'Cancel'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Invite form */}
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">Invite a team member</h3>
              </div>
              <div className="card-body">
                {inviteSuccess && (
                  <div className="alert alert-success" style={{ marginBottom: 16 }}>
                    <div className="alert-body">{inviteSuccess}</div>
                  </div>
                )}
                {inviteError && (
                  <div className="alert alert-error" style={{ marginBottom: 16 }}>
                    <div className="alert-body">{inviteError}</div>
                  </div>
                )}
                <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label className="field-label" htmlFor="invite-email">Email address</label>
                    <input
                      id="invite-email"
                      className="input"
                      type="email"
                      placeholder="colleague@example.com"
                      value={inviteEmail}
                      onChange={e => { setInviteEmail(e.target.value); setInviteSuccess(null) }}
                      required
                    />
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <label className="field-label" htmlFor="invite-role">Role</label>
                    <select id="invite-role" className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                      <option value={inviteableRole.value}>{inviteableRole.label}</option>
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    style={{ marginBottom: 1 }}
                  >
                    {inviting ? 'Sending…' : 'Send invite'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  )
}
