import { Reveal } from '@/components/motion'
import type { TourScene } from '../tour-data'

export default function TitleScene({
  scene,
  onNext,
}: {
  scene: Extract<TourScene, { kind: 'title' }>
  onNext: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '70vh',
        padding: '0 20px',
      }}
    >
      <Reveal>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: 'var(--blue)',
            marginBottom: 18,
          }}
        >
          {scene.eyebrow}
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 5vw, 48px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
            lineHeight: 1.1,
            margin: '0 auto 20px',
          }}
        >
          {scene.title}
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            color: 'var(--gray)',
            maxWidth: 560,
            lineHeight: 1.6,
            margin: '0 auto 36px',
          }}
        >
          {scene.subtitle}
        </p>
        <button
          onClick={onNext}
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            background: 'var(--blue)',
            border: 'none',
            borderRadius: 999,
            padding: '14px 32px',
            cursor: 'pointer',
          }}
        >
          {scene.cta}
        </button>
      </Reveal>
    </div>
  )
}
