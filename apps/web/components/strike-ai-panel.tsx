'use client'
// Collapseable right-side Strike AI context panel.
// Always visible toggle sits outside the panel div so it works when panel is closed.
import React, { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function AttachIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 7.5l-5.8 5.8a3.5 3.5 0 0 1-4.95-4.95L8.6 2.5a2.25 2.25 0 0 1 3.18 3.18L5.9 11.5a1 1 0 0 1-1.41-1.41L10 4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const PANEL_WIDTH = 300
const STORAGE_KEY = 'strike-ai-panel-open'

function getPageContext(): { name: string; context: Record<string, unknown> } {
  try {
    const shell = document.querySelector('[data-page-name]')
    const name = shell?.getAttribute('data-page-name') ?? 'Dashboard'
    const raw = shell?.getAttribute('data-ai-context')
    const context = raw ? JSON.parse(raw) : {}
    return { name, context }
  } catch {
    return { name: 'Dashboard', context: {} }
  }
}

export function StrikeAIPanel() {
  const pathname = usePathname()
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === '1'
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextInsight, setContextInsight] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  }, [open])

  useEffect(() => {
    setContextInsight(null)
    setMessages([])
    if (!open) return
    const { name, context } = getPageContext()
    let active = true

    fetch('/api/ai/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: name.toLowerCase().replace(/\s+/g, '-'), portal: 'auto', data: context }),
    })
      .then(r => r.json())
      .then((d: { insight?: string }) => {
        if (active && d.insight) setContextInsight(d.insight)
      })
      .catch(() => {})

    return () => { active = false }
  }, [pathname, open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages, contextInsight])

  useEffect(() => {
    function onPrompt(e: Event) {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt
      if (prompt) {
        setOpen(true)
        setInput(prompt)
      }
    }
    window.addEventListener('strike-ai-prompt', onPrompt)
    return () => window.removeEventListener('strike-ai-prompt', onPrompt)
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const { name, context } = getPageContext()
    const userMsg: Message = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          system: `You are Strike AI embedded in the Strike SCF platform. The user is on the "${name}" page. Context: ${JSON.stringify(context)}. Be concise, specific to supply chain finance.`,
        }),
      })
      const data = await res.json() as { content?: string }
      if (data.content) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content! }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble responding.' }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  if (pathname === '/ai') return null

  return (
    <>
      {/* Toggle — always accessible, positioned outside panel */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Collapse AI panel' : 'Open Strike AI'}
        style={{
          position: 'fixed',
          right: open ? PANEL_WIDTH : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 50,
          width: open ? 24 : 32,
          height: open ? 64 : 80,
          background: open ? 'var(--white)' : 'var(--blue)',
          border: open ? '1px solid var(--border)' : 'none',
          borderRight: open ? '1px solid var(--border)' : 'none',
          borderRadius: open ? '10px 0 0 10px' : '0 10px 10px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          cursor: 'pointer',
          color: open ? 'var(--gray)' : '#fff',
          boxShadow: open ? '-2px 0 8px rgba(0,0,0,0.06)' : '2px 0 12px rgba(20,40,204,0.25)',
          transition: 'right 220ms ease, width 220ms ease, height 220ms ease, background 220ms ease',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d={open ? 'M6 4l4 4-4 4' : 'M10 4l-4 4 4 4'}
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        {!open && (
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
            <path d="M16 4.5v2M15 5.5h2" />
          </svg>
        )}
      </button>

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          width: open ? PANEL_WIDTH : 0,
          zIndex: 40,
          background: 'var(--white)',
          borderLeft: open ? '1px solid var(--border)' : 'none',
          boxShadow: open ? '-4px 0 24px rgba(0,0,0,0.07)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 220ms ease, box-shadow 220ms ease',
        }}
      >
        {open && (
          <>
            {/* Header */}
            <div style={{
              padding: '14px 16px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--blue)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                  <path d="M16 4.5v2M15 5.5h2" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Strike AI</div>
                <div style={{
                  fontSize: 10.5, fontWeight: 500, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--blue)',
                }}>Context-aware</div>
              </div>
            </div>

            {/* Body */}
            <div
              ref={bodyRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {contextInsight && messages.length === 0 && (
                <div style={{
                  padding: '10px 13px',
                  background: 'var(--blue-light)',
                  borderLeft: '3px solid var(--blue)',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--ink)',
                }}>
                  <div style={{ marginBottom: 6 }}>{contextInsight}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--gray)' }}>Ask me anything about this page.</div>
                </div>
              )}

              {!contextInsight && messages.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--gray)', fontStyle: 'italic', padding: '8px 0' }}>
                  Analyzing this page…
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} style={{
                  padding: '9px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.55,
                  background: msg.role === 'user' ? 'rgba(20,40,204,0.06)' : 'var(--offwhite)',
                  border: '1px solid var(--border)',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  color: 'var(--ink)',
                }}>
                  {msg.role === 'user' && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>You</div>
                  )}
                  {msg.content}
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: 'var(--blue)', display: 'inline-block',
                      animation: `ai-dot-pulse 1s ${i * 0.15}s ease infinite`,
                    }} />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}>
              <label
                title="Attach a document"
                style={{
                  width: 32, height: 32, flexShrink: 0,
                  borderRadius: 'var(--radius-button)',
                  border: '1px solid var(--border)',
                  background: 'var(--offwhite)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--gray)',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.csv,.txt,.png,.jpg,.jpeg"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) setInput(prev => prev ? `${prev} [${file.name}]` : `[${file.name}]`)
                    e.target.value = ''
                  }}
                />
                <AttachIcon />
              </label>
              <input
                type="text"
                placeholder="Ask anything…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={loading}
                style={{
                  flex: 1,
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--border)',
                  background: 'var(--offwhite)',
                  fontSize: 13,
                  fontFamily: 'var(--font-body)',
                  color: 'var(--ink)',
                  outline: 'none',
                  minWidth: 0,
                }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || loading}
                aria-label="Send"
                style={{
                  width: 32, height: 32,
                  borderRadius: 'var(--radius-button)',
                  background: 'var(--blue)', color: '#fff',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  opacity: (!input.trim() || loading) ? 0.5 : 1,
                  transition: 'opacity 0.15s, background 0.15s',
                }}
              >
                <SendIcon />
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
