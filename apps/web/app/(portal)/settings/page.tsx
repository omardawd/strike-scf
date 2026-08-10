'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, NotifBell } from '@/components/portal-shell'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

// ── Role constants ────────────────────────────────────────────────────────────
const ADMIN_ROLES = ['bank_admin', 'bank_credit_officer', 'org_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']

function roleLabels(t: TFn): Record<string, string> {
  return {
    bank_admin:          t('teamPage.role.bankAdmin'),
    bank_credit_officer: t('teamPage.role.creditOfficer'),
    org_admin:           t('teamPage.role.orgAdmin'),
    org_member:          t('teamPage.role.teamMember'),
  }
}

// ── Shared types ──────────────────────────────────────────────────────────────
type TabKey = 'profile' | 'org' | 'team' | 'bank-accounts' | 'erp'

interface Alert { kind: 'info' | 'error'; msg: string }

interface ErpConnection {
  id: string
  erp_type: string
  base_url: string
  status: 'active' | 'error' | 'pending' | 'disconnected'
  last_synced_at: string | null
  error_message: string | null
  // The raw dispatch token is never returned outside the connect/rotate
  // response — see lib/erp/dispatch-token.ts. Only a display-safe prefix is
  // available on subsequent reads.
  dispatch_token_prefix: string | null
  dispatch_token_expires_at: string | null
  dispatch_token_revoked_at: string | null
  created_at: string
}

function erpProviders(t: TFn) {
  return [
    { id: 'erpnext', label: 'ERPNext', badge: t('settingsPage.free'), desc: t('settingsPage.erpnextDesc') },
    { id: 'odoo', label: 'Odoo', badge: t('settingsPage.free'), desc: t('settingsPage.odooDesc') },
    { id: 'netsuite', label: 'NetSuite', badge: t('settingsPage.comingSoon'), desc: t('settingsPage.netsuiteDesc'), disabled: true },
    { id: 'sap', label: 'SAP', badge: t('settingsPage.comingSoon'), desc: t('settingsPage.sapDesc'), disabled: true },
  ]
}

interface BankAccount {
  id: string
  entity_type: string
  entity_id: string
  nickname: string
  bank_name: string
  account_holder_name: string
  account_number: string
  routing_number: string
  swift_iban: string | null
  account_type: 'checking' | 'savings'
  is_primary: boolean
  created_at: string
}

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
          ? { background: 'var(--offwhite)', color: 'var(--gray)', cursor: 'default' }
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
  const searchParams = useSearchParams()
  const t = useT()
  const ROLE_LABELS = roleLabels(t)
  const ERP_PROVIDERS = erpProviders(t)

  const initialTab = (searchParams.get('tab') as TabKey | null)
  const [tab, setTab] = useState<TabKey>(initialTab && ['profile', 'org', 'team', 'bank-accounts', 'erp'].includes(initialTab) ? initialTab : 'profile')

  const isAdmin    = ADMIN_ROLES.includes(user?.role ?? '')
  const isBankUser = BANK_ROLES.includes(user?.role ?? '')
  const tabLabel   = isBankUser ? t('settingsPage.institution') : t('settingsPage.company')

  // ── Profile tab ─────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({ full_name: '', email: '', role: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileAlert, setProfileAlert]   = useState<Alert | null>(null)

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then(d => {
        if (d.user) setProfile({
          full_name: d.user.full_name ?? '',
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
        body: JSON.stringify({ full_name: profile.full_name }),
      })
      const data = await res.json()
      if (!res.ok) { setProfileAlert({ kind: 'error', msg: data.error ?? t('settingsPage.failedToSave') }); return }
      setProfileAlert({ kind: 'info', msg: t('settingsPage.profileUpdated') })
      setTimeout(() => setProfileAlert(null), 3000)
    } catch {
      setProfileAlert({ kind: 'error', msg: t('common.networkError') })
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
      if (!res.ok) { setOrgAlert({ kind: 'error', msg: data.error ?? t('settingsPage.failedToSave') }); return }
      if (data.profile) {
        const p: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.profile)) p[k] = v != null ? String(v) : ''
        setOrgProfile(p)
      }
      setOrgAlert({ kind: 'info', msg: t('settingsPage.detailsUpdated') })
      setTimeout(() => setOrgAlert(null), 3000)
    } catch {
      setOrgAlert({ kind: 'error', msg: t('common.networkError') })
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
      if (!res.ok) { setLogoAlert({ kind: 'error', msg: data.error ?? t('settingsPage.uploadFailed') }); return }
      setOrgProfile(p => ({ ...p, logo_url: data.logo_url }))
      setLogoAlert({ kind: 'info', msg: t('settingsPage.logoUpdated') })
      setTimeout(() => setLogoAlert(null), 3000)
    } catch {
      setLogoAlert({ kind: 'error', msg: t('settingsPage.uploadFailedRetry') })
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
  const [addEmail,     setAddEmail]     = useState('')
  const [addFullName,  setAddFullName]  = useState('')
  const [addPassword,  setAddPassword]  = useState('')
  const [addConfirmPw, setAddConfirmPw] = useState('')
  const [showAddPw,    setShowAddPw]    = useState(false)
  const [adding,       setAdding]       = useState(false)
  const [addError,     setAddError]     = useState<string | null>(null)
  const [addSuccess,   setAddSuccess]   = useState<string | null>(null)

  const newMemberRoleLabel = user?.role === 'bank_admin' ? t('teamPage.role.creditOfficer') : t('teamPage.role.teamMember')

  // ── Bank Accounts tab ─────────────────────────────────────────────────────
  const canWriteAccounts = ['bank_admin', 'org_admin'].includes(user?.role ?? '')
  const [bankAccounts,    setBankAccounts]    = useState<BankAccount[]>([])
  const [baLoading,       setBaLoading]       = useState(false)
  const [baError,         setBaError]         = useState<string | null>(null)
  const [baFormOpen,      setBaFormOpen]      = useState(false)
  const [baEditId,        setBaEditId]        = useState<string | null>(null)
  const [baSaving,        setBaSaving]        = useState(false)
  const [baDeleteId,      setBaDeleteId]      = useState<string | null>(null)
  const [baAlert,         setBaAlert]         = useState<Alert | null>(null)
  const [baShowNum,       setBaShowNum]       = useState(false)
  const [baDraft, setBaDraft] = useState({
    nickname: '', bank_name: '', account_holder_name: '',
    account_number: '', routing_number: '', swift_iban: '',
    account_type: 'checking' as 'checking' | 'savings', is_primary: false,
  })

  const fetchBankAccounts = useCallback(async () => {
    setBaLoading(true)
    setBaError(null)
    try {
      const res  = await fetch('/api/settings/bank-accounts')
      const data = await res.json() as { accounts?: BankAccount[]; error?: string }
      if (!res.ok) { setBaError(data.error ?? t('settingsPage.failedLoadAccounts')); return }
      setBankAccounts(data.accounts ?? [])
    } catch {
      setBaError(t('settingsPage.failedLoadAccounts'))
    } finally {
      setBaLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'bank-accounts' && bankAccounts.length === 0 && !baLoading) {
      fetchBankAccounts()
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  function openAddForm() {
    setBaDraft({ nickname: '', bank_name: '', account_holder_name: '', account_number: '', routing_number: '', swift_iban: '', account_type: 'checking', is_primary: false })
    setBaShowNum(false)
    setBaEditId(null)
    setBaFormOpen(true)
  }

  function openEditForm(acc: BankAccount) {
    setBaDraft({
      nickname: acc.nickname,
      bank_name: acc.bank_name,
      account_holder_name: acc.account_holder_name,
      account_number: acc.account_number,
      routing_number: acc.routing_number,
      swift_iban: acc.swift_iban ?? '',
      account_type: acc.account_type,
      is_primary: acc.is_primary,
    })
    setBaShowNum(false)
    setBaEditId(acc.id)
    setBaFormOpen(true)
  }

  function closeForm() { setBaFormOpen(false); setBaEditId(null) }

  async function saveBankAccount() {
    if (!baDraft.bank_name.trim() || !baDraft.account_number.trim() || !baDraft.routing_number.trim()) {
      setBaAlert({ kind: 'error', msg: t('settingsPage.bankFieldsRequired') })
      return
    }
    setBaSaving(true)
    setBaAlert(null)
    try {
      const method = baEditId ? 'PATCH' : 'POST'
      const url    = baEditId ? `/api/settings/bank-accounts/${baEditId}` : '/api/settings/bank-accounts'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(baDraft) })
      const data   = await res.json() as { account?: BankAccount; error?: string }
      if (!res.ok) { setBaAlert({ kind: 'error', msg: data.error ?? t('settingsPage.failedToSave') }); return }
      await fetchBankAccounts()
      closeForm()
      setBaAlert({ kind: 'info', msg: baEditId ? t('settingsPage.accountUpdated') : t('settingsPage.accountAdded') })
      setTimeout(() => setBaAlert(null), 3000)
    } catch {
      setBaAlert({ kind: 'error', msg: t('common.networkError') })
    } finally {
      setBaSaving(false)
    }
  }

  async function deleteBankAccount(id: string) {
    setBaDeleteId(id)
    try {
      await fetch(`/api/settings/bank-accounts/${id}`, { method: 'DELETE' })
      setBankAccounts(prev => prev.filter(a => a.id !== id))
    } finally {
      setBaDeleteId(null)
    }
  }

  async function setPrimaryAccount(acc: BankAccount) {
    await fetch(`/api/settings/bank-accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...acc, is_primary: true }),
    })
    await fetchBankAccounts()
  }

  // ── ERP Integration tab ────────────────────────────────────────────────────
  const [erpConnection, setErpConnection] = useState<ErpConnection | null>(null)
  const [erpLoading, setErpLoading] = useState(false)
  const [erpAlert, setErpAlert] = useState<Alert | null>(null)
  const [erpSyncing, setErpSyncing] = useState(false)
  const [erpDisconnecting, setErpDisconnecting] = useState(false)
  const [erpCopied, setErpCopied] = useState(false)
  // The raw token is only ever available right after a connect/rotate call
  // (the API response), never on a later GET — cleared on disconnect or
  // navigating away. See ErpConnection's comment above.
  const [newlyIssuedToken, setNewlyIssuedToken] = useState<string | null>(null)
  const [erpProvider, setErpProvider] = useState('erpnext')
  const [erpBaseUrl, setErpBaseUrl] = useState('')
  const [erpApiKey, setErpApiKey] = useState('')
  const [erpApiSecret, setErpApiSecret] = useState('')
  const [erpDbName, setErpDbName] = useState('')
  const [erpConnecting, setErpConnecting] = useState(false)
  const [erpFetched, setErpFetched] = useState(false)

  const fetchErpConnection = useCallback(async () => {
    setErpLoading(true)
    try {
      const res = await fetch('/api/erp/connect')
      const json = await res.json()
      setErpConnection(json.connection)
    } finally {
      setErpLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'erp' && !erpFetched) {
      setErpFetched(true)
      void fetchErpConnection()
    }
  }, [tab, erpFetched, fetchErpConnection])

  async function handleErpConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    setErpConnecting(true)
    setErpAlert(null)
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erp_type: erpProvider, base_url: erpBaseUrl, api_key: erpApiKey, api_secret: erpApiSecret, db_name: erpDbName || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErpAlert({ kind: 'error', msg: json.error ?? t('settingsPage.connectionFailed') })
        return
      }
      setErpAlert({ kind: 'info', msg: t('settingsPage.connectedErpUser', { user: json.erp_user }) })
      setErpBaseUrl(''); setErpApiKey(''); setErpApiSecret(''); setErpDbName('')
      // The connect response is the only place the raw token is ever
      // returned — capture it now, GET never includes it again.
      if (json.dispatch_token) setNewlyIssuedToken(json.dispatch_token)
      await fetchErpConnection()
    } finally {
      setErpConnecting(false)
    }
  }

  async function handleErpSync() {
    setErpSyncing(true)
    setErpAlert(null)
    try {
      const res = await fetch('/api/erp/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setErpAlert({ kind: 'error', msg: json.error ?? t('settingsPage.syncFailed') })
        return
      }
      const errCount = json.errors?.length ?? 0
      setErpAlert({
        kind: errCount > 0 ? 'error' : 'info',
        msg: errCount > 0
          ? t('settingsPage.syncCompletedErrors', { count: errCount, errors: json.errors.join(', ') })
          : t('settingsPage.syncCompleteUpToDate'),
      })
      await fetchErpConnection()
    } finally {
      setErpSyncing(false)
    }
  }

  async function handleErpDisconnect() {
    if (!confirm(t('settingsPage.disconnectErpConfirm'))) return
    setErpDisconnecting(true)
    try {
      await fetch('/api/erp/connect', { method: 'DELETE' })
      setErpConnection(null)
      setNewlyIssuedToken(null)
      setErpAlert({ kind: 'info', msg: t('settingsPage.erpConnectionRemoved') })
    } finally {
      setErpDisconnecting(false)
    }
  }

  function copyErpToken() {
    if (!newlyIssuedToken) return
    void navigator.clipboard.writeText(newlyIssuedToken)
    setErpCopied(true)
    setTimeout(() => setErpCopied(false), 2000)
  }

  const erpStatusColor = erpConnection?.status === 'active'
    ? 'var(--color-green)'
    : erpConnection?.status === 'error'
      ? 'var(--color-red)'
      : 'var(--gray)'

  const fetchTeam = useCallback(async () => {
    setTeamLoading(true)
    setTeamError(null)
    try {
      const res = await fetch('/api/settings/team')
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setTeamError(data.error ?? t('teamPage.failedLoadTeam'))
        return
      }
      const data = await res.json() as { users: TeamMember[]; pending_invitations: PendingInvitation[] }
      setMembers(data.users ?? [])
      setInvitations(data.pending_invitations ?? [])
    } catch {
      setTeamError(t('teamPage.failedLoadTeam'))
    } finally {
      setTeamLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'team' && isAdmin && members.length === 0 && !teamLoading) {
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
        setActionErr(data.error ?? t('settingsPage.failedCancelInvitation'))
        return
      }
      setInvitations(prev => prev.filter(i => i.id !== invId))
    } catch {
      setActionErr(t('settingsPage.failedCancelInvitation'))
    } finally {
      setCancellingId(null)
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
      if (!res.ok) { setAddError(data.error ?? t('teamPage.failedCreateAccount')); return }
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

  return (
    <PortalShell activeSection="settings">
      <Topbar
        crumbs={[
          { label: t('teamPage.settings') },
        ]}
        actions={<NotifBell />}
      />

      <div className="page" data-page-name="Settings" data-ai-context={JSON.stringify({ role: (user as any)?.role, portal, active_tab: tab, team_member_count: members.length, bank_account_count: bankAccounts.length, is_admin: isAdmin })}>
        <div className="page-header">
          <h1 className="t-page-title">{t('teamPage.settings')}</h1>
          <div className="subtitle">{t('settingsPage.subtitle')}</div>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'profile' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('profile')}
          >
            {t('settingsPage.myProfile')}
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
              {t('teamPage.team')}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${tab === 'bank-accounts' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('bank-accounts')}
          >
            {t('settingsPage.bankAccounts')}
          </button>
          {!isBankUser && (
            <button
              type="button"
              className={`btn btn-sm ${tab === 'erp' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('erp')}
              data-demo-target="settings-tab-erp"
            >
              {t('settingsPage.erpIntegration')}
            </button>
          )}
        </div>

        {/* ── Tab: My Profile ── */}
        {tab === 'profile' && (
          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">{t('settingsPage.personalDetails')}</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18, flexShrink: 0 }}>
                  {initials}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.full_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                    {ROLE_LABELS[profile.role] ?? profile.role}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <EditableInput
                  label={t('teamPage.fullName')}
                  value={profile.full_name}
                  onChange={v => setProfile(p => ({ ...p, full_name: v }))}
                />
                <div className="form-field">
                  <label className="form-label">{t('teamPage.email')}</label>
                  <input
                    className="form-input"
                    value={profile.email}
                    readOnly
                    style={{ background: 'var(--offwhite)', color: 'var(--gray)', cursor: 'default' }}
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>
                    {t('settingsPage.contactSupportEmail')}
                  </span>
                </div>
                <div className="form-field">
                  <label className="form-label">{t('teamPage.role')}</label>
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
                  {profileSaving ? t('newListing.saving') : t('settingsPage.saveChanges')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Org / Institution ── */}
        {tab === 'org' && (
          <div className="card">
            <div className="card-head">
              <h3 className="t-card-head">
                {isBankUser ? t('settingsPage.institutionDetails') : t('settingsPage.organizationDetails')}
              </h3>
            </div>
            <div className="card-body">
              {!isAdmin && (
                <div className="alert alert-warn" style={{ marginBottom: 20 }}>
                  <div className="alert-body">
                    {t('settingsPage.contactAdminOrgDetails')}
                  </div>
                </div>
              )}

              {/* Logo upload */}
              <div style={{ marginBottom: 20 }}>
                <label className="form-label">{t('settingsPage.logo')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  {orgProfile.logo_url ? (
                    <img
                      src={orgProfile.logo_url}
                      alt="Logo"
                      style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--offwhite)' }}
                    />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 6, border: '1px dashed var(--border)', background: 'var(--offwhite)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--gray)' }}>
                      {t('settingsPage.noLogo')}
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
                        {logoUploading ? t('settingsPage.uploading') : t('settingsPage.uploadLogo')}
                      </button>
                      <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>{t('settingsPage.logoFileTypes')}</span>
                    </>
                  )}
                </div>
                {logoAlert && <AlertBox alert={logoAlert} />}
              </div>

              {isBankUser ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label={t('settingsPage.legalName')}            value={orgField('legal_name')}            onChange={v => setOrgField('legal_name', v)}            readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.displayName')}          value={orgField('display_name')}          onChange={v => setOrgField('display_name', v)}          readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.website')}              value={orgField('website')}               onChange={v => setOrgField('website', v)}               readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.primaryContactName')}   value={orgField('primary_contact_name')}  onChange={v => setOrgField('primary_contact_name', v)}  readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.primaryContactEmail')}  value={orgField('primary_contact_email')} onChange={v => setOrgField('primary_contact_email', v)} readOnly={!isAdmin} />
                  <div className="kv-row" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <span className="k">{t('settingsPage.routingNumber')}</span>
                    <span className="v">{orgField('routing_number') || '—'}</span>
                  </div>
                  <div className="kv-row" style={{ padding: '10px 0' }}>
                    <span className="k">{t('financing.status')}</span>
                    <span className="v"><span className="badge badge-active">{orgField('status') || t('teamPage.active')}</span></span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <EditableInput label={t('settingsPage.legalName')}          value={orgField('legal_name')}            onChange={v => setOrgField('legal_name', v)}            readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.dbaTradeName')}      value={orgField('doing_business_as')}     onChange={v => setOrgField('doing_business_as', v)}     readOnly={!isAdmin} />
                  <EditableInput label={t('settingsPage.addressLine1')}      value={orgField('address_line1')}         onChange={v => setOrgField('address_line1', v)}         readOnly={!isAdmin} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 12 }}>
                    <EditableInput label={t('settingsPage.city')}  value={orgField('city')}  onChange={v => setOrgField('city', v)}  readOnly={!isAdmin} />
                    <EditableInput label={t('settingsPage.state')} value={orgField('state')} onChange={v => setOrgField('state', v)} readOnly={!isAdmin} />
                    <EditableInput label={t('settingsPage.zip')}   value={orgField('zip')}   onChange={v => setOrgField('zip', v)}   readOnly={!isAdmin} />
                  </div>
                  <EditableInput label={t('settingsPage.primaryContactPhone')} value={orgField('primary_contact_phone')} onChange={v => setOrgField('primary_contact_phone', v)} readOnly={!isAdmin} />
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">{t('settingsPage.ein')}</span>
                      <span className="v">{orgField('ein') ? `**-***${orgField('ein').slice(-4)}` : '—'}</span>
                    </div>
                    <div className="kv-row" style={{ padding: '9px 0' }}>
                      <span className="k">{t('settingsPage.kybStatus')}</span>
                      <span className="v">
                        <span className={`badge ${
                          orgField('kyb_status') === 'approved' ? 'badge-active'
                          : orgField('kyb_status') === 'pending' ? 'badge-pending'
                          : 'badge-draft'
                        }`}>
                          {(orgField('kyb_status') || t('settingsPage.notStarted')).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
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
                    {orgSaving ? t('newListing.saving') : t('settingsPage.saveChanges')}
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
                <h3 className="t-card-head">{t('teamPage.members')}</h3>
                {!teamLoading && !teamError && (
                  <span className="subtitle" style={{ marginLeft: 8 }}>{t('teamPage.memberCount', { count: members.length })}</span>
                )}
              </div>
              {teamLoading ? (
                <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>{t('common.loading')}</div>
              ) : members.length === 0 ? (
                <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)' }}>{t('teamPage.noTeamMembersYet')}</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('teamPage.member')}</th><th>{t('teamPage.role')}</th><th>{t('financing.status')}</th><th>{t('teamPage.joined')}</th><th className="row-actions" />
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
                                <div style={{ fontSize: 12, color: 'var(--gray)' }}>{m.email}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className={roleBadgeClass(m.role)}>{ROLE_LABELS[m.role] ?? m.role}</span></td>
                          <td>
                            {m.is_active
                              ? <span className="badge badge-active">{t('teamPage.active')}</span>
                              : <span className="badge badge-rejected">{t('teamPage.inactive')}</span>}
                          </td>
                          <td className="mono" style={{ color: 'var(--gray)', fontSize: 12 }}>{fmtDate(m.created_at)}</td>
                          <td className="row-actions">
                            {isMe ? (
                              <span className="badge badge-draft">{t('listingDetail.you')}</span>
                            ) : isConfirming ? (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <span style={{ fontSize: 12, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                                  {t('teamPage.deactivateConfirm', { name: m.full_name?.split(' ')[0] ?? t('teamPage.user') })}
                                </span>
                                <button className="btn btn-danger btn-sm" type="button" disabled={isActing} onClick={() => handleToggle(m.id, false)}>
                                  {isActing ? '…' : t('teamPage.confirm')}
                                </button>
                                <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => setConfirmId(null)}>
                                  {t('common.cancel')}
                                </button>
                              </div>
                            ) : m.is_active ? (
                              <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => setConfirmId(m.id)}>
                                {t('teamPage.deactivate')}
                              </button>
                            ) : (
                              <button className="btn btn-ghost btn-sm" type="button" disabled={isActing} onClick={() => handleToggle(m.id, true)}>
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

            {/* Pending invitations */}
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
                    <tr><th>{t('teamPage.email')}</th><th>{t('teamPage.role')}</th><th>{t('teamPage.sent')}</th><th>{t('listingDetail.expires')}</th><th className="row-actions" /></tr>
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
                          <td className="mono" style={{ color: 'var(--gray)', fontSize: 12 }}>{fmtDate(inv.created_at)}</td>
                          <td className="mono" style={{ fontSize: 12, color: expiringSoon ? '#DC2626' : 'var(--gray)' }}>
                            {fmtDate(inv.expires_at)}
                          </td>
                          <td className="row-actions">
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={isCancelling}
                              onClick={() => handleCancelInvite(inv.id)}
                            >
                              {isCancelling ? '…' : t('common.cancel')}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add member form */}
            <div className="card">
              <div className="card-head">
                <h3 className="t-card-head">{t('teamPage.addTeamMember')}</h3>
                <div className="subtitle">{t('teamPage.createAccountHint', { role: newMemberRoleLabel })}</div>
              </div>
              <div className="card-body">
                {addSuccess && (
                  <div className="alert alert-info" style={{ marginBottom: 16 }}>
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
                    <div style={{ flex: 1, minWidth: 200 }}>
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
        )}
        {/* ── Tab: Bank Accounts ── */}
        {tab === 'bank-accounts' && (
          <div>
            {baAlert && <AlertBox alert={baAlert} />}

            {baLoading && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>{t('common.loading')}</div>
            )}

            {baError && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <div className="alert-body">{baError}</div>
              </div>
            )}

            {/* Account cards */}
            {!baLoading && !baFormOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {bankAccounts.length === 0 && !baError && (
                  <div className="card">
                    <div className="card-body" style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--gray)', fontSize: 13 }}>
                      {t('settingsPage.noBankAccountsYet')}
                    </div>
                  </div>
                )}
                {bankAccounts.map(acc => (
                  <div key={acc.id} className="card" style={{ padding: 0 }}>
                    <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 44, height: 44, flexShrink: 0, borderRadius: 'var(--radius-sm)',
                        background: 'var(--blue-light)', color: 'var(--blue)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <rect x="2" y="8" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M6 8V6a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          <path d="M8 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {acc.nickname || acc.bank_name}
                          {acc.is_primary && (
                            <span className="badge" style={{ color: 'var(--blue)', fontSize: 10 }}>{t('financingDetail.primary')}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 3 }}>
                          {acc.bank_name} - {acc.account_type === 'checking' ? t('settingsPage.checking') : t('settingsPage.savings')} - ****{acc.account_number.slice(-4)}
                          {acc.routing_number && ` - ${t('settingsPage.routingSuffix', { last4: acc.routing_number.slice(-4) })}`}
                        </div>
                        {acc.account_holder_name && (
                          <div style={{ fontSize: 12, color: 'var(--gray-soft)', marginTop: 2 }}>{acc.account_holder_name}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canWriteAccounts && !acc.is_primary && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrimaryAccount(acc)}>
                            {t('settingsPage.setPrimary')}
                          </button>
                        )}
                        {canWriteAccounts && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditForm(acc)}>
                            {t('dealDetail.editStep')}
                          </button>
                        )}
                        {canWriteAccounts && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--color-red)' }}
                            disabled={baDeleteId === acc.id}
                            onClick={() => deleteBankAccount(acc.id)}
                          >
                            {baDeleteId === acc.id ? '…' : t('dealDetail.remove')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add / Edit form */}
            {baFormOpen ? (
              <div className="card">
                <div className="card-head">
                  <h3 className="t-card-head">{baEditId ? t('settingsPage.editBankAccount') : t('settingsPage.addBankAccount')}</h3>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="form-label">{t('settingsPage.accountNickname')} <span style={{ fontWeight: 400, color: 'var(--gray)', fontSize: 11 }}>{t('reviewForm.optional')}</span></label>
                      <input className="form-input" value={baDraft.nickname} onChange={e => setBaDraft(d => ({ ...d, nickname: e.target.value }))} placeholder="Operating Account" />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('financingDetail.bank')} {t('settingsPage.name')}</label>
                      <input className="form-input" value={baDraft.bank_name} onChange={e => setBaDraft(d => ({ ...d, bank_name: e.target.value }))} placeholder="Chase" />
                    </div>
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('dealDetail.accountHolder')} {t('settingsPage.name')}</label>
                    <input className="form-input" value={baDraft.account_holder_name} onChange={e => setBaDraft(d => ({ ...d, account_holder_name: e.target.value }))} placeholder="Acme Corp LLC" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="form-label">{t('dealDetail.account')} {t('settingsPage.number')}</label>
                      <div className="input-with-status">
                        <input
                          className="form-input mono"
                          type={baShowNum ? 'text' : 'password'}
                          value={baDraft.account_number}
                          onChange={e => setBaDraft(d => ({ ...d, account_number: e.target.value }))}
                          placeholder="**********"
                        />
                        <button
                          type="button"
                          className="input-status"
                          onClick={() => setBaShowNum(s => !s)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)' }}
                        >
                          {baShowNum ? t('dealDetail.hide') : t('settingsPage.show')}
                        </button>
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('settingsPage.routingNumber')}</label>
                      <input className="form-input mono" value={baDraft.routing_number} onChange={e => setBaDraft(d => ({ ...d, routing_number: e.target.value }))} placeholder="021000021" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-field">
                      <label className="form-label">{t('dealDetail.type')} {t('settingsPage.account')}</label>
                      <select className="form-input form-select" value={baDraft.account_type} onChange={e => setBaDraft(d => ({ ...d, account_type: e.target.value as 'checking' | 'savings' }))}>
                        <option value="checking">{t('settingsPage.checking')}</option>
                        <option value="savings">{t('settingsPage.savings')}</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('dealDetail.swiftIban')} <span style={{ fontWeight: 400, color: 'var(--gray)', fontSize: 11 }}>{t('reviewForm.optional')}</span></label>
                      <input className="form-input mono" value={baDraft.swift_iban} onChange={e => setBaDraft(d => ({ ...d, swift_iban: e.target.value }))} placeholder="CHASUS33 / DE89…" />
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                    <span
                      onClick={() => setBaDraft(d => ({ ...d, is_primary: !d.is_primary }))}
                      style={{
                        width: 38, height: 22, flexShrink: 0,
                        background: baDraft.is_primary ? 'var(--blue)' : 'var(--border)',
                        borderRadius: '999px', position: 'relative', transition: 'background 0.15s',
                      }}
                    >
                      <span style={{ position: 'absolute', top: 2, left: baDraft.is_primary ? 18 : 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: 'left 0.15s' }} />
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>{t('settingsPage.setAsPrimaryAccount')}</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={saveBankAccount} disabled={baSaving}>
                      {baSaving ? t('newListing.saving') : baEditId ? t('settingsPage.updateAccount') : t('settingsPage.addAccount')}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={closeForm}>{t('common.cancel')}</button>
                  </div>
                </div>
              </div>
            ) : (
              canWriteAccounts && (
                <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={openAddForm}>
                  + {t('settingsPage.addBankAccount')}
                </button>
              )
            )}

            {!canWriteAccounts && bankAccounts.length === 0 && !baLoading && (
              <div style={{ fontSize: 13, color: 'var(--gray)', textAlign: 'center', padding: '12px 0' }}>
                {t('settingsPage.contactAdminBankAccounts')}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: ERP Integration ── */}
        {tab === 'erp' && !isBankUser && (
          <div>
            {erpAlert && <AlertBox alert={erpAlert} />}

            {erpLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>{t('common.loading')}</div>
            ) : erpConnection ? (
              /* ── Connected state ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="card" data-demo-target="erp-connection-card">
                  <div className="card-body">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: erpStatusColor }} />
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {ERP_PROVIDERS.find(p => p.id === erpConnection.erp_type)?.label ?? erpConnection.erp_type}
                        </span>
                        <span className={`badge ${erpConnection.status === 'active' ? 'badge-active' : 'badge-rejected'}`}>
                          {erpConnection.status}
                        </span>
                      </div>
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleErpSync()} disabled={erpSyncing}>
                            {erpSyncing ? t('settingsPage.syncing') : t('settingsPage.syncNow')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-red)' }} onClick={() => void handleErpDisconnect()} disabled={erpDisconnecting}>
                            {erpDisconnecting ? t('settingsPage.disconnecting') : t('settingsPage.disconnect')}
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
                      <div>
                        <span style={{ color: 'var(--gray)' }}>{t('settingsPage.url')}</span>
                        <div style={{ color: 'var(--ink)', marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{erpConnection.base_url}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--gray)' }}>{t('settingsPage.lastSynced')}</span>
                        <div style={{ color: 'var(--ink)', marginTop: 2 }}>
                          {erpConnection.last_synced_at ? new Date(erpConnection.last_synced_at).toLocaleString() : t('settingsPage.neverClickSync')}
                        </div>
                      </div>
                    </div>

                    {erpConnection.error_message && (
                      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-red)', background: '#FEE2E2', padding: '8px 12px', borderRadius: 8 }}>
                        {erpConnection.error_message}
                      </div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('settingsPage.dispatchToken')}</h3>
                  </div>
                  <div className="card-body">
                    <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 14px' }}>
                      {t('settingsPage.dispatchTokenHint')}
                    </p>

                    {newlyIssuedToken ? (
                      <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-amber)', background: '#FEF3C7', marginBottom: 12, fontSize: 12.5, color: 'var(--ink)' }}>
                        {t('settingsPage.dispatchTokenShowOnceWarning')}
                      </div>
                    ) : null}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{
                        flex: 1, minWidth: 160, padding: '9px 12px', borderRadius: 'var(--radius-input)',
                        border: '1px solid var(--border)', background: 'var(--offwhite)',
                        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {newlyIssuedToken
                          ? newlyIssuedToken
                          : `${erpConnection.dispatch_token_prefix ?? ''}${'•'.repeat(32)}`}
                      </div>
                      {newlyIssuedToken ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={copyErpToken}>
                          {erpCopied ? t('dealDetail.copied') : t('settingsPage.copy')}
                        </button>
                      ) : null}
                    </div>
                    {erpConnection.dispatch_token_revoked_at ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-red)' }}>{t('settingsPage.dispatchTokenRevoked')}</div>
                    ) : erpConnection.dispatch_token_expires_at ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray)' }}>
                        {t('settingsPage.dispatchTokenExpires', { date: new Date(erpConnection.dispatch_token_expires_at).toLocaleDateString() })}
                      </div>
                    ) : null}

                    <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--offwhite)', borderRadius: 'var(--radius-input)', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', overflowX: 'auto' }}>
                      <div style={{ color: 'var(--gray)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>{t('settingsPage.exampleWebhookPayload')}</div>
                      {`POST https://your-strike-domain.com/api/ai/dispatch\n` +
                       `Authorization: Bearer ${newlyIssuedToken ?? '<your-dispatch-token>'}\n\n` +
                       `{ "message": "Inventory is low on SKU-001, create a listing", "source": "erp_webhook" }`}
                    </div>

                    {newlyIssuedToken ? (
                      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--gray)' }}>
                        {t('settingsPage.orOpenMobileCommand')}{' '}
                        <a href={`/dispatch?token=${newlyIssuedToken}`} target="_blank" style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}>
                          /dispatch?token=…
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('settingsPage.whatStrikeAiCanDo')}</h3>
                  </div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      t('settingsPage.aiCapability1'),
                      t('settingsPage.aiCapability2'),
                      t('settingsPage.aiCapability3'),
                      t('settingsPage.aiCapability4'),
                      t('settingsPage.aiCapability5'),
                    ].map(text => (
                      <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-soft)' }}>
                        <span style={{ color: 'var(--blue)', flexShrink: 0 }}>•</span>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* ── Connect form ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('settingsPage.connectYourErp')}</h3>
                  </div>
                  <div className="card-body">
                    <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 18px' }}>
                      {t('settingsPage.connectErpHint')}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 24 }}>
                      {ERP_PROVIDERS.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={p.disabled}
                          onClick={() => !p.disabled && setErpProvider(p.id)}
                          style={{
                            textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--radius-input)',
                            border: `2px solid ${erpProvider === p.id ? 'var(--blue)' : 'var(--border)'}`,
                            background: erpProvider === p.id ? 'var(--blue-light)' : 'var(--offwhite)',
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

                    {erpProvider === 'erpnext' && isAdmin && (
                      <form onSubmit={(e) => void handleErpConnect(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div className="form-field">
                          <label className="form-label">{t('settingsPage.erpnextSiteUrl')}</label>
                          <input className="form-input" value={erpBaseUrl} onChange={e => setErpBaseUrl(e.target.value)} placeholder="https://your-site.frappe.cloud" required />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div className="form-field">
                            <label className="form-label">{t('settingsPage.apiKey')}</label>
                            <input className="form-input" value={erpApiKey} onChange={e => setErpApiKey(e.target.value)} placeholder="API Key" required />
                          </div>
                          <div className="form-field">
                            <label className="form-label">{t('settingsPage.apiSecret')}</label>
                            <input className="form-input" type="password" value={erpApiSecret} onChange={e => setErpApiSecret(e.target.value)} placeholder="API Secret" required />
                          </div>
                        </div>
                        <div style={{ padding: '12px 14px', background: 'var(--blue-light)', borderRadius: 'var(--radius-input)', fontSize: 12, color: 'var(--blue)' }}>
                          <strong>{t('settingsPage.getCredentials')}</strong> {t('settingsPage.erpnextCredentialsHint')}
                          {t('settingsPage.noAccountSignUp')} <span style={{ fontWeight: 500 }}>frappe.cloud</span>
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={erpConnecting}>
                          {erpConnecting ? t('settingsPage.connecting') : t('settingsPage.connectErpnext')}
                        </button>
                      </form>
                    )}

                    {erpProvider === 'odoo' && isAdmin && (
                      <form onSubmit={(e) => void handleErpConnect(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div className="form-field">
                          <label className="form-label">{t('settingsPage.odooUrl')}</label>
                          <input className="form-input" value={erpBaseUrl} onChange={e => setErpBaseUrl(e.target.value)} placeholder="https://yourcompany.odoo.com" required />
                        </div>
                        <div className="form-field">
                          <label className="form-label">{t('settingsPage.databaseName')} <span style={{ fontWeight: 400, color: 'var(--gray-soft)' }}>{t('settingsPage.autoDetectedHint')}</span></label>
                          <input className="form-input" value={erpDbName} onChange={e => setErpDbName(e.target.value)} placeholder="yourcompany" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div className="form-field">
                            <label className="form-label">{t('settingsPage.emailUsername')}</label>
                            <input className="form-input" type="email" value={erpApiKey} onChange={e => setErpApiKey(e.target.value)} placeholder="you@company.com" required />
                          </div>
                          <div className="form-field">
                            <label className="form-label">{t('settingsPage.apiKeyPassword')}</label>
                            <input className="form-input" type="password" value={erpApiSecret} onChange={e => setErpApiSecret(e.target.value)} placeholder="API Key or password" required />
                          </div>
                        </div>
                        <div style={{ padding: '12px 14px', background: 'var(--blue-light)', borderRadius: 'var(--radius-input)', fontSize: 12, color: 'var(--blue)' }}>
                          <strong>{t('settingsPage.getApiKey')}</strong> {t('settingsPage.odooCredentialsHint')}
                          {t('settingsPage.noAccountSignUp')} <span style={{ fontWeight: 500 }}>odoo.com</span>
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={erpConnecting}>
                          {erpConnecting ? t('settingsPage.connecting') : t('settingsPage.connectOdoo')}
                        </button>
                      </form>
                    )}

                    {!isAdmin && (
                      <div className="alert alert-warn">
                        <div className="alert-body">{t('settingsPage.onlyAdminsConnectErp')}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('settingsPage.whyConnectErp')}</h3>
                  </div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      t('settingsPage.erpBenefit1'),
                      t('settingsPage.erpBenefit2'),
                      t('settingsPage.erpBenefit3'),
                      t('settingsPage.erpBenefit4'),
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
        )}
        </div>
      </div>
    </PortalShell>
  )
}
