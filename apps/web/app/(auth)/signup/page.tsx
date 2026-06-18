'use client'

import { useState, useEffect, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RoleChoice = 'anchor' | 'supplier'

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'IE', name: 'Ireland' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
]

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      {off ? (
        <>
          <path d="M2 8C4 4 12 4 14 8" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M3 13L13 3" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M2 8C4 4 12 4 14 8C12 12 4 12 2 8" stroke="currentColor" strokeWidth={1.4} fill="none" />
          <circle cx={8} cy={8} r={2} stroke="currentColor" strokeWidth={1.4} />
        </>
      )}
    </svg>
  )
}

const ROLE_CHOICES: { id: RoleChoice; title: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: 'anchor',
    title: 'Buyer / Anchor',
    desc: 'Offer early payment to your suppliers.',
    icon: (
      <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="6" width="14" height="10" rx="1.5" />
        <path d="M3 6l7-3.5 7 3.5" />
        <path d="M8 16v-4h4v4" />
      </svg>
    ),
  },
  {
    id: 'supplier',
    title: 'Supplier',
    desc: 'Get paid early on your invoices.',
    icon: (
      <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="3" width="10" height="14" rx="1.5" />
        <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
      </svg>
    ),
  },
]

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken    = searchParams.get('invite_token') ?? ''
  const prefillEmail   = searchParams.get('email') ?? ''
  const prefillCompany = searchParams.get('company') ?? ''
  const prefillCountry = searchParams.get('country') ?? ''

  const [role, setRole]               = useState<RoleChoice>('supplier')
  const [fullName, setFullName]       = useState('')
  const [email, setEmail]             = useState(prefillEmail)
  const [password, setPassword]       = useState('')
  const [companyName, setCompanyName] = useState(prefillCompany)
  const [country, setCountry]         = useState(prefillCountry)
  const [showPwd, setShowPwd]         = useState(false)
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    if (prefillEmail)   setEmail(prefillEmail)
    if (prefillCompany) setCompanyName(prefillCompany)
    if (prefillCountry) {
      const found = COUNTRIES.find(c =>
        c.name.toLowerCase() === prefillCountry.toLowerCase() ||
        c.code.toLowerCase() === prefillCountry.toLowerCase()
      )
      if (found) setCountry(found.code)
    }
  }, [prefillEmail, prefillCompany, prefillCountry])

  const pwdRules = [
    { label: '8+ characters',    ok: password.length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Number',           ok: /[0-9]/.test(password) },
  ]
  const pwdOk      = pwdRules.every(r => r.ok)
  const canSubmit  = Boolean(fullName.trim() && email.trim() && pwdOk && companyName.trim() && country) && !loading

  async function handleSubmit() {
    setError('')
    if (!fullName.trim() || !email.trim() || !companyName.trim() || !country) {
      setError('Please fill in all fields.')
      return
    }
    if (!pwdOk) {
      setError('Password must be 8+ characters with an uppercase letter and a number.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name:    fullName.trim(),
          email:        email.trim(),
          password,
          org_type:     role,
          company_name: companyName.trim(),
          country,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Failed to create account.')
        setLoading(false)
        return
      }

      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        router.push('/login')
        return
      }

      // Invite token — auto-accept and go to dashboard
      if (inviteToken) {
        try {
          const inviteRes = await fetch(`/api/invite/${inviteToken}/accept`, { method: 'POST' })
          if (inviteRes.ok) {
            const inviteData = await inviteRes.json()
            const msg = inviteData.anchor_name && inviteData.network_name
              ? `?welcome_network=${encodeURIComponent(inviteData.network_name)}&welcome_anchor=${encodeURIComponent(inviteData.anchor_name)}`
              : ''
            router.push(`/dashboard${msg}`)
            return
          }
        } catch { /* non-fatal */ }
      }

      router.push('/onboarding')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="login-v2-shell" style={{ fontFamily: 'var(--font-body)' }}>
      {/* Left brand panel */}
      <div className="login-v2-brand">
        <div aria-hidden="true" style={{
          position: 'absolute', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(20,40,204,0.28) 0%, transparent 65%)',
          top: -200, right: -200, pointerEvents: 'none',
          animation: 'auth-orb-drift 22s ease-in-out infinite',
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 65%)',
          bottom: -120, left: -100, pointerEvents: 'none',
          animation: 'auth-orb-drift 28s ease-in-out infinite reverse',
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <Image
            src="/strike_white_nobg.png"
            alt="Strike SCF"
            width={140}
            height={40}
            style={{ objectFit: 'contain', objectPosition: 'left center', height: 'auto' }}
            priority
          />
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 36, fontWeight: 700,
            letterSpacing: '-0.03em',
            color: '#fff',
            lineHeight: 1.15,
            margin: '0 0 16px',
          }}>
            Start transacting<br/>in minutes.
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 0 36px', maxWidth: 320 }}>
            Create your account, activate your Passport, and start financing deals on the same day.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {([
              ['Free to join', 'No setup fees. Activate when you\'re ready to transact.'],
              ['AI-powered onboarding', 'Smart document extraction speeds up your KYB process.'],
              ['Instant deal access', 'Connect with anchors and banks in your first week.'],
            ] as const).map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: '1.5px solid rgba(255,255,255,0.25)',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 1,
                }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, fontSize: 12, color: 'rgba(255,255,255,0.28)', lineHeight: 1.6 }}>
          © 2026 Strike SCF · Trusted by leading banks and corporations
        </div>
      </div>

      {/* Right form panel */}
      <div className="login-v2-card">
        <div className="login-v2-card-inner" style={{ maxWidth: 460 }}>
      <style>{`
        @keyframes su-shimmer {
          0%   { transform: translateX(-120%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(120%); }
        }
        .su-role-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1.5px solid var(--border);
          background: var(--white);
          cursor: pointer;
          text-align: left;
          width: 100%;
          font-family: inherit;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .su-role-card:hover {
          border-color: rgba(20,40,204,0.35);
          box-shadow: 0 2px 12px rgba(20,40,204,0.08);
        }
        .su-role-card.selected {
          border-color: var(--blue);
          background: var(--blue-light);
          box-shadow: 0 2px 16px rgba(20,40,204,0.12);
        }
        .su-input {
          height: 44px;
          width: 100%;
          padding: 0 14px;
          border: 1.5px solid var(--border);
          border-radius: var(--radius-input);
          background: var(--white);
          font-size: 13.5px;
          color: var(--ink);
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .su-input:focus {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(20,40,204,0.1);
        }
        .su-input[readonly] { background: var(--offwhite); }
        .su-select { appearance: auto; }
        .su-label {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--gray);
          margin-bottom: 7px;
          display: block;
        }
        .su-submit {
          position: relative;
          width: 100%;
          height: 46px;
          border: none;
          border-radius: var(--radius-button);
          background: linear-gradient(135deg, #1428CC 0%, #7C3AED 100%);
          color: #fff;
          font-size: 14px;
          font-weight: 650;
          font-family: var(--font-display);
          letter-spacing: 0.01em;
          cursor: pointer;
          overflow: hidden;
          box-shadow: 0 4px 18px rgba(20,40,204,0.28);
          transition: box-shadow 0.2s, opacity 0.15s;
        }
        .su-submit::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.16) 50%, transparent 75%);
          transform: translateX(-120%);
          animation: su-shimmer 3.5s ease-in-out infinite;
          pointer-events: none;
        }
        .su-submit:hover:not(:disabled) { box-shadow: 0 6px 26px rgba(124,58,237,0.4); }
        .su-submit:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>

        {/* Heading */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{
            fontFamily:    'var(--font-display)',
            fontSize:      24,
            fontWeight:    700,
            letterSpacing: '-0.03em',
            color:         'var(--ink)',
            margin:        '0 0 6px',
          }}>
            Create your account
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', margin: 0, lineHeight: 1.55 }}>
            Join Strike SCF — activate your Passport later to start transacting.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Role */}
          <div>
            <span className="su-label">I am a…</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {ROLE_CHOICES.map(t => {
                const sel = role === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRole(t.id)}
                    className={`su-role-card${sel ? ' selected' : ''}`}
                  >
                    <div style={{
                      width: 38, height: 38, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 10,
                      background: sel
                        ? 'linear-gradient(135deg, #1428CC 0%, #7C3AED 100%)'
                        : 'var(--offwhite)',
                      color:      sel ? '#fff' : 'var(--gray)',
                      transition: 'background 0.15s, color 0.15s',
                    }}>
                      {t.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2, lineHeight: 1.4 }}>{t.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Full name */}
          <div>
            <label className="su-label">Full name</label>
            <input
              className="su-input"
              type="text"
              placeholder="Priya Shah"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>

          {/* Work email */}
          <div>
            <label className="su-label">Work email</label>
            <input
              className="su-input"
              type="email"
              placeholder="priya@company.com"
              value={email}
              onChange={e => { if (!inviteToken || !prefillEmail) setEmail(e.target.value) }}
              readOnly={!!(inviteToken && prefillEmail)}
              autoComplete="email"
            />
            {inviteToken && prefillEmail && (
              <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 5 }}>
                Email is pre-filled from your invitation and cannot be changed.
              </p>
            )}
          </div>

          {/* Company + country */}
          <div>
            <label className="su-label">Company name</label>
            <input
              className="su-input"
              type="text"
              placeholder="Acme Corp"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              autoComplete="organization"
            />
          </div>

          <div>
            <label className="su-label">Country</label>
            <select
              className="su-input su-select"
              value={country}
              onChange={e => setCountry(e.target.value)}
            >
              <option value="">Select country…</option>
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="su-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="su-input"
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                <EyeIcon off={showPwd} />
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 9 }}>
              {pwdRules.map((r, i) => (
                <span key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11.5,
                  color: r.ok ? 'var(--color-green)' : 'var(--gray-soft)',
                  transition: 'color 0.15s',
                }}>
                  <span style={{ fontSize: 12 }}>{r.ok ? '✓' : '○'}</span>
                  {r.label}
                </span>
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              fontSize: 12.5, color: 'var(--color-red)',
              background: 'var(--color-red-bg, #FEE2E2)', borderRadius: 8,
              padding: '10px 12px', lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="su-submit"
          >
            {loading ? 'Creating account…' : 'Create account →'}
          </button>
        </div>

        <p style={{ marginTop: 22, fontSize: 12.5, color: 'var(--gray)', textAlign: 'center' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </a>
        </p>

        {/* Divider + bank note */}
        <div style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          fontSize: 11.5,
          color: 'var(--gray-soft)',
          textAlign: 'center',
          lineHeight: 1.5,
        }}>
          Are you a bank or lender?{' '}
          <a href="mailto:banks@strikescf.com" style={{ color: 'var(--blue)', textDecoration: 'none' }}>
            Contact us
          </a>
          {' '}to get set up.
        </div>
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupPageInner />
    </Suspense>
  )
}
