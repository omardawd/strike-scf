'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface TokenData {
  valid: boolean
  reason?: string
  anchor_name?: string
  network_name?: string
  anchor_country?: string
  anchor_member_since?: string
  prefill_company_name?: string | null
  prefill_country?: string | null
  invited_email?: string
}

function PassportRing({ score }: { score?: number | null }) {
  const s = score ?? 0
  const color = s >= 70 ? '#10B981' : s >= 45 ? '#F59E0B' : '#EF4444'
  const circumference = 2 * Math.PI * 22
  const offset = circumference - (s / 100) * circumference
  return (
    <div style={{ position: 'relative', width: 60, height: 60 }}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="22" fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle
          cx="30" cy="30" r="22" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: 'var(--ink)',
      }}>
        {score != null ? score : '—'}
      </div>
    </div>
  )
}

export default function InviteLandingPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [data, setData] = useState<TokenData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    fetch(`/api/invite/${token}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ valid: false, reason: 'not_found' }))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = () => {
    const params = new URLSearchParams()
    params.set('invite_token', token)
    if (data?.invited_email) params.set('email', data.invited_email)
    if (data?.prefill_company_name) params.set('company', data.prefill_company_name)
    if (data?.prefill_country) params.set('country', data.prefill_country)
    router.push(`/signup?${params.toString()}`)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!data?.valid) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--offwhite)',
      }}>
        <div style={{
          background: 'var(--white)', borderRadius: 'var(--radius-card)',
          padding: '48px 40px', maxWidth: 400, width: '100%',
          boxShadow: 'var(--shadow-card)', textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {data?.reason === 'expired' ? 'Invitation expired' :
             data?.reason === 'already_used' ? 'Invitation already used' :
             'Invitation not found'}
          </h2>
          <p style={{ color: 'var(--gray)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            {data?.reason === 'expired'
              ? 'This invitation link has expired. Please ask the sender to send a new one.'
              : data?.reason === 'already_used'
              ? 'This invitation has already been accepted.'
              : 'This invitation link is invalid or does not exist.'}
          </p>
          <Link href="/login" style={{
            display: 'inline-block', background: 'var(--blue)', color: '#fff',
            borderRadius: 'var(--radius-button)', padding: '10px 24px',
            textDecoration: 'none', fontWeight: 600, fontSize: 14,
          }}>
            Sign in to Strike →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--offwhite)', padding: '40px 16px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Image src="/logo.png" alt="Strike SCF" width={120} height={38} style={{ objectFit: 'contain' }} priority />
        </div>

        <div style={{
          background: 'var(--white)', borderRadius: 'var(--radius-card)',
          padding: '48px 40px', boxShadow: 'var(--shadow-card)',
        }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2, marginBottom: 12 }}>
              {data.anchor_name}
            </h1>
            <p style={{ fontSize: 16, color: 'var(--gray)', marginBottom: 16, lineHeight: 1.5 }}>
              has invited you to join their supplier network on Strike SCF
            </p>
            {data.network_name && (
              <span style={{
                display: 'inline-block', background: 'var(--blue-light)',
                color: 'var(--blue)', borderRadius: 'var(--radius-button)',
                padding: '6px 16px', fontSize: 14, fontWeight: 600,
              }}>
                {data.network_name}
              </span>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '32px 0' }} />

          {/* Two-column info */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
            marginBottom: 36,
          }}>
            {/* Left: What is Strike */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink)' }}>
                What is Strike SCF?
              </h3>
              <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 12 }}>
                Strike is an AI-native supply chain finance platform. Joining gives you access to:
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Invoice financing from competing banks',
                  'Your PassportScore — your trade finance identity',
                  'Strike Place — source new buyers',
                  'Strike Rooms — negotiate deals',
                ].map(item => (
                  <li key={item} style={{ fontSize: 13, color: 'var(--ink)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--color-green)', flexShrink: 0 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: Anchor info */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'var(--offwhite)', borderRadius: 'var(--radius-card)',
              padding: 20, gap: 10,
            }}>
              <PassportRing score={null} />
              <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center' }}>
                {data.anchor_name}
              </div>
              {data.anchor_country && (
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>{data.anchor_country}</div>
              )}
              {data.anchor_member_since && (
                <div style={{ fontSize: 11, color: 'var(--gray-soft)' }}>
                  Member since {new Date(data.anchor_member_since).getFullYear()}
                </div>
              )}
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleAccept}
            style={{
              width: '100%', padding: '14px 0', background: 'var(--blue)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius-button)',
              fontSize: 16, fontWeight: 700, cursor: 'pointer',
              boxShadow: 'var(--shadow-button)', marginBottom: 12,
            }}
          >
            Accept Invitation &amp; Create Account
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
            Already have a Strike account?{' '}
            <Link
              href={`/login?redirect=/invite/${token}`}
              style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}
            >
              Sign in to accept
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
