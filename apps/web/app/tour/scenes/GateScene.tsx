import { useState } from 'react'
import { Reveal } from '@/components/motion'
import type { TourScene } from '../tour-data'

export default function GateScene({
  scene,
  onNext,
}: {
  scene: Extract<TourScene, { kind: 'gate' }>
  onNext: () => void
}) {
  const [approved, setApproved] = useState(false)

  function approve() {
    setApproved(true)
    setTimeout(onNext, 650)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Reveal>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--white)',
            padding: 24,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-amber)',
              background: '#FEF3C7',
              borderRadius: 999,
              padding: '4px 10px',
              marginBottom: 14,
            }}
          >
            {scene.badge}
          </span>

          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
            {scene.title}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray)', marginTop: 10, lineHeight: 1.6 }}>
            {scene.body}
          </div>

          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'var(--offwhite)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--ink)',
            }}
          >
            <div style={{ color: 'var(--blue)', marginBottom: 3 }}>{scene.toolName}</div>
            <div>{scene.summaryLine}</div>
          </div>

          {scene.guardrailLine && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)', marginTop: 10 }}>
              {scene.guardrailLine}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              onClick={approve}
              disabled={approved}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13.5,
                fontWeight: 600,
                color: '#fff',
                background: approved ? 'var(--color-green)' : 'var(--blue)',
                border: 'none',
                borderRadius: 999,
                padding: '10px 22px',
                cursor: approved ? 'default' : 'pointer',
                transition: 'background 150ms',
              }}
            >
              {approved ? 'Approved ✓' : scene.approveLabel}
            </button>
          </div>

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray-soft, var(--gray))', marginTop: 16, lineHeight: 1.5 }}>
            {scene.footer}
          </div>
        </div>
      </Reveal>
    </div>
  )
}
