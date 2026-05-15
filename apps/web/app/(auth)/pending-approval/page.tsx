'use client'

import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function PendingApprovalPage() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
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
        width: '100%', maxWidth: 460,
        background: 'var(--color-card, white)',
        border: '1px solid var(--color-border, #E2DFD8)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: 40,
        textAlign: 'center',
      }}>
        <div style={{ marginBottom: 28, textAlign: 'left' }}>
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={200}
            height={60}
            style={{ objectFit: 'contain', objectPosition: 'left center', maxWidth: '100%', height: 'auto' }}
            priority
          />
        </div>

        {/* Icon */}
        <div style={{
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(37,99,235,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <circle cx="13" cy="13" r="10" stroke="#2563EB" strokeWidth="1.8" fill="none" />
            <path d="M13 8 L13 14 M13 17 L13 17.5" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <h1 style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--color-ink-1, #0F0F0F)', margin: '0 0 10px',
        }}>
          Application under review
        </h1>
        <p style={{
          fontSize: 14, color: 'var(--color-ink-3, #6B6963)',
          lineHeight: 1.7, margin: '0 0 28px',
        }}>
          Your KYB application has been submitted and is being reviewed
          by the program administrator. You&apos;ll receive an email once a
          decision has been made.
        </p>

        {/* Steps */}
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: 'var(--color-bg-2, #f8fafc)',
          border: '1.5px solid var(--color-border, #E2DFD8)',
          fontSize: 13, color: 'var(--color-ink-2, #3a3832)',
          textAlign: 'left', lineHeight: 1.9, marginBottom: 28,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-ink-4, #9C9890)' }}>
            What happens next
          </div>
          <div>① Your administrator reviews your KYB submission</div>
          <div>② They may reach out for any missing documents</div>
          <div>③ You&apos;ll receive an email when approved</div>
          <div>④ Sign back in to access the full platform</div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          style={{
            width: '100%', height: 40, borderRadius: 7,
            background: 'transparent',
            color: 'var(--color-ink-3, #6B6963)',
            border: '1px solid var(--color-border, #E2DFD8)',
            cursor: 'pointer', fontSize: 14, fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
