import { useState } from 'react'
import { Reveal } from '@/components/motion'
import { StrikeBlockFromJson } from '@/components/ai-blocks'
import type { TourScene } from '../tour-data'

interface LocalMessage {
  role: 'user' | 'assistant'
  content: string
  block?: Record<string, unknown>
}

function cannedReply(input: string): string {
  const q = input.toLowerCase()
  if (q.includes('cash') || q.includes('balance')) {
    return "Cash position is $2.1M as of the last ERP sync, 4 minutes ago. That's healthy relative to your open financing exposure of $680K — I wouldn't hold back on this deal for cash reasons."
  }
  if (q.includes('risk') || q.includes('concentration')) {
    return "The main risk here is counterparty concentration, not credit — Rocket Corp would sit at 65.7% of your trade book after this deal. I'd watch that, but their PassportScore (69) and clean payment history keep it manageable for now."
  }
  if (q.includes('supplier') || q.includes('other') || q.includes('divers')) {
    return "I'd look at diversifying your next 1-2 sourcing decisions toward suppliers outside the Rocket Corp relationship — I can run a search on Strike Place for comparable steel suppliers if you want."
  }
  if (q.includes('financ') || q.includes('bank') || q.includes('rate')) {
    return 'Atlas Bank is currently the best-ranked offer on this receivable at 5.8% / 60 days — faster and cheaper than the other two bids I pulled in.'
  }
  return "Good question — I'd want to check concentration risk and cash position before committing further, both of which I already have from your live ERP connection. Want me to pull those up?"
}

export default function ChatScene({ scene }: { scene: Extract<TourScene, { kind: 'chat' }> }) {
  const [extra, setExtra] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)

  function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    setExtra((prev) => [...prev, { role: 'user', content: text }])
    setThinking(true)
    setTimeout(() => {
      setExtra((prev) => [...prev, { role: 'assistant', content: cannedReply(text) }])
      setThinking(false)
    }, 900)
  }

  const allMessages: LocalMessage[] = [...scene.messages, ...extra]

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
        {allMessages.map((m, i) => {
          const isUser = m.role === 'user'
          return (
            <Reveal key={i} delay={i < scene.messages.length ? i * 150 : 0}>
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
        {thinking && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ borderRadius: 'var(--radius-card)', padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--gray)', fontStyle: 'italic' }}>
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 100 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder="Ask Strike AI anything about this book…"
          style={{
            flex: 1,
            fontFamily: 'var(--font-body)',
            fontSize: 13.5,
            padding: '11px 14px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || thinking}
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            background: !input.trim() || thinking ? 'var(--border-strong)' : 'var(--blue)',
            border: 'none',
            borderRadius: 999,
            padding: '0 20px',
            cursor: !input.trim() || thinking ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
