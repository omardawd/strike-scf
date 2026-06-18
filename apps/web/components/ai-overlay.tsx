'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { usePortal } from '@/lib/portal-context'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

function readPageContext(): { pageName: string; contextData: Record<string, unknown> | null } {
  let pageName = 'this page'
  let contextData: Record<string, unknown> | null = null
  try {
    const nameEl = document.querySelector('[data-page-name]')
    pageName = nameEl?.getAttribute('data-page-name') || document.title || 'this page'
  } catch { /* ignore */ }
  try {
    const el = document.querySelector('[data-ai-context]')
    const raw = el?.getAttribute('data-ai-context')
    if (raw) contextData = JSON.parse(raw)
  } catch { /* ignore */ }
  return { pageName, contextData }
}

function buildSystemPrompt(pageName: string, contextData: Record<string, unknown> | null, userName: string, portal: string) {
  const today = new Date().toISOString().split('T')[0]
  const ctx = contextData ? `\nPage context (live data from what the user sees):\n${JSON.stringify(contextData, null, 2)}` : ''
  return `You are Strike AI, the assistant built into the Strike SCF platform. Strike AI is your name and only name.

Today: ${today}
User: ${userName} (${portal} portal)
Current page: ${pageName}${ctx}

You can see exactly what the user sees on this page. Use the page context to answer questions about pricing, risk, what to offer, whether terms are fair, etc. — no tool calls needed, just reason from the data.

Rules:
- Be concise. Short paragraphs or bullets. No markdown headers.
- Format currency as $X,XXX. Bold key figures.
- If the user asks to DO something (submit an offer, create a listing), tell them you can handle that on the full Strike AI page and offer a link.
- Never invent data not in the page context.`
}

const MD_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children }: any) => <span style={{ display: 'block', margin: '3px 0', lineHeight: 1.6 }}>{children}</span>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong: ({ children }: any) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children }: any) => <ul style={{ paddingLeft: 16, margin: '4px 0' }}>{children}</ul>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children }: any) => <ol style={{ paddingLeft: 16, margin: '4px 0' }}>{children}</ol>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children }: any) => <li style={{ marginBottom: 2, lineHeight: 1.55 }}>{children}</li>,
  hr: () => <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', margin: '6px 0' }} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: ({ children }: any) => <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>{children}</code>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ children }: any) => <strong style={{ display: 'block', fontWeight: 700, marginBottom: 2 }}>{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ children }: any) => <strong style={{ display: 'block', fontWeight: 700, marginBottom: 2 }}>{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ children }: any) => <strong style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>{children}</strong>,
}

const SEND_ICON = (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

const SPARK_ICON = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2.5 5.5 13h5l-1.2 8.5L19 10h-5.2z" />
  </svg>
)

export function AIOverlay() {
  const pathname = usePathname()
  const isAIPage = pathname.startsWith('/ai')
  const user = useUser()
  const portal = usePortal()
  const userName = user?.full_name?.split(' ')[0] ?? 'there'

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageName, setPageName] = useState('this page')

  const inputRef = useRef<HTMLInputElement>(null)
  const panelInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Update page name whenever path changes
  useEffect(() => {
    const { pageName: p } = readPageContext()
    setPageName(p)
  }, [pathname])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Focus panel input when overlay opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => panelInputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Listen for external prompt events from insight cards
  useEffect(() => {
    if (isAIPage) return
    function onPrompt(e: Event) {
      const detail = (e as CustomEvent).detail as { prompt?: string } | undefined
      if (detail?.prompt) {
        setIsOpen(true)
        sendMessage(detail.prompt)
      }
    }
    window.addEventListener('strike-ai-prompt', onPrompt as EventListener)
    return () => window.removeEventListener('strike-ai-prompt', onPrompt as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIPage])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const { pageName: pn, contextData } = readPageContext()
    setPageName(pn)
    setInput('')
    setIsOpen(true)
    setLoading(true)

    const userMsg: Message = { role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)

    const systemPrompt = buildSystemPrompt(pn, contextData, userName, portal)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          portal,
          system: systemPrompt,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 500,
        }),
      })

      if (res.status === 429) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Daily AI limit reached. Resets at midnight UTC.', timestamp: new Date().toISOString() }])
        return
      }
      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Strike AI is temporarily unavailable. Please try again in a moment.', timestamp: new Date().toISOString() }])
        return
      }

      const data: { content?: { type: string; text?: string }[] } = await res.json()
      const reply = data.content?.find(b => b.type === 'text')?.text ?? data.content?.[0]?.text ?? 'No response'
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date().toISOString() }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Strike AI is temporarily unavailable. Please try again in a moment.', timestamp: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }, [loading, messages, portal, userName])

  const handlePillSubmit = () => {
    if (input.trim()) sendMessage(input)
  }

  if (isAIPage) return null

  return (
    <>
      <style>{`
        @keyframes overlay-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes panel-slide-up { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes bubble-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes thinking-pulse { 0%,100% { opacity: 0.4 } 50% { opacity: 1 } }
        .strike-pill-input:focus { outline: none }
        .strike-pill-input::placeholder { color: var(--gray-soft) }
        .strike-overlay-send:hover { background: var(--blue-hover) !important }
        .strike-overlay-send:disabled { opacity: 0.5; cursor: default }
      `}</style>

      {/* ── Backdrop ── */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(13,13,13,0.45)',
            backdropFilter: 'blur(2px)',
            animation: 'overlay-fade-in 0.18s ease',
          }}
        />
      )}

      {/* ── Chat panel (open state) ── */}
      {isOpen && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            width: 'min(680px, calc(100vw - 32px))',
            maxHeight: '72vh',
            zIndex: 201,
            background: 'var(--white)', borderRadius: '20px 20px 0 0',
            boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column',
            animation: 'panel-slide-up 0.22s ease',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px 12px 14px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}>
              {SPARK_ICON}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Strike AI</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pageName}
              </div>
            </div>
            <a
              href="/ai"
              style={{
                fontSize: 11, fontWeight: 600, color: 'var(--blue)',
                textDecoration: 'none', padding: '4px 10px',
                border: '1px solid var(--blue-light)',
                borderRadius: 999, background: 'var(--blue-light)',
                flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              Open Strike AI →
            </a>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--gray)', fontSize: 20, lineHeight: 1, padding: '0 0 0 4px',
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 10,
            minHeight: 80,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: '24px 0' }}>
                Ask me anything about {pageName.toLowerCase()}.
              </div>
            )}
            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} style={{
                  alignSelf: 'flex-end', maxWidth: '78%',
                  padding: '10px 14px',
                  background: 'var(--blue)', color: '#fff',
                  borderRadius: '18px 18px 4px 18px',
                  fontSize: 13, lineHeight: 1.55, wordBreak: 'break-word',
                  animation: 'bubble-in 0.18s ease',
                }}>
                  {m.content}
                </div>
              ) : (
                <div key={i} style={{
                  alignSelf: 'flex-start', maxWidth: '88%',
                  display: 'flex', gap: 8,
                  animation: 'bubble-in 0.18s ease',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                    background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  }}>
                    {SPARK_ICON}
                  </div>
                  <div style={{
                    padding: '10px 14px',
                    background: 'var(--offwhite)', border: '1px solid var(--border)',
                    borderRadius: '4px 18px 18px 18px',
                    fontSize: 13, color: 'var(--ink)', wordBreak: 'break-word',
                  }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              )
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                  {SPARK_ICON}
                </div>
                <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: '4px 18px 18px 18px' }}>
                  {[0, 1, 2].map(d => (
                    <div key={d} style={{
                      width: 6, height: 6, borderRadius: '50%', background: 'var(--gray)',
                      animation: `thinking-pulse 1.2s ease ${d * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px 14px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--offwhite)', borderRadius: 999,
              border: '1px solid var(--border)', padding: '6px 6px 6px 16px',
            }}>
              <input
                ref={panelInputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                placeholder={`Ask about ${pageName.toLowerCase()}...`}
                className="strike-pill-input"
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)',
                }}
              />
              <button
                type="button"
                className="strike-overlay-send"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
              >
                {SEND_ICON}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Persistent pill (closed state) ── */}
      {!isOpen && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          width: 'min(560px, calc(100vw - 48px))',
          zIndex: 150,
          background: 'var(--white)', borderRadius: 999,
          boxShadow: '0 2px 20px rgba(0,0,0,0.12)',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 6px 6px 14px',
          border: '1px solid var(--border)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          }}>
            {SPARK_ICON}
          </div>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePillSubmit() } }}
            onFocus={() => { /* could expand pill on focus */ }}
            placeholder={`Ask Strike AI about ${pageName.toLowerCase()}...`}
            className="strike-pill-input"
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)',
            }}
          />
          <button
            type="button"
            className="strike-overlay-send"
            onClick={handlePillSubmit}
            disabled={!input.trim()}
            style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
          >
            {SEND_ICON}
          </button>
        </div>
      )}
    </>
  )
}
