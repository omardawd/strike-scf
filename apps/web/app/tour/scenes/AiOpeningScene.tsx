import { useEffect, useRef, useState } from 'react'
import { Reveal } from '@/components/motion'
import type { TourScene } from '../tour-data'

const LINE_INTERVAL_MS = 1400

export default function AiOpeningScene({
  scene,
  onAdvance,
}: {
  scene: Extract<TourScene, { kind: 'ai-open' }>
  onAdvance: () => void
}) {
  const [visibleLines, setVisibleLines] = useState(0)
  const [approved, setApproved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVisibleLines((c) => {
        if (c >= scene.thinking.length) {
          if (timerRef.current) clearInterval(timerRef.current)
          return c
        }
        return c + 1
      })
    }, LINE_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [scene.thinking])

  const cardVisible = visibleLines >= scene.thinking.length

  function approve() {
    setApproved(true)
    setTimeout(onAdvance, 650)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: cardVisible ? 20 : 0 }}>
        {scene.thinking.slice(0, visibleLines).map((line, i) => (
          <Reveal key={i}>
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  maxWidth: '90%',
                  borderRadius: 'var(--radius-card)',
                  padding: '11px 15px',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: 'var(--white)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                }}
              >
                {line}
              </div>
            </div>
          </Reveal>
        ))}
        {!cardVisible && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ borderRadius: 'var(--radius-card)', padding: '11px 15px', border: '1px solid var(--border)', background: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>
              …
            </div>
          </div>
        )}
      </div>

      {cardVisible && (
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
      )}
    </div>
  )
}
