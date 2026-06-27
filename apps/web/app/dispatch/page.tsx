'use client'
import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

interface Message {
  role: 'user' | 'assistant'
  text: string
  ts: string
}

function DispatchInner() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const msg = input.trim()
    if (!msg || !token || loading) return
    setInput('')
    setError(null)

    const userMsg: Message = { role: 'user', text: msg, ts: new Date().toLocaleTimeString() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/ai/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: msg, source: 'mobile' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Request failed')
        return
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: json.response ?? '(no response)',
        ts: new Date().toLocaleTimeString(),
      }])
    } catch {
      setError('Network error — check your connection.')
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  const hasToken = !!token

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--offwhite)',
      fontFamily: 'var(--font-body, "Plus Jakarta Sans", sans-serif)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--white)',
        borderBottom: '1px solid var(--border, rgba(0,0,0,.06))',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'linear-gradient(135deg,#1428CC,#7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 15,
        }}>S</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink, #0D0D0D)' }}>Strike AI</div>
          <div style={{ fontSize: 12, color: 'var(--gray, #6B7280)' }}>Dispatch</div>
        </div>
      </div>

      {/* Message area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {!hasToken && (
          <div style={{
            padding: '14px 16px', borderRadius: 16,
            background: '#FEE2E2', color: '#991B1B', fontSize: 14, textAlign: 'center',
          }}>
            No dispatch token in URL. Add <code>?token=…</code> to use this page.
          </div>
        )}

        {hasToken && messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: 'var(--gray, #6B7280)', fontSize: 14, paddingTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
            <div style={{ fontWeight: 600, color: 'var(--ink, #0D0D0D)', marginBottom: 4 }}>Ready</div>
            <div>Send a command to Strike AI. It can check inventory, create listings, request financing, and more.</div>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Check my inventory status',
                'Any cash flow issues I should know about?',
                'Create a listing for my low-stock items',
                'Show me overdue AR aging',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  style={{
                    padding: '10px 14px', borderRadius: 999,
                    border: '1px solid var(--border, rgba(0,0,0,.06))',
                    background: 'var(--white)', fontSize: 13,
                    color: 'var(--ink, #0D0D0D)', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '82%', padding: '12px 14px', borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user'
                ? 'linear-gradient(135deg,#1428CC,#7C3AED)'
                : 'var(--white)',
              color: m.role === 'user' ? '#fff' : 'var(--ink, #0D0D0D)',
              fontSize: 14, lineHeight: 1.55,
              boxShadow: m.role === 'assistant' ? 'var(--shadow-card, 0 2px 8px rgba(0,0,0,.06))' : 'none',
              whiteSpace: 'pre-wrap',
            }}>
              {m.text}
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.55 }}>{m.ts}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px', borderRadius: '18px 18px 18px 4px',
              background: 'var(--white)', boxShadow: 'var(--shadow-card)',
              display: 'flex', gap: 5, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--gray, #6B7280)',
                  animation: `bounce 1.2s ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#FEE2E2', color: '#991B1B', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} style={{ height: 8 }} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--white)',
        borderTop: '1px solid var(--border, rgba(0,0,0,.06))',
        display: 'flex', gap: 10, alignItems: 'flex-end',
        position: 'sticky', bottom: 0,
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={!hasToken || loading}
          placeholder={hasToken ? 'Message Strike AI…' : 'No token — see URL'}
          rows={1}
          style={{
            flex: 1, resize: 'none', padding: '10px 14px',
            borderRadius: 20, border: '1px solid var(--border, rgba(0,0,0,.06))',
            fontSize: 14, fontFamily: 'inherit', lineHeight: 1.4,
            outline: 'none', background: 'var(--offwhite, #F5F4F0)',
          }}
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || !hasToken || loading}
          style={{
            width: 42, height: 42, borderRadius: '50%', border: 'none',
            background: input.trim() && hasToken ? 'linear-gradient(135deg,#1428CC,#7C3AED)' : 'var(--border, rgba(0,0,0,.06))',
            color: '#fff', fontSize: 18, cursor: input.trim() && hasToken ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background .15s',
          }}
          aria-label="Send"
        >
          ↑
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%,80%,100% { transform: translateY(0) }
          40%          { transform: translateY(-6px) }
        }
      `}</style>
    </div>
  )
}

export default function DispatchPage() {
  return (
    <Suspense>
      <DispatchInner />
    </Suspense>
  )
}
