import { Reveal } from '@/components/motion'
import type { TourScene, TourTone } from '../tour-data'

const TONE_COLOR: Record<TourTone, string> = {
  default: 'var(--ink)',
  good: 'var(--color-green)',
  warn: 'var(--color-amber)',
  bad: 'var(--color-red)',
}
const TONE_BG: Record<TourTone, string> = {
  default: 'var(--offwhite)',
  good: '#EDFAF4',
  warn: '#FEF3C7',
  bad: '#FEE2E2',
}

export default function DashboardScene({ scene }: { scene: Extract<TourScene, { kind: 'dashboard' }> }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <Reveal>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {scene.heading}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--gray)', marginTop: 6, marginBottom: 24 }}>
          {scene.subheading}
        </div>
      </Reveal>

      <Reveal delay={100}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '16px 18px',
            borderRadius: 'var(--radius-card)',
            background: TONE_BG[scene.insight.tone],
            borderLeft: `3px solid ${TONE_COLOR[scene.insight.tone]}`,
            marginBottom: 24,
          }}
        >
          <svg width="18" height="18" style={{ flexShrink: 0, marginTop: 2, color: TONE_COLOR[scene.insight.tone] }}>
            <use href="#i-warn" />
          </svg>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: TONE_COLOR[scene.insight.tone] }}>
              {scene.insight.title}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', marginTop: 4, lineHeight: 1.55 }}>
              {scene.insight.body}
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={200}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {scene.kpis.map((k, i) => (
            <div
              key={i}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--white)',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                {k.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}
