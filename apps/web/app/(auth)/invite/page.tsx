'use client'
import React, { useEffect, useState, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface InvitationInfo {
  email: string
  role: string
  bank_id: string
  anchor_org_id?: string
  program_id?: string
  invitation_mode: 'standard' | 'known_counterparty' | 'custom_kyb'
  prefilled_kyb?: Record<string, string>
  required_documents?: Array<{ id: string; label: string }>
  invitee_name?: string
}

const ROLE_LABELS: Record<string, string> = {
  anchor:              'Anchor / Buyer',
  supplier:            'Supplier',
  bank_credit_officer: 'Credit Officer',
}

const inputStyle: React.CSSProperties = {
  height: 40,
  width: '100%',
  padding: '0 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--offwhite)',
  fontSize: 13.5,
  color: 'var(--ink)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 120ms ease',
}

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: met ? '#16a34a' : 'var(--gray)' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{met ? '✓' : '○'}</span>
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

  const [fullName,    setFullName]    = useState('')
  const [password,    setPassword]    = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
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
        setFullName(data.invitation?.invitee_name ?? '')
      }
    } catch {
      setValid(false)
      setExpiredMsg('Failed to validate invitation.')
    } finally {
      setChecking(false)
    }
  }, [token])

  useEffect(() => { checkToken() }, [checkToken])

  const pwLong   = password.length >= 8
  const pwUpper  = /[A-Z]/.test(password)
  const pwNumber = /[0-9]/.test(password)
  const pwMatch  = password === confirmPw && confirmPw.length > 0
  const pwValid  = pwLong && pwUpper && pwNumber

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

      sessionStorage.setItem('invitation_mode', invitation!.invitation_mode)
      if (invitation!.prefilled_kyb) {
        sessionStorage.setItem('prefilled_kyb', JSON.stringify(invitation!.prefilled_kyb))
      }
      if (invitation!.required_documents) {
        sessionStorage.setItem('required_documents', JSON.stringify(invitation!.required_documents))
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--offwhite)' }}>
        <div style={{ color: 'var(--gray)', fontSize: 14 }}>Checking invitation…</div>
      </div>
    )
  }

  if (!valid) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--offwhite)', padding: 24 }}>
        <div style={{
          maxWidth: 420, width: '100%',
          background: 'var(--offwhite)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          padding: 40,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Invitation unavailable
          </h2>
          <p style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 28, lineHeight: 1.6 }}>
            {expiredMsg}
          </p>
          <a
            href="/login"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              borderRadius: 7,
              background: '#0F0F0F',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              fontFamily: 'inherit',
            }}
          >
            Go to sign in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--offwhite)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    }}>
      <div style={{
        width: '100%', maxWidth: 460,
        background: 'var(--offwhite)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: 40,
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={200}
            height={60}
            style={{ objectFit: 'contain', objectPosition: 'left center', maxWidth: '100%', height: 'auto' }}
            priority
          />
        </div>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)', margin: '0 0 6px' }}>
            You&apos;ve been invited
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', margin: 0 }}>
            Set up your account to join Strike SCF.
          </p>
        </div>

        {/* Invitation info banner */}
        {invitation && (
          <div style={{
            background: 'var(--offwhite)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 24,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Invitation for
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
              {invitation.email}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>
              Role: <strong style={{ color: 'var(--ink)' }}>{ROLE_LABELS[invitation.role] ?? invitation.role}</strong>
            </div>
          </div>
        )}

        {/* Mode-specific banners */}
        {invitation?.invitation_mode === 'known_counterparty' && (
          <div style={{
            background: 'rgba(5,150,105,0.08)',
            border: '1px solid rgba(5,150,105,0.3)',
            padding: '10px 14px',
            marginBottom: 16,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: '#059669',
          }}>
            ✓ Your organization details have been pre-filled. Just create your credentials to access the platform — no KYB required.
          </div>
        )}
        {invitation?.invitation_mode === 'custom_kyb' && (
          <div style={{
            background: 'rgba(0,82,255,0.05)',
            border: '1px solid rgba(0,82,255,0.2)',
            padding: '10px 14px',
            marginBottom: 16,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--blue)',
          }}>
            Your bank has specified the documents required for your onboarding. You&apos;ll be guided through the process after creating your account.
          </div>
        )}

        {/* Error */}
        {submitError && (
          <div style={{
            background: 'rgba(180,35,24,0.06)',
            border: '1px solid rgba(180,35,24,0.2)',
            borderRadius: 7,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 13,
            color: '#B42318',
          }}>
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email read-only */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Email</label>
            <input
              style={{ ...inputStyle, background: 'var(--offwhite)', color: 'var(--gray)', cursor: 'default' }}
              type="email"
              value={invitation?.email ?? ''}
              readOnly
            />
          </div>

          {/* Full name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Full name</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="Jane Smith"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 42 }}
                type={showPw ? 'text' : 'password'}
                placeholder="Choose a strong password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  {showPw
                    ? <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>
                    : <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></>
                  }
                </svg>
              </button>
            </div>
          </div>

          {/* Password rules */}
          {password.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', padding: '4px 0' }}>
              <PasswordRule met={pwLong}   label="8+ characters" />
              <PasswordRule met={pwUpper}  label="Uppercase letter" />
              <PasswordRule met={pwNumber} label="One number" />
            </div>
          )}

          {/* Confirm password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Confirm password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 42 }}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  {showConfirm
                    ? <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>
                    : <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></>
                  }
                </svg>
              </button>
            </div>
            {confirmPw.length > 0 && !pwMatch && (
              <div style={{ fontSize: 12, color: '#B42318' }}>Passwords don&apos;t match</div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !fullName.trim() || !pwValid || !pwMatch}
            style={{
              width: '100%', height: 42, borderRadius: 7,
              background: '#0F0F0F', color: 'white',
              border: 'none', cursor: submitting || !fullName.trim() || !pwValid || !pwMatch ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              opacity: submitting || !fullName.trim() || !pwValid || !pwMatch ? 0.55 : 1,
              marginTop: 4,
            }}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div style={{ height: 1, background: 'var(--border)', margin: '20px 0 16px' }} />

        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0, textAlign: 'center' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: '#0A1FB8', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--offwhite)' }}>
        <div style={{ color: 'var(--gray)', fontSize: 14 }}>Loading…</div>
      </div>
    }>
      <InvitePageContent />
    </Suspense>
  )
}
