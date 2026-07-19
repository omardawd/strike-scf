import { Reveal } from '@/components/motion'
import { StrikeBlockFromJson } from '@/components/ai-blocks'
import type { TourScene } from '../tour-data'

export default function ChatScene({ scene }: { scene: Extract<TourScene, { kind: 'chat' }> }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {scene.messages.map((m, i) => {
        const isUser = m.role === 'user'
        return (
          <Reveal key={i} delay={i * 150}>
            <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  borderRadius: 'var(--radius-card)',
                  padding: '12px 16px',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  background: isUser ? 'var(--blue)' : 'var(--white)',
                  color: isUser ? '#fff' : 'var(--ink)',
                  border: isUser ? 'none' : '1px solid var(--border)',
                }}
              >
                {m.content}
                {m.block && <StrikeBlockFromJson raw={JSON.stringify(m.block)} keyProp={`block-${i}`} />}
              </div>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}
