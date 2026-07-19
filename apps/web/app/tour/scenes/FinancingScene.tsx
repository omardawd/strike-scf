import { Reveal } from '@/components/motion'
import type { TourScene } from '../tour-data'

export default function FinancingScene({ scene }: { scene: Extract<TourScene, { kind: 'financing' }> }) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Reveal>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
          {scene.heading}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 22 }}>
          {scene.body}
        </div>
      </Reveal>

      <Reveal delay={120}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {scene.offers.map((o, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                borderRadius: 'var(--radius-card)',
                border: o.recommended ? '1.5px solid var(--blue)' : '1px solid var(--border)',
                background: o.recommended ? 'var(--offwhite)' : 'var(--white)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{o.bankName}</span>
                  {o.recommended && (
                    <span
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: '#fff',
                        background: 'var(--blue)',
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      Recommended
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)', marginTop: 3 }}>
                  {o.tenor} tenor
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{o.rate}</div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}
