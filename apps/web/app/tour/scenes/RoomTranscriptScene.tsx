import { Reveal } from '@/components/motion'
import { StrikeBlockFromJson } from '@/components/ai-blocks'
import type { TourScene } from '../tour-data'

export default function RoomTranscriptScene({ scene }: { scene: Extract<TourScene, { kind: 'room' }> }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 14 }}>
        {scene.roomTitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {scene.messages.map((m, i) =>
          m.isAI ? (
            <Reveal key={i} delay={i * 80}>
              <div style={{ maxWidth: '85%' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: 'var(--gray)', marginBottom: 4 }}>
                  {m.author}
                </div>
                <div
                  style={{
                    background: 'var(--white)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-card)',
                    padding: '12px 14px',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    color: 'var(--ink)',
                    lineHeight: 1.55,
                  }}
                >
                  {m.content}
                  {m.block && <StrikeBlockFromJson raw={JSON.stringify(m.block)} keyProp={`block-${i}`} />}
                </div>
              </div>
            </Reveal>
          ) : (
            <Reveal key={i} delay={i * 80}>
              <div style={{ textAlign: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: 'var(--gray)',
                    background: 'var(--offwhite)',
                    borderRadius: 999,
                    padding: '5px 14px',
                  }}
                >
                  {m.content}
                </span>
              </div>
            </Reveal>
          )
        )}
      </div>
    </div>
  )
}
