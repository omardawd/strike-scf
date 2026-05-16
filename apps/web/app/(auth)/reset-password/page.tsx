'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword]           = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const [sessionReady, setSessionReady]   = useState(false)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setSessionReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    router.push('/dashboard')
  }

  const rules = [
    { label: 'At least 8 characters',      met: password.length >= 8 },
    { label: 'At least one uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'At least one number',         met: /[0-9]/.test(password) },
  ]

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
        <h1 style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--color-ink-1, #0F0F0F)', margin: '0 0 6px',
        }}>
          Set new password
        </h1>
        <p style={{
          fontSize: 13.5, color: 'var(--color-ink-3, #6B6963)',
          margin: '0 0 28px',
        }}>
          Choose a strong password for your account.
        </p>

        {!sessionReady && (
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: 'var(--color-bg-2, #f8fafc)',
            border: '1px solid var(--color-border)',
            fontSize: 13, color: 'var(--color-ink-3)',
            marginBottom: 20,
          }}>
            Verifying your reset link…
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{
              fontSize: 13, fontWeight: 500,
              color: 'var(--color-ink-1, #0F0F0F)', marginBottom: 5,
            }}>
              New password
            </label>
            <input
              style={inputStyle}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{
              fontSize: 13, fontWeight: 500,
              color: 'var(--color-ink-1, #0F0F0F)', marginBottom: 5,
            }}>
              Confirm password
            </label>
            <input
              style={inputStyle}
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {password && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rules.map(r => (
                <div key={r.label} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12,
                  color: r.met ? 'var(--color-green, #16a34a)' : 'var(--color-ink-3)',
                }}>
                  <span>{r.met ? '✓' : '○'}</span>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--color-red, #B42318)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !sessionReady}
            style={{
              width: '100%', height: 40, borderRadius: 7,
              background: 'var(--color-ink-1, #0F0F0F)', color: 'white',
              border: 'none', cursor: (loading || !sessionReady) ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              opacity: (loading || !sessionReady) ? 0.7 : 1,
            }}
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
