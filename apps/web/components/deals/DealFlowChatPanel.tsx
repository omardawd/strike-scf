'use client'
import { useState } from 'react'
import { renderTextWithStrikeBlocks } from '@/components/ai-blocks'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Scoped Strike AI chat for drafting a deal's custom flow — calls the
// existing /api/ai/chat agentic loop (portal:'anchor' gets it the
// draft_deal_flow tool via ORG_TOOLS in lib/ai/tools/definitions.ts) rather
// than reimplementing tool-call handling here. The tool call itself already
// persists the draft server-side; onDraftApplied() just tells the canvas to
// refetch so the drafted nodes appear.
export function DealFlowChatPanel({ dealId, currentFlowSummary, onDraftApplied }: { dealId: string; currentFlowSummary: string; onDraftApplied: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sonnet',
          portal: 'anchor',
          feature: 'chat',
          system: `You are helping the buyer design the custom progress flow for deal ${dealId}. When they describe the deal's shape (shipments, payment cycles, timeline), call draft_deal_flow with deal_id "${dealId}". Prefer a "cycle" node over listing repeated shipments/payments individually. draft_deal_flow REPLACES the entire flow atomically — it does not merge. The flow currently has: ${currentFlowSummary || 'nothing yet'}. If the user asks to add, change, or remove something, include every checkpoint/cycle they want to KEEP (using the exact same title so its progress is preserved) plus your change in the same call — never omit an existing one unless the user asked to remove it.`,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Strike AI is unavailable')
      const text: string = (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
      setMessages(prev => [...prev, { role: 'assistant', content: text || '...' }])
      if (text.includes('"type":"deal_flow_draft"')) onDraftApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Strike AI is unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>
        STRIKE AI — DRAFT THIS FLOW
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--gray-soft)', lineHeight: 1.5 }}>
            Describe the deal, e.g. "2-year contract, 12 shipments every 60 days, payment due 30 days after each shipment."
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '90%', fontSize: 12.5, lineHeight: 1.5,
            background: m.role === 'user' ? 'var(--blue-light)' : 'var(--offwhite)',
            color: 'var(--ink)', borderRadius: 10, padding: '8px 10px',
          }}>
            {m.role === 'assistant' ? renderTextWithStrikeBlocks(m.content) : m.content}
          </div>
        ))}
        {busy && <div style={{ fontSize: 12, color: 'var(--gray-soft)' }}>Thinking…</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Describe the deal flow…"
          disabled={busy}
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  )
}
