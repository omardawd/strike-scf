'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function EyeIcon({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 8 C4 4 12 4 14 8" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8 C4 4 12 4 14 8 C12 12 4 12 2 8" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setLoading(false)
      setError(authError.message)
      return
    }

    try {
      const res = await fetch('/api/onboarding/status')
      if (res.ok) {
        const { org_id, org_status } = await res.json() as {
          org_id: string | null
          org_status: string | null
        }
        if (org_id) {
          if (org_status === 'rejected' || org_status === 'suspended') {
            await supabase.auth.signOut()
            setLoading(false)
            setError('Your account is not active. Please contact support.')
            return
          }
          if (org_status !== 'active') {
            router.push('/onboarding')
            return
          }
        }
      }
    } catch {
      // Non-fatal — fall through to dashboard
    }

    router.push('/dashboard')
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
            Supply chain<br/>finance,<br/>reimagined.
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 0 36px', maxWidth: 320 }}>
            From invoice submission to early payment — Strike automates the entire SCF workflow.
          </p>
          <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {([
              ['Get paid early', 'Submit invoices and receive advances in days, not weeks.'],
              ['AI-powered intelligence', 'Smart risk scoring and recommendations at every step.'],
              ['One unified platform', 'Banks, anchors, and suppliers connected seamlessly.'],
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
        <div className="login-v2-card-inner reveal">
          {/* Heading */}
          <div style={{ marginBottom: 36 }}>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26, fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--ink)', margin: '0 0 6px',
            }}>
              Welcome back
            </h1>
            <p style={{ fontSize: 14, color: 'var(--gray)', margin: 0, lineHeight: 1.5 }}>
              Sign in to your Strike account
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Email */}
            <div>
              <label className="login-v2-label">Email address</label>
              <input
                className="login-v2-input"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
                <span className="login-v2-label" style={{ margin: 0 }}>Password</span>
                <Link
                  href="/forgot-password"
                  style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500, textDecoration: 'none' }}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  className="login-v2-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--gray)', padding: 4,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              {error && (
                <div style={{
                  marginTop: 8, padding: '10px 12px',
                  background: '#FEE2E2',
                  borderRadius: 8,
                  fontSize: 13, color: 'var(--color-red)',
                  lineHeight: 1.4,
                }}>
                  {error}
                </div>
              )}
            </div>

            <button type="submit" className="login-v2-submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          <div style={{ marginTop: 28, textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
              Get started
            </Link>
          </div>

          <div style={{
            marginTop: 24, paddingTop: 20,
            borderTop: '1px solid var(--border)',
            fontSize: 12, color: 'var(--gray-soft)',
            textAlign: 'center', lineHeight: 1.5,
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
