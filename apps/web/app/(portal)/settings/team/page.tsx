'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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

function roleLabels(t: TFn): Record<string, string> {
  return {
    bank_admin:          t('teamPage.role.bankAdmin'),
    bank_credit_officer: t('teamPage.role.creditOfficer'),
    org_admin:           t('teamPage.role.orgAdmin'),
    org_member:          t('teamPage.role.teamMember'),
  }
}

const ADMIN_ROLES = ['bank_admin', 'bank_credit_officer', 'org_admin']

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
  const t = useT()
  const ROLE_LABELS = roleLabels(t)

  const [members,     setMembers]     = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState<string | null>(null)

  // Inline deactivate confirmation
  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [actingId,  setActingId]    = useState<string | null>(null)
  const [actionErr, setActionErr]   = useState<string | null>(null)

  // Add member form
  const [addEmail,     setAddEmail]     = useState('')
  const [addFullName,  setAddFullName]  = useState('')
  const [addPassword,  setAddPassword]  = useState('')
  const [addConfirmPw, setAddConfirmPw] = useState('')
  const [showAddPw,    setShowAddPw]    = useState(false)
  const [adding,       setAdding]       = useState(false)
  const [addError,     setAddError]     = useState<string | null>(null)
  const [addSuccess,   setAddSuccess]   = useState<string | null>(null)

  const isAdmin = ADMIN_ROLES.includes(user?.role ?? '')

  const newMemberRoleLabel = user?.role === 'bank_admin' ? t('teamPage.role.creditOfficer') : t('teamPage.role.teamMember')

  const fetchTeam = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/settings/team')
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFetchError(data.error ?? t('teamPage.failedLoadTeam'))
        return
      }
      const data = await res.json() as {
        users: TeamMember[]
        pending_invitations: PendingInvitation[]
      }
      setMembers(data.users ?? [])
      setInvitations(data.pending_invitations ?? [])
    } catch {
      setFetchError(t('teamPage.failedLoadTeam'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!user) return
    if (!isAdmin) {
      router.replace('/settings')
      return
    }
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
        setActionErr(data.error ?? t('teamPage.failedUpdateUser'))
        return
      }
      setConfirmId(null)
      await fetchTeam()
    } catch {
      setActionErr(t('teamPage.failedUpdateUser'))
    } finally {
      setActingId(null)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim() || !addPassword || addPassword !== addConfirmPw) return
    setAdding(true)
    setAddError(null)
    setAddSuccess(null)
    try {
      const res = await fetch('/api/settings/team/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     addEmail.trim(),
          password:  addPassword,
          full_name: addFullName.trim() || undefined,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setAddError(data.error ?? t('teamPage.failedCreateAccount'))
        return
      }
      setAddSuccess(t('teamPage.accountCreatedFor', { email: addEmail.trim() }))
      setAddEmail('')
      setAddFullName('')
      setAddPassword('')
      setAddConfirmPw('')
      await fetchTeam()
    } catch {
      setAddError(t('teamPage.failedCreateAccount'))
    } finally {
      setAdding(false)
    }
  }

  if (!user) return null
  if (!isAdmin) return null

  return (
    <PortalShell activeSection="settings">
      <Topbar
        onBack={() => router.push('/settings')}
        crumbs={[
          { label: t('teamPage.settings'), onClick: () => router.push('/settings') },
          { label: t('teamPage.team') },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">{t('teamPage.teamMembers')}</h1>
          {!loading && !fetchError && (
            <div className="subtitle">{t('teamPage.memberCount', { count: members.length })}</div>
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
            <h3 className="t-card-head">{t('teamPage.members')}</h3>
          </div>
          {loading ? (
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>
              {t('common.loading')}
            </div>
          ) : members.length === 0 ? (
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)' }}>
              {t('teamPage.noTeamMembersYet')}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('teamPage.member')}</th>
                  <th>{t('teamPage.role')}</th>
                  <th>{t('financing.status')}</th>
                  <th>{t('teamPage.joined')}</th>
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
                            <div style={{ fontSize: 12, color: 'var(--gray)' }}>
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
                          ? <span className="badge badge-active">{t('teamPage.active')}</span>
                          : <span className="badge badge-rejected">{t('teamPage.inactive')}</span>}
                      </td>
                      <td className="mono" style={{ color: 'var(--gray)', fontSize: 12 }}>
                        {fmtDate(m.created_at)}
                      </td>
                      <td className="row-actions">
                        {isMe ? (
                          <span className="badge badge-draft">{t('listingDetail.you')}</span>
                        ) : isConfirming ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <span style={{ fontSize: 12, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                              {t('teamPage.deactivateConfirm', { name: m.full_name?.split(' ')[0] ?? t('teamPage.user') })}
                            </span>
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              disabled={isActing}
                              onClick={() => handleToggle(m.id, false)}
                            >
                              {isActing ? '…' : t('teamPage.confirm')}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={isActing}
                              onClick={() => setConfirmId(null)}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : m.is_active ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={isActing}
                            onClick={() => setConfirmId(m.id)}
                          >
                            {t('teamPage.deactivate')}
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={isActing}
                            onClick={() => handleToggle(m.id, true)}
                          >
                            {isActing ? '…' : t('teamPage.reactivate')}
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
            <h3 className="t-card-head">{t('teamPage.pendingInvitations')}</h3>
          </div>
          {invitations.length === 0 ? (
            <div className="card-body" style={{ padding: 24, color: 'var(--gray)', fontSize: 13 }}>
              {t('teamPage.noPendingInvitations')}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('teamPage.email')}</th>
                  <th>{t('teamPage.role')}</th>
                  <th>{t('teamPage.sent')}</th>
                  <th>{t('listingDetail.expires')}</th>
                  <th>{t('financing.status')}</th>
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
                      <td className="mono" style={{ color: 'var(--gray)', fontSize: 12 }}>
                        {fmtDate(inv.created_at)}
                      </td>
                      <td
                        className="mono"
                        style={{ fontSize: 12, color: expiringSoon ? '#DC2626' : 'var(--gray)' }}
                      >
                        {fmtDate(inv.expires_at)}
                      </td>
                      <td>
                        <span className="badge badge-pending">{t('dealDetail.pending')}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Add member form ── */}
        <div className="card">
          <div className="card-head">
            <h3 className="t-card-head">{t('teamPage.addTeamMember')}</h3>
            <div className="subtitle">{t('teamPage.createAccountHint', { role: newMemberRoleLabel })}</div>
          </div>
          <div className="card-body">
            {addSuccess && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <div className="alert-body">{addSuccess}</div>
              </div>
            )}
            {addError && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <div className="alert-body">{addError}</div>
              </div>
            )}
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="field-label" htmlFor="add-fullname">{t('teamPage.fullName')} <span style={{ fontWeight: 400, color: 'var(--gray)' }}>({t('reviewForm.optional')})</span></label>
                  <input
                    id="add-fullname"
                    className="input"
                    type="text"
                    placeholder="Jane Smith"
                    value={addFullName}
                    onChange={e => setAddFullName(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="field-label" htmlFor="add-email">{t('teamPage.emailAddress')}</label>
                  <input
                    id="add-email"
                    className="input"
                    type="email"
                    placeholder="colleague@example.com"
                    value={addEmail}
                    onChange={e => { setAddEmail(e.target.value); setAddSuccess(null) }}
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                  <label className="field-label" htmlFor="add-password">{t('teamPage.password')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="add-password"
                      className="input"
                      type={showAddPw ? 'text' : 'password'}
                      placeholder="Min. 8 characters"
                      value={addPassword}
                      onChange={e => setAddPassword(e.target.value)}
                      required
                      style={{ paddingRight: 38 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddPw(v => !v)}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--gray)', padding: 4,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        {showAddPw
                          ? <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>
                          : <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></>
                        }
                      </svg>
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="field-label" htmlFor="add-confirm">{t('teamPage.confirmPassword')}</label>
                  <input
                    id="add-confirm"
                    className="input"
                    type={showAddPw ? 'text' : 'password'}
                    placeholder={t('teamPage.reEnterPassword')}
                    value={addConfirmPw}
                    onChange={e => setAddConfirmPw(e.target.value)}
                    required
                  />
                  {addConfirmPw.length > 0 && addPassword !== addConfirmPw && (
                    <div style={{ fontSize: 12, color: '#DC2626', marginTop: 4 }}>{t('teamPage.passwordsDontMatch')}</div>
                  )}
                </div>
              </div>
              <div>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={adding || !addEmail.trim() || !addPassword || addPassword !== addConfirmPw || addPassword.length < 8}
                >
                  {adding ? t('teamPage.creating') : t('teamPage.createAccount')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}
