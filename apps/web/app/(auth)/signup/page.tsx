'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ─── icons (from reference/onboarding.jsx) ───────────────────────────────────
function OBIcon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    check:   <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    doc:     <><rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M6 6 L10 6 M6 9 L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
    building:<><rect x="3" y="5" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M6 14 L6 10 L10 10 L10 14" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 5 L8 2 L13 5" stroke="currentColor" strokeWidth="1.4" fill="none" /></>,
    bank:    <><rect x="2" y="7" width="12" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M2 7 L8 3 L14 7" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M5 10 L5 14 M8 10 L8 14 M11 10 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
    arrow:   <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    info:    <><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M8 7 L8 11 M8 5.5 L8 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
    eye:     <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></>,
    eyeOff:  <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {paths[name] ?? null}
    </svg>
  )
}

// ─── stepper ─────────────────────────────────────────────────────────────────
interface Step { label: string; sub?: string }

function OBStepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 0 8px' }}>
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 20px',
            borderLeft: `2px solid ${active ? 'var(--color-accent, #0A1FB8)' : 'transparent'}`,
            background: active ? 'rgba(10,31,184,0.05)' : 'transparent',
            borderRadius: '0 6px 6px 0',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
              background: done ? 'var(--color-green, #1A6B42)' : active ? 'var(--color-accent, #0A1FB8)' : 'var(--color-bg-2, #EFEDE8)',
              color: done || active ? 'white' : 'var(--color-ink-4, #9C9890)',
              border: done || active ? 'none' : '1.5px solid var(--color-border, #E2DFD8)',
            }}>
              {done ? <OBIcon name="check" size={12} /> : i + 1}
            </div>
            <div>
              <div style={{
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                color: active ? 'var(--color-ink-1, #0F0F0F)' : done ? 'var(--color-ink-2, #3D3C3A)' : 'var(--color-ink-3, #6B6963)',
              }}>{step.label}</div>
              {step.sub && (
                <div style={{ fontSize: 11, color: 'var(--color-ink-4, #9C9890)', marginTop: 1 }}>{step.sub}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── shell (left rail + content) ─────────────────────────────────────────────
function OBShell({ steps, current, children }: {
  steps: Step[]
  current: number
  children: React.ReactNode
}) {
  return (
    <div data-theme="light" style={{
      position: 'fixed', inset: 0,
      display: 'grid', gridTemplateColumns: '280px 1fr',
      background: 'var(--color-bg, #F7F6F3)',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    }}>
      {/* Left rail */}
      <div style={{
        background: 'white',
        borderRight: '1px solid var(--color-border, #E2DFD8)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{
          padding: '16px 12px 12px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={130}
            height={42}
            style={{
              objectFit: 'contain',
              objectPosition: 'left center',
              maxWidth: '100%',
              height: 'auto',
            }}
            priority
          />
        </div>
        {/* Steps */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 16 }}>
          <OBStepper steps={steps} current={current} />
        </div>
        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--color-border, #E2DFD8)',
          fontSize: 11, color: 'var(--color-ink-4)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <OBIcon name="info" size={13} />
          <span>Your data is encrypted and never shared without consent.</span>
        </div>
      </div>

      {/* Content */}
      <div style={{
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '48px 40px',
      }}>
        <div style={{ width: '100%', maxWidth: 600 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── shared input style ───────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  height: 38, padding: '0 12px', borderRadius: 6,
  border: '1.5px solid var(--color-border, #E2DFD8)',
  background: 'white',
  fontSize: 13.5, color: 'var(--color-ink-1)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s', fontFamily: 'inherit',
}

// ─── step 0: role picker (StepWelcome from reference) ────────────────────────
function StepWelcome({ role, setRole, onNext }: {
  role: string
  setRole: (r: string) => void
  onNext: () => void
}) {
  const roles = [
    { id: 'supplier', icon: 'doc',      title: 'Supplier',       desc: 'Get paid early on your invoices.' },
    { id: 'anchor',   icon: 'building', title: 'Anchor / Buyer', desc: 'Offer early payment to your suppliers.' },
    { id: 'bank',     icon: 'bank',     title: 'Bank / Lender',  desc: 'Underwrite and fund SCF programs.' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 16 }}>
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={120}
            height={38}
            style={{ objectFit: 'contain', objectPosition: 'left center' }}
            priority
          />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--color-ink-1)', margin: 0, lineHeight: 1.15 }}>
          Let&apos;s get you set up.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-ink-3)', marginTop: 10, lineHeight: 1.6 }}>
          Choose your role to create your account. Program setup and user invites happen inside the platform once you&apos;re approved.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {roles.map(r => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '16px 20px', borderRadius: 10, textAlign: 'left',
              border: `2px solid ${role === r.id ? '#1B3BE8' : 'var(--color-border, #E2DFD8)'}`,
              background: role === r.id ? '#1B3BE8' : 'white',
              cursor: 'pointer', transition: 'all 0.12s', width: '100%',
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              background: role === r.id ? 'rgba(255,255,255,0.12)' : 'var(--color-bg-2, #EFEDE8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: role === r.id ? 'white' : 'var(--color-ink-2)',
            }}>
              <OBIcon name={r.icon} size={18} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: role === r.id ? 'white' : 'var(--color-ink-1)' }}>
                {r.title}
              </div>
              <div style={{ fontSize: 12.5, color: role === r.id ? 'rgba(255,255,255,0.65)' : 'var(--color-ink-3)', marginTop: 2 }}>
                {r.desc}
              </div>
            </div>
            {role === r.id && (
              <div style={{ marginLeft: 'auto', color: 'white' }}>
                <OBIcon name="check" size={16} />
              </div>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 32 }}>
        <button
          type="button"
          onClick={onNext}
          style={{
            height: 40, padding: '0 24px', borderRadius: 7, fontSize: 14, fontWeight: 600,
            background: '#1B3BE8', color: 'white',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'inherit',
          }}
        >
          Continue <OBIcon name="arrow" size={14} />
        </button>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--color-ink-4)' }}>
        Already have an account?{' '}
        <a href="/login" style={{ color: 'var(--color-accent, #0A1FB8)', fontWeight: 500, textDecoration: 'none' }}>
          Sign in
        </a>
      </p>
    </div>
  )
}

// ─── step 1: account form (StepAccount from reference, wired to Supabase) ────
function StepAccount({ role, onBack }: { role: string; onBack: () => void }) {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const pwdRules = [
    { label: '8+ characters',     ok: password.length >= 8 },
    { label: 'Uppercase letter',  ok: /[A-Z]/.test(password) },
    { label: 'Number',            ok: /[0-9]/.test(password) },
    { label: 'Special character', ok: /[^a-zA-Z0-9]/.test(password) },
  ]
  const allRulesOk = pwdRules.every(r => r.ok)
  const pwdMatch = password === confirmPassword

  async function handleSubmit() {
    setError('')
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('Please fill in all required fields.')
      return
    }
    if (!allRulesOk) {
      setError('Password does not meet all requirements.')
      return
    }
    if (!pwdMatch) {
      setError("Passwords don't match.")
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: `${firstName} ${lastName}`.trim(),
          role: role === 'supplier' ? 'supplier_admin' : role === 'anchor' ? 'anchor_admin' : 'bank_admin',
        },
      },
    })
    setLoading(false)
    if (authError) {
      setError(authError.message)
    } else {
      router.push('/onboarding')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-ink-1)', margin: 0 }}>
          Create your account
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--color-ink-3)', marginTop: 6, lineHeight: 1.6 }}>
          You&apos;ll use this to sign in to Strike SCF.
        </p>
      </div>

      <div style={{
        background: 'white',
        border: '1.5px solid var(--color-border, #E2DFD8)',
        borderRadius: 10, padding: 24,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* First / Last name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>First name</label>
              <input
                style={inputStyle}
                placeholder="Priya"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>Last name</label>
              <input
                style={inputStyle}
                placeholder="Shah"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          </div>

          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>Work email</label>
            <input
              style={inputStyle}
              type="email"
              placeholder="priya@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
            />
            <div style={{ fontSize: 11.5, color: 'var(--color-ink-3)' }}>Use your company email address.</div>
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 38 }}
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-ink-3)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <OBIcon name={showPwd ? 'eyeOff' : 'eye'} size={14} />
              </button>
            </div>
          </div>

          {/* Password rules */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pwdRules.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11.5, color: r.ok ? 'var(--color-green, #1A6B42)' : 'var(--color-ink-4)',
              }}>
                <span>{r.ok ? '✓' : '○'}</span>
                <span>{r.label}</span>
              </div>
            ))}
          </div>

          {/* Confirm password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-1)' }}>Confirm password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 38 }}
                type={showConfirm ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-ink-3)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <OBIcon name={showConfirm ? 'eyeOff' : 'eye'} size={14} />
              </button>
            </div>
            {confirmPassword && !pwdMatch && (
              <div style={{ fontSize: 11.5, color: 'var(--color-red, #B42318)' }}>
                Passwords don&apos;t match
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-red, #B42318)' }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 32 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            height: 40, padding: '0 24px', borderRadius: 7, fontSize: 14, fontWeight: 600,
            background: '#1B3BE8', color: 'white',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            opacity: loading ? 0.7 : 1, fontFamily: 'inherit',
          }}
        >
          {loading ? 'Creating account…' : 'Create account'}
          {!loading && <OBIcon name="arrow" size={14} />}
        </button>
        <button
          type="button"
          onClick={onBack}
          style={{
            height: 40, padding: '0 18px', borderRadius: 7, fontSize: 13.5,
            background: 'transparent', color: 'var(--color-ink-3)',
            border: '1.5px solid var(--color-border, #E2DFD8)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ← Back
        </button>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--color-ink-4)' }}>
        Already have an account?{' '}
        <a href="/login" style={{ color: 'var(--color-accent, #0A1FB8)', fontWeight: 500, textDecoration: 'none' }}>
          Sign in
        </a>
      </p>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────
const SIGNUP_STEPS: Step[] = [
  { label: 'Welcome', sub: 'Choose your role' },
  { label: 'Account', sub: 'Email & password' },
]

export default function SignupPage() {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('supplier')

  return (
    <OBShell steps={SIGNUP_STEPS} current={step}>
      {step === 0 && (
        <StepWelcome
          role={role}
          setRole={setRole}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <StepAccount
          role={role}
          onBack={() => setStep(0)}
        />
      )}
    </OBShell>
  )
}
