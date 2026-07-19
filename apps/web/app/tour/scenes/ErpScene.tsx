import { Reveal } from '@/components/motion'
import type { TourScene, TourTone } from '../tour-data'

const TONE_COLOR: Record<TourTone, string> = {
  default: 'var(--ink)',
  good: 'var(--color-green)',
  warn: 'var(--color-amber)',
  bad: 'var(--color-red)',
}

export default function ErpScene({ scene }: { scene: Extract<TourScene, { kind: 'erp' }> }) {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <Reveal>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
          {scene.heading}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 20 }}>
          {scene.body}
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border)',
            background: 'var(--white)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-green)' }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{scene.connection.system}</span>
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--color-green)',
                background: '#EDFAF4',
                borderRadius: 999,
                padding: '2px 8px',
              }}
            >
              {scene.connection.status}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>Last sync: {scene.connection.lastSync}</span>
        </div>
      </Reveal>

      <Reveal delay={140}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          {scene.stats.map((s, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--white)', padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                {s.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={200}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--white)', overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 90px',
              gap: '0 6px',
              padding: '10px 16px',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-body)',
              fontSize: 10.5,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--gray-soft, var(--gray))',
            }}
          >
            <span>SKU</span>
            <span>On Hand</span>
            <span>Reserved</span>
          </div>
          {scene.inventory.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px 90px',
                gap: '0 6px',
                padding: '10px 16px',
                borderBottom: i < scene.inventory.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)' }}>{row.sku}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: TONE_COLOR[row.tone] }}>{row.onHand}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{row.reserved}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}
