'use client'
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { Topbar } from '@/components/portal-shell'

// TA.6 — Supply Graph remains in the bank sidebar to signal future capability,
// but it deliberately does NOT navigate to the real network visualization yet.
// The nav item routes here and renders a full-page Strike-styled "Coming Soon"
// card. The real graph data is intentionally never reached.
export default function SupplyGraphComingSoon() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }, [])

  return (
    <>
      <Topbar crumbs={[{ label: 'Supply Graph' }]} />
      <div
        data-page-name="Supply Graph"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: '100%',
            textAlign: 'center',
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-card)',
            padding: '40px 36px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Image
            src={theme === 'dark' ? '/strike_white_nobg.png' : '/logo.png'}
            alt="Strike SCF"
            width={128}
            height={40}
            style={{ objectFit: 'contain', height: 'auto', maxWidth: '100%' }}
            priority
          />

          {/* Network-nodes glyph — echoes the sidebar Supply Graph icon. */}
          <svg
            width={56}
            height={56}
            viewBox="0 0 20 20"
            fill="none"
            stroke="var(--blue)"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ marginTop: 4 }}
          >
            <circle cx="5" cy="6" r="2" />
            <circle cx="15" cy="6" r="2" />
            <circle cx="10" cy="15" r="2" />
            <path d="M6.7 7.2L9 13.4M13.3 7.2L11 13.4M7 6h6" />
          </svg>

          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--blue)',
              background: 'var(--blue-light)',
              padding: '4px 12px',
              borderRadius: 'var(--radius-badge)',
            }}
          >
            Coming Soon
          </span>

          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            Supply Graph
          </h1>

          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--gray)',
              margin: 0,
            }}
          >
            Available in Phase 2. The full network visualization of your portfolio
            relationships.
          </p>
        </div>
      </div>
    </>
  )
}
