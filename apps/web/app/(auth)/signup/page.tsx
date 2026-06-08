'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type RoleChoice = 'anchor' | 'supplier' | 'both' | 'bank'

// Top countries (codes match the onboarding wizard list). Country is the 5th
// signup field; the activation wizard later collects full incorporation detail.
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

// ─── icons ───────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    check:    <path d="M4 8 L7 11 L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    doc:      <><rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M6 6 L10 6 M6 9 L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
    building: <><rect x="3" y="5" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M6 14 L6 10 L10 10 L10 14" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 5 L8 2 L13 5" stroke="currentColor" strokeWidth="1.4" fill="none" /></>,
    bank:     <><rect x="2" y="7" width="12" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M2 7 L8 3 L14 7" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M5 10 L5 14 M8 10 L8 14 M11 10 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
    eye:      <><path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></>,
    eyeOff:   <><path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {paths[name] ?? null}
    </svg>
  )
}

const inputStyle: React.CSSProperties = {
  height: 38, width: '100%', padding: '0 12px',
  border: '1px solid var(--border)',
  background: 'var(--white)',
  fontSize: 13.5, color: 'var(--ink)',
  fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11, fontWeight: 400,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--gray)', marginBottom: 6, display: 'block',
}

const ROLE_CHOICES: { id: RoleChoice; icon: string; title: string; desc: string }[] = [
  { id: 'anchor',   icon: 'building', title: 'Anchor / Buyer',              desc: 'Offer early payment to your suppliers.' },
  { id: 'supplier', icon: 'doc',      title: 'Supplier',                    desc: 'Get paid early on your invoices.' },
  { id: 'both',     icon: 'building', title: 'Both',                        desc: 'Buy from suppliers and sell to buyers.' },
  { id: 'bank',     icon: 'bank',     title: 'Bank or Lender',              desc: 'Underwrite and fund financing.' },
]

// org.type is a binary enum (anchor | supplier). "Both" registers as an anchor
// org (buyer-side) — it can still transact as a supplier on the network.
function roleToOrgType(role: RoleChoice): 'anchor' | 'supplier' | 'bank' {
  if (role === 'bank') return 'bank'
  if (role === 'supplier') return 'supplier'
  return 'anchor' // 'anchor' or 'both'
}

export default function SignupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken    = searchParams.get('invite_token') ?? ''
  const prefillEmail   = searchParams.get('email') ?? ''
  const prefillCompany = searchParams.get('company') ?? ''
  const prefillCountry = searchParams.get('country') ?? ''

  const [role, setRole] = useState<RoleChoice>('supplier')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState(prefillCompany)
  const [country, setCountry] = useState(prefillCountry)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [bankDone, setBankDone] = useState(false)

  // Pre-fill invite fields on mount
  useEffect(() => {
    if (prefillEmail) setEmail(prefillEmail)
    if (prefillCompany) setCompanyName(prefillCompany)
    if (prefillCountry) {
      const found = COUNTRIES.find(c => c.name.toLowerCase() === prefillCountry.toLowerCase() || c.code.toLowerCase() === prefillCountry.toLowerCase())
      if (found) setCountry(found.code)
    }
  }, [prefillEmail, prefillCompany, prefillCountry])

  const isBank = role === 'bank'

  const pwdRules = [
    { label: '8+ characters',    ok: password.length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Number',           ok: /[0-9]/.test(password) },
  ]
  const pwdOk = pwdRules.every(r => r.ok)
  // Bank leads don't create an org, so company/country are optional for them.
  const orgFieldsOk = isBank || (companyName.trim() && country)
  const canSubmit = Boolean(fullName.trim() && email.trim() && pwdOk && orgFieldsOk) && !loading

  async function handleSubmit() {
    setError('')
    if (!fullName.trim() || !email.trim()) {
      setError('Please fill in all fields.')
      return
    }
    if (!isBank && (!companyName.trim() || !country)) {
      setError('Company name and country are required.')
      return
    }
    if (!pwdOk) {
      setError('Password must be 8+ characters with an uppercase letter and a number.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          org_type: roleToOrgType(role),
          company_name: companyName.trim(),
          country,
        }),
      })
      const data = await res.json() as { ok?: boolean; account_type?: string; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Failed to create account.')
        setLoading(false)
        return
      }

      // Bank lead — Strike sets up the account manually, no portal access yet.
      if (data.account_type === 'bank') {
        setBankDone(true)
        setLoading(false)
        return
      }

      // Org user — sign in and drop them straight into the dashboard in GHOST
      // mode (Tier 0). Passport activation (KYB) is now a separate post-signup
      // flow reached from the in-app locked states — NOT a hard gate here.
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        router.push('/login')
        return
      }

      // If signed up via a network invite token, auto-accept the invitation
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
        } catch { /* non-fatal — fall through to dashboard */ }
      }

      router.push('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--offwhite)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--white)',
        border: '1px solid var(--border)',
        padding: 40,
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={180}
            height={54}
            style={{ objectFit: 'contain', objectPosition: 'left center', maxWidth: '100%', height: 'auto' }}
            priority
          />
        </div>

        {bankDone ? (
          /* ── Bank confirmation ───────────────────────────────────────── */
          <div>
            <div style={{
              width: 48, height: 48, marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-green-bg)', color: 'var(--color-green)',
            }}>
              <Icon name="check" size={22} />
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
              letterSpacing: '-0.03em', color: 'var(--ink)', margin: '0 0 8px',
            }}>
              Thanks for registering
            </h1>
            <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, margin: '0 0 24px' }}>
              We&apos;ll be in touch to set up your bank account. A member of the Strike team
              will reach out to {email.trim()} shortly.
            </p>
            <a
              href="/login"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}
            >
              Back to sign in
            </a>
          </div>
        ) : (
          /* ── Registration form ───────────────────────────────────────── */
          <>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
              letterSpacing: '-0.03em', color: 'var(--ink)', margin: '0 0 4px',
            }}>
              Create your account
            </h1>
            <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 24px' }}>
              Get instant access — activate your Passport later to start transacting.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Role */}
              <div>
                <label style={labelStyle}>I am a…</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ROLE_CHOICES.map(t => {
                    const selected = role === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setRole(t.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', textAlign: 'left', width: '100%',
                          border: `1px solid ${selected ? 'var(--blue)' : 'var(--border)'}`,
                          background: selected ? 'var(--color-accent-light)' : 'var(--white)',
                          cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'border-color 0.12s, background 0.12s',
                        }}
                      >
                        <div style={{
                          width: 34, height: 34, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: selected ? 'var(--blue)' : 'var(--offwhite)',
                          color: selected ? 'var(--white)' : 'var(--color-ink-2)',
                        }}>
                          <Icon name={t.icon} size={16} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{t.title}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 1 }}>{t.desc}</div>
                        </div>
                        {selected && <span style={{ color: 'var(--blue)' }}><Icon name="check" size={16} /></span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Full name */}
              <div>
                <label style={labelStyle}>Full name</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="Priya Shah"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>Work email</label>
                <input
                  style={{ ...inputStyle, background: inviteToken && prefillEmail ? 'var(--offwhite)' : undefined }}
                  type="email"
                  placeholder="priya@company.com"
                  value={email}
                  onChange={e => { if (!inviteToken || !prefillEmail) setEmail(e.target.value) }}
                  readOnly={!!(inviteToken && prefillEmail)}
                  autoComplete="email"
                  required
                />
                {inviteToken && prefillEmail && (
                  <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
                    Email is pre-filled from your invitation and cannot be changed.
                  </p>
                )}
              </div>

              {/* Company + country (org accounts only — banks are provisioned by Strike) */}
              {!isBank && (
                <>
                  <div>
                    <label style={labelStyle}>Company name</label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="Acme Corp"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      autoComplete="organization"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Country</label>
                    <select
                      style={{ ...inputStyle, appearance: 'auto' }}
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                    >
                      <option value="">Select country…</option>
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Password */}
              <div>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 40 }}
                    type={showPwd ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-ink-3)', padding: 4, display: 'flex', alignItems: 'center',
                    }}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPwd ? 'eyeOff' : 'eye'} size={14} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
                  {pwdRules.map((r, i) => (
                    <span key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontSize: 11.5, color: r.ok ? 'var(--color-green)' : 'var(--color-ink-4)',
                    }}>
                      <span>{r.ok ? '✓' : '○'}</span>{r.label}
                    </span>
                  ))}
                </div>
              </div>

              {error && (
                <div style={{ fontSize: 12.5, color: 'var(--color-red)' }}>{error}</div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </div>

            <p style={{ marginTop: 20, fontSize: 12.5, color: 'var(--color-ink-4)', textAlign: 'center' }}>
              Already have an account?{' '}
              <a href="/login" style={{ color: 'var(--blue)', fontWeight: 500, textDecoration: 'none' }}>
                Sign in
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
