import { Reveal } from '@/components/motion'
import type { TourScene } from '../tour-data'

export default function CapstoneScene({ scene }: { scene: Extract<TourScene, { kind: 'capstone' }> }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '60vh',
        padding: '0 20px',
      }}
    >
      <Reveal>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(26px, 4.5vw, 40px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginBottom: 18,
          }}
        >
          {scene.heading}
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15.5,
            color: 'var(--gray)',
            maxWidth: 560,
            lineHeight: 1.65,
            margin: '0 auto 32px',
          }}
        >
          {scene.body}
        </p>
        <a
          href={scene.ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            fontFamily: 'var(--font-body)',
            fontSize: 14.5,
            fontWeight: 600,
            color: '#fff',
            background: 'var(--blue)',
            borderRadius: 999,
            padding: '13px 30px',
            textDecoration: 'none',
          }}
        >
          {scene.ctaLabel}
        </a>
      </Reveal>
    </div>
  )
}
