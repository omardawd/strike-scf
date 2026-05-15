'use client'

import { useState } from 'react'
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setLoading(false)
      setError(authError.message)
      return
    }

    // Only anchor/supplier roles need the KYB gate — bank roles go straight to dashboard
    const role = signInData.user?.user_metadata?.role as string | undefined
    const needsKybCheck = role === 'anchor_admin' || role === 'anchor_member' ||
                          role === 'supplier_admin' || role === 'supplier_member'

    if (needsKybCheck) {
      try {
        const res = await fetch('/api/onboarding/status')
        if (res.ok) {
          const { kyb_status, org_status } = await res.json()
          const pendingStatuses = ['in_progress', 'submitted', 'under_review', 'more_info_requested']
          if (org_status === 'rejected' || kyb_status === 'rejected') {
            await supabase.auth.signOut()
            setLoading(false)
            setError('Your application was not approved. Please contact your administrator.')
            return
          }
          if (kyb_status && pendingStatuses.includes(kyb_status)) {
            router.push('/pending-approval')
            return
          }
        }
      } catch {
        // Non-fatal — fall through to dashboard
      }
    }

    router.push('/dashboard')
  }

  const inputStyle: React.CSSProperties = {
    height: 38, width: '100%', padding: '0 12px',
    border: '1px solid var(--color-border, #E2DFD8)',
    borderRadius: 6,
    background: 'var(--color-card, white)',
    fontSize: 13.5, color: 'var(--color-ink-1, #0F0F0F)',
    fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 120ms ease',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg, #F7F6F3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--color-card, white)',
        border: '1px solid var(--color-border, #E2DFD8)',
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
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--color-ink-1, #0F0F0F)', margin: '24px 0 0',
        }}>
          Welcome back
        </h1>
        <p style={{
          fontSize: 13.5, color: 'var(--color-ink-3, #6B6963)',
          margin: '6px 0 28px',
        }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{
              fontSize: 13, fontWeight: 500,
              color: 'var(--color-ink-1, #0F0F0F)', marginBottom: 5,
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
            <label style={{
              fontSize: 13, fontWeight: 500,
              color: 'var(--color-ink-1, #0F0F0F)', marginBottom: 5,
              display: 'block',
            }}>
              Password
            </label>
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
            style={{
              width: '100%', height: 40, borderRadius: 7,
              background: 'var(--color-ink-1, #0F0F0F)', color: 'white',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Divider */}
        <div style={{
          height: 1,
          background: 'var(--color-border, #E2DFD8)',
          margin: '20px 0 16px',
        }} />

        {/* Sign up link */}
        <p style={{
          fontSize: 13, color: 'var(--color-ink-3, #6B6963)',
          margin: 0, textAlign: 'center',
        }}>
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            style={{ color: 'var(--color-accent, #0A1FB8)', fontWeight: 500, textDecoration: 'none' }}
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
