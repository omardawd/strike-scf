'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'

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

const ROLE_LABELS: Record<string, string> = {
  bank_admin:           'Bank Admin',
  bank_credit_officer:  'Credit Officer',
  anchor_admin:         'Anchor Admin',
  anchor_member:        'Team Member',
  supplier_admin:       'Supplier Admin',
  supplier_member:      'Team Member',
}

const ADMIN_ROLES = ['bank_admin', 'anchor_admin', 'supplier_admin']

function roleBadgeClass(role: string): string {
  if (role.includes('admin'))          return 'badge badge-active'
  if (role === 'bank_credit_officer')  return 'badge badge-signing'
  return 'badge badge-draft'
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      const first = parts[0]?.[0] ?? ''
      const last  = parts[parts.length - 1]?.[0] ?? ''
      return (first + last).toUpperCase()
    }
    return (parts[0]?.slice(0, 2) ?? email.slice(0, 2)).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TeamPage() {
  const router = useRouter()
  const user   = useUser()

  const [members,     setMembers]     = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState<string | null>(null)

  // Inline deactivate confirmation
  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [actingId,  setActingId]    = useState<string | null>(null)
  const [actionErr, setActionErr]   = useState<string | null>(null)

  // Invite form
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [inviteRole,    setInviteRole]    = useState('')
  const [inviting,      setInviting]      = useState(false)
  const [inviteError,   setInviteError]   = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const isAdmin = ADMIN_ROLES.includes(user?.role ?? '')

  // Determine the one invite-able role for this admin
  const inviteableRole = user?.role === 'bank_admin'
    ? { value: 'bank_credit_officer', label: 'Credit Officer' }
    : { value: user?.role === 'anchor_admin' ? 'anchor_member' : 'supplier_member', label: 'Team Member' }

  const portalLabel = user?.role?.startsWith('bank')   ? 'Bank Portal'
    : user?.role?.startsWith('anchor') ? 'Anchor Portal' : 'Supplier Portal'

  const fetchTeam = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/settings/team')
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFetchError(data.error ?? 'Failed to load team')
        return
      }
      const data = await res.json() as {
        users: TeamMember[]
        pending_invitations: PendingInvitation[]
      }
      setMembers(data.users ?? [])
      setInvitations(data.pending_invitations ?? [])
    } catch {
      setFetchError('Failed to load team')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    if (!isAdmin) {
      router.replace('/settings')
      return
    }
    setInviteRole(inviteableRole.value)
    fetchTeam()
  }, [user, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!res.ok) {
        setInviteError(data.error ?? 'Failed to send invitation')
        return
      }
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
  if (!isAdmin) return null

  return (
    <PortalShell activeSection="settings">
      <Topbar
        onBack={() => router.push('/settings')}
        crumbs={[
          { label: portalLabel },
          { label: 'Settings', onClick: () => router.push('/settings') },
          { label: 'Team' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">Team members</h1>
          {!loading && !fetchError && (
            <div className="subtitle">{members.length} member{members.length !== 1 ? 's' : ''}</div>
          )}
        </div>

        {fetchError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <div className="alert-body">{fetchError}</div>
          </div>
        )}

        {actionErr && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <div className="alert-body">{actionErr}</div>
          </div>
        )}

        {/* ── Members table ── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h3 className="t-card-head">Members</h3>
          </div>
          {loading ? (
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-4)', opacity: 0.6 }}>
              Loading…
            </div>
          ) : members.length === 0 ? (
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-3)' }}>
              No team members yet.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th className="row-actions" />
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
                            background: 'var(--color-accent-bg)',
                            color: 'var(--color-accent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 600, flexShrink: 0,
                            letterSpacing: '0.02em',
                          }}>
                            {initials(m.full_name, m.email)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>
                              {m.full_name ?? '—'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                              {m.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={roleBadgeClass(m.role)}>
                          {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                      </td>
                      <td>
                        {m.is_active
                          ? <span className="badge badge-active">Active</span>
                          : <span className="badge badge-rejected">Inactive</span>}
                      </td>
                      <td className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 12 }}>
                        {fmtDate(m.created_at)}
                      </td>
                      <td className="row-actions">
                        {isMe ? (
                          <span className="badge badge-draft">You</span>
                        ) : isConfirming ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <span style={{ fontSize: 12, color: 'var(--color-ink-2)', whiteSpace: 'nowrap' }}>
                              Deactivate {m.full_name?.split(' ')[0] ?? 'user'}? They will lose access.
                            </span>
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              disabled={isActing}
                              onClick={() => handleToggle(m.id, false)}
                            >
                              {isActing ? '…' : 'Confirm'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={isActing}
                              onClick={() => setConfirmId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : m.is_active ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={isActing}
                            onClick={() => setConfirmId(m.id)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={isActing}
                            onClick={() => handleToggle(m.id, true)}
                          >
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

        {/* ── Pending invitations ── */}
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
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Sent</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map(inv => {
                  const hoursLeft     = (new Date(inv.expires_at).getTime() - Date.now()) / 3_600_000
                  const expiringSoon  = hoursLeft < 24
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontSize: 13 }}>{inv.email}</td>
                      <td>
                        <span className={roleBadgeClass(inv.role)}>
                          {ROLE_LABELS[inv.role] ?? inv.role}
                        </span>
                      </td>
                      <td className="mono" style={{ color: 'var(--color-ink-3)', fontSize: 12 }}>
                        {fmtDate(inv.created_at)}
                      </td>
                      <td
                        className="mono"
                        style={{ fontSize: 12, color: expiringSoon ? 'var(--color-red)' : 'var(--color-ink-3)' }}
                      >
                        {fmtDate(inv.expires_at)}
                      </td>
                      <td>
                        <span className="badge badge-pending">Pending</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Invite form ── */}
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
            <form
              onSubmit={handleInvite}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
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
                <select
                  id="invite-role"
                  className="input"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                >
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
    </PortalShell>
  )
}
