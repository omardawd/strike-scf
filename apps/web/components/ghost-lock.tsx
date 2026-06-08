'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// GhostLock — the centered "locked feature" card shown to Tier-0 (ghost) orgs on
// every actionable page. Reusable so gating stays centralized: callers render
// <GhostLock sentence="…" /> instead of their normal page body. The CTA always
// routes to /onboarding (the Passport activation wizard).
//
// Styling uses existing tokens only (globals.css / marketplace.css) — no raw hex.
// ─────────────────────────────────────────────────────────────────────────────

export function GhostLock({
  sentence,
  heading = 'Activate your Passport to unlock this feature',
}: {
  /** One page-specific sentence describing what the user is missing. */
  sentence: string
  heading?: string
}) {
  const router = useRouter()
  return (
    <div className="ghost-lock">
      <div className="ghost-lock-card">
        <div className="ghost-lock-logo">
          <Image
            src="/logo.png"
            alt="Strike SCF"
            width={140}
            height={42}
            style={{ objectFit: 'contain', height: 'auto', maxWidth: '100%' }}
            priority
          />
        </div>
        <div className="ghost-lock-badge" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 16 16">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </div>
        <h2 className="ghost-lock-title">{heading}</h2>
        <p className="ghost-lock-body">{sentence}</p>
        <button
          type="button"
          className="btn btn-primary ghost-lock-cta"
          onClick={() => router.push('/onboarding')}
        >
          Activate Passport →
        </button>
      </div>
    </div>
  )
}
