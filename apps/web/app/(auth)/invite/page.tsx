'use client'
import React, { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface InvitationInfo {
  email: string
  role: string
  expires_at: string
  bank_id: string | null
  anchor_org_id: string | null
  program_id: string | null
}

const ROLE_LABELS: Record<string, string> = {
  anchor:              'Anchor / Buyer',
  supplier:            'Supplier',
  bank_credit_officer: 'Credit Officer',
}

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: met ? 'var(--color-green)' : 'var(--color-ink-4)' }}>
      <span style={{ fontSize: 11 }}>{met ? '✓' : '○'}</span>
      {label}
    </div>
  )
}

function InvitePageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [checking,    setChecking]    = useState(true)
  const [valid,       setValid]       = useState(false)
  const [expiredMsg,  setExpiredMsg]  = useState('')
  const [invitation,  setInvitation]  = useState<InvitationInfo | null>(null)

  const [fullName,   setFullName]   = useState('')
  const [password,   setPassword]   = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const checkToken = useCallback(async () => {
    if (!token) {
      setValid(false)
      setExpiredMsg('No invitation token provided.')
      setChecking(false)
      return
    }
    try {
      const res  = await fetch(`/api/invitations/${token}`)
      const data = await res.json() as {
        valid: boolean
        reason?: string
        invitation?: InvitationInfo
      }
      if (!data.valid) {
        setValid(false)
        setExpiredMsg(
          data.reason === 'expired'
            ? 'This invitation has expired.'
            : 'This invitation is invalid or has already been used.'
        )
      } else {
        setValid(true)
        setInvitation(data.invitation ?? null)
      }
    } catch {
      setValid(false)
      setExpiredMsg('Failed to validate invitation.')
    } finally {
      setChecking(false)
    }
  }, [token])

  useEffect(() => { checkToken() }, [checkToken])

  const pwLong      = password.length >= 8
  const pwUpper     = /[A-Z]/.test(password)
  const pwNumber    = /[0-9]/.test(password)
  const pwMatch     = password === confirmPw && confirmPw.length > 0
  const pwValid     = pwLong && pwUpper && pwNumber

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !pwValid || !pwMatch) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/invitations/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim(), password }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setSubmitError(data.error ?? 'Failed to create account')
        return
      }

      // Auto sign in
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: invitation!.email,
        password,
      })

      if (signInError) {
        setSubmitError('Account created — please sign in manually.')
        router.push('/login')
        return
      }

      router.push('/onboarding?from=invite')
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ color: 'var(--color-ink-3)', fontSize: 14 }}>Checking invitation…</div>
      </div>
    )
  }

  if (!valid) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: 24 }}>
        <div className="card" style={{ maxWidth: 420, width: '100%', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--color-ink-1)' }}>
            Invitation unavailable
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-ink-3)', marginBottom: 24 }}>
            {expiredMsg}
          </p>
          <a
            href="/signup"
            className="btn btn-primary"
            style={{ display: 'inline-block' }}
          >
            Create a new account
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div className="card-head" style={{ textAlign: 'center', paddingBottom: 0 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>👋</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--color-ink-1)' }}>
            You&apos;ve been invited to Strike SCF
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-ink-3)', marginBottom: 0 }}>
            Set up your account to get started
          </p>
          {invitation && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-draft">{invitation.email}</span>
              <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                You&apos;re joining as:{' '}
                <strong style={{ color: 'var(--color-ink-2)' }}>
                  {ROLE_LABELS[invitation.role] ?? invitation.role}
                </strong>
              </span>
            </div>
          )}
        </div>

        <div className="card-body">
          {submitError && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <div className="alert-body">{submitError}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Email — read-only */}
            <div>
              <label className="field-label" htmlFor="inv-email">Email</label>
              <input
                id="inv-email"
                className="input"
                type="email"
                value={invitation?.email ?? ''}
                readOnly
                style={{ background: 'var(--color-card)', color: 'var(--color-ink-3)', cursor: 'default' }}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="inv-name">Full name</label>
              <input
                id="inv-name"
                className="input"
                type="text"
                placeholder="Jane Smith"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="field-label" htmlFor="inv-pw">Password</label>
              <input
                id="inv-pw"
                className="input"
                type="password"
                placeholder="Choose a strong password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="inv-pw2">Confirm password</label>
              <input
                id="inv-pw2"
                className="input"
                type="password"
                placeholder="Re-enter password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required
              />
            </div>

            {/* Password rules */}
            {password.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}>
                <PasswordRule met={pwLong}   label="At least 8 characters" />
                <PasswordRule met={pwUpper}  label="One uppercase letter" />
                <PasswordRule met={pwNumber} label="One number" />
                <PasswordRule met={pwMatch}  label="Passwords match" />
              </div>
            )}

            <button
              className="btn btn-primary btn-full"
              type="submit"
              disabled={submitting || !fullName.trim() || !pwValid || !pwMatch}
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ color: 'var(--color-ink-3)', fontSize: 14 }}>Loading…</div>
      </div>
    }>
      <InvitePageContent />
    </Suspense>
  )
}
