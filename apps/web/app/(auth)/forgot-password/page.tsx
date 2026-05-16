'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setSent(true)
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

        <h1 style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--color-ink-1, #0F0F0F)', margin: '24px 0 0',
        }}>
          Forgot password
        </h1>

        {sent ? (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--color-ink-3, #6B6963)', margin: '6px 0 28px' }}>
              If an account exists for <strong style={{ color: 'var(--color-ink-1)' }}>{email}</strong>, you&apos;ll receive a reset link shortly.
            </p>
            <Link
              href="/login"
              style={{
                display: 'block', width: '100%', height: 40, borderRadius: 7,
                background: 'var(--color-ink-1, #0F0F0F)', color: 'white',
                border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                textDecoration: 'none', textAlign: 'center', lineHeight: '40px',
              }}
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--color-ink-3, #6B6963)', margin: '6px 0 28px' }}>
              Enter your email and we&apos;ll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--color-ink-1, #0F0F0F)', marginBottom: 5, display: 'block',
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
                {error && (
                  <div style={{ fontSize: 12, color: 'var(--color-red, #B42318)', marginTop: 6 }}>
                    {error}
                  </div>
                )}
              </div>

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
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <div style={{ height: 1, background: 'var(--color-border, #E2DFD8)', margin: '20px 0 16px' }} />
            <p style={{ fontSize: 13, color: 'var(--color-ink-3, #6B6963)', margin: 0, textAlign: 'center' }}>
              <Link href="/login" style={{ color: 'var(--color-accent, #0A1FB8)', fontWeight: 500, textDecoration: 'none' }}>
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
