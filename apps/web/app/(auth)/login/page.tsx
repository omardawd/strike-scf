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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

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

    // Route by org status. Users with no org (bank / strike_admin) always go to
    // the dashboard; org users go to onboarding until their org is active.
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

  const inputStyle: React.CSSProperties = {
    height: 38, width: '100%', padding: '0 12px',
    border: '1px solid var(--border)',
    background: 'var(--white)',
    fontSize: 13.5, color: 'var(--ink)',
    fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
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
        width: '100%', maxWidth: 420,
        background: 'var(--white)',
        border: '1px solid var(--border)',
        padding: 40,
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <Image
            src={isDark ? '/strike_white_nobg.png' : '/logo.png'}
            alt="Strike SCF"
            width={200}
            height={60}
            style={{
              objectFit: 'contain',
              objectPosition: 'left center',
              maxWidth: '100%',
              height: 'auto',
            }}
            priority
          />
        </div>

        {/* Heading */}
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--ink)', margin: '24px 0 0',
        }}>
          Welcome back
        </h1>
        <p style={{
          fontSize: 13, color: 'var(--gray)',
          margin: '6px 0 28px',
        }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11, fontWeight: 400,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--gray)', marginBottom: 6,
              display: 'block',
            }}>
              Email
            </label>
            <input
              style={inputStyle}
              type="email"
              placeholder="Work email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <label style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11, fontWeight: 400,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--gray)',
                display: 'block',
              }}>
                Password
              </label>
              <Link
                href="/forgot-password"
                style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500, textDecoration: 'none', fontFamily: 'var(--font-mono)' }}
              >
                Forgot password?
              </Link>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 40 }}
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-ink-3)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
            {error && (
              <div style={{ fontSize: 12, color: 'var(--color-red, #B42318)', marginTop: 6 }}>
                {error}
              </div>
            )}
          </div>

          {/* Sign in button */}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

      </div>
    </div>
  )
}
