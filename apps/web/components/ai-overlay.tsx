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

function buildSystemPrompt(
  pageName: string,
  contextData: Record<string, unknown> | null,
  userName: string,
  portal: string,
  orgId: string | null,
) {
  const today = new Date().toISOString().split('T')[0]
  const ctx = contextData
    ? `\nPage context (live data the user sees):\n${JSON.stringify(contextData, null, 2)}`
    : ''
  return `You are Strike AI, the assistant built into Strike SCF. Strike AI is your only name.

Today: ${today}
User: ${userName} (${portal} portal)${orgId ? `\nOrg ID: ${orgId}` : ''}
Current page: ${pageName}${ctx}

You can see exactly what the user sees. Use the page context to answer questions about pricing, risk, offers, and whether terms are fair — reason directly from the data, no tools needed.

You have two tools available — use them only when the page context doesn't already have the answer:
- search_web: use for real-time market prices, commodity rates, benchmarks, or anything requiring live external data.
- get_financing_programs: use ONLY when the user asks about financing AND the page context contains no financing eligibility or deal financing info. If the page context already says "Can request financing: YES/NO" or describes financing types, answer from that — do NOT call this tool.

Keep replies concise: short paragraphs or bullets, no markdown headers. Bold key figures.
If the user asks to DO something (submit an offer, create a listing), tell them you can do that on the full Strike AI page and suggest they use the "Open Strike AI" button above.
Never invent data not in the page context.`
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
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

const SPARK_ICON = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2.5 5.5 13h5l-1.2 8.5L19 10h-5.2z" />
  </svg>
)

// Default position: bottom-right, above any page chrome
const DEFAULT_POS = { bottom: 88, right: 24 }
const WINDOW_WIDTH = 380
const WINDOW_HEIGHT = 480

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

  // Draggable position — stored as { top, left } once dragged, null = use default bottom-right
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, top: 0, left: 0 })

  const panelInputRef = useRef<HTMLInputElement>(null)
  const pillInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Update page name on navigation
  useEffect(() => {
    const { pageName: p } = readPageContext()
    setPageName(p)
  }, [pathname])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Focus panel input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => panelInputRef.current?.focus(), 40)
  }, [isOpen])

  // External prompt events (from insight cards)
  useEffect(() => {
    if (isAIPage) return
    function onPrompt(e: Event) {
      const detail = (e as CustomEvent).detail as { prompt?: string } | undefined
      if (detail?.prompt) { setIsOpen(true); sendMessage(detail.prompt) }
    }
    window.addEventListener('strike-ai-prompt', onPrompt as EventListener)
    return () => window.removeEventListener('strike-ai-prompt', onPrompt as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIPage])

  // Drag logic
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      const newTop = Math.max(8, Math.min(window.innerHeight - WINDOW_HEIGHT - 8, dragStart.current.top + dy))
      const newLeft = Math.max(8, Math.min(window.innerWidth - WINDOW_WIDTH - 8, dragStart.current.left + dx))
      setPos({ top: newTop, left: newLeft })
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget.closest('[data-chat-window]') as HTMLElement)?.getBoundingClientRect()
    if (!rect) return
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, top: rect.top, left: rect.left }
    e.preventDefault()
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const { pageName: pn, contextData } = readPageContext()
    setPageName(pn)
    setInput('')
    setLoading(true)

    const userMsg: Message = { role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)

    const systemPrompt = buildSystemPrompt(pn, contextData, userName, portal, user?.org_id ?? null)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          portal,
          overlay: true,
          system: systemPrompt,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 1024,
        }),
      })
      if (res.status === 429) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Daily AI limit reached. Resets at midnight UTC.', timestamp: new Date().toISOString() }])
        return
      }
      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Strike AI is temporarily unavailable. Please try again.', timestamp: new Date().toISOString() }])
        return
      }
      const data: { content?: { type: string; text?: string }[] } = await res.json()
      const reply = data.content?.find(b => b.type === 'text')?.text ?? data.content?.[0]?.text ?? 'No response'
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date().toISOString() }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Strike AI is temporarily unavailable. Please try again.', timestamp: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }, [loading, messages, portal, userName])

  if (isAIPage) return null

  // Position: use dragged pos if set, otherwise anchor to bottom-right
  const windowStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { bottom: DEFAULT_POS.bottom, right: DEFAULT_POS.right }

  return (
    <>
      <style>{`
        @keyframes strike-window-in { from { opacity: 0; transform: scale(0.95) translateY(6px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes strike-bubble-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes strike-thinking { 0%,100% { opacity: 0.35 } 50% { opacity: 1 } }
        .strike-pill-input::placeholder { color: var(--gray-soft) }
        .strike-pill-input:focus { outline: none }
        .strike-send-btn:hover:not(:disabled) { background: var(--blue-hover) !important }
        .strike-send-btn:disabled { opacity: 0.45; cursor: default }
        .strike-chat-msg-input:focus { outline: none }
        .strike-chat-msg-input::placeholder { color: var(--gray-soft) }
      `}</style>

      {/* ── Floating chat window ── */}
      {isOpen && (
        <div
          data-chat-window
          style={{
            position: 'fixed',
            ...windowStyle,
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            zIndex: 300,
            background: 'var(--white)',
            borderRadius: 20,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'strike-window-in 0.2s ease',
            border: '1px solid var(--border)',
          }}
        >
          {/* Header — drag handle */}
          <div
            onMouseDown={onHeaderMouseDown}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px 10px 14px',
              borderBottom: '1px solid var(--border)',
              cursor: 'grab', userSelect: 'none', flexShrink: 0,
              background: 'var(--white)',
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}>
              {SPARK_ICON}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>Strike AI</div>
              <div style={{ fontSize: 10, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {pageName}
              </div>
            </div>
            <a
              href="/ai"
              onMouseDown={e => e.stopPropagation()}
              style={{
                fontSize: 10, fontWeight: 600, color: 'var(--blue)',
                textDecoration: 'none', padding: '3px 8px',
                border: '1px solid var(--blue-light)', borderRadius: 999,
                background: 'var(--blue-light)', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              Open Strike AI →
            </a>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setIsOpen(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--gray)', fontSize: 18, lineHeight: 1,
                padding: '0 0 0 2px', flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px 12px 8px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 12, padding: '32px 16px' }}>
                Ask me anything about {pageName.toLowerCase()}.
              </div>
            )}
            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} style={{
                  alignSelf: 'flex-end', maxWidth: '80%',
                  padding: '9px 13px',
                  background: 'var(--blue)', color: '#fff',
                  borderRadius: '16px 16px 4px 16px',
                  fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word',
                  animation: 'strike-bubble-in 0.15s ease',
                }}>
                  {m.content}
                </div>
              ) : (
                <div key={i} style={{
                  alignSelf: 'flex-start', maxWidth: '90%',
                  display: 'flex', gap: 6,
                  animation: 'strike-bubble-in 0.15s ease',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                    background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  }}>
                    {SPARK_ICON}
                  </div>
                  <div style={{
                    padding: '9px 12px',
                    background: 'var(--offwhite)', border: '1px solid var(--border)',
                    borderRadius: '4px 16px 16px 16px',
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
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  flexShrink: 0,
                }}>
                  {SPARK_ICON}
                </div>
                <div style={{
                  padding: '9px 13px', display: 'flex', gap: 4, alignItems: 'center',
                  background: 'var(--offwhite)', border: '1px solid var(--border)',
                  borderRadius: '4px 16px 16px 16px',
                }}>
                  {[0, 1, 2].map(d => (
                    <div key={d} style={{
                      width: 5, height: 5, borderRadius: '50%', background: 'var(--gray)',
                      animation: `strike-thinking 1.2s ease ${d * 0.18}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '8px 10px 12px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--offwhite)', borderRadius: 999,
              border: '1px solid var(--border)', padding: '5px 5px 5px 12px',
            }}>
              <input
                ref={panelInputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                placeholder={`Ask about ${pageName.toLowerCase()}...`}
                className="strike-chat-msg-input"
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)',
                }}
              />
              <button
                type="button"
                className="strike-send-btn"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
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

      {/* ── Persistent pill ── */}
      {!isOpen && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 48px))',
          zIndex: 200,
          background: 'var(--white)', borderRadius: 999,
          boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 6px 6px 14px',
          border: '1px solid var(--border)',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          }}>
            {SPARK_ICON}
          </div>
          <input
            ref={pillInputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                e.preventDefault()
                setIsOpen(true)
                sendMessage(input)
              }
            }}
            placeholder={`Ask Strike AI about ${pageName.toLowerCase()}...`}
            className="strike-pill-input"
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)',
            }}
          />
          <button
            type="button"
            className="strike-send-btn"
            onClick={() => { if (input.trim()) { setIsOpen(true); sendMessage(input) } }}
            disabled={!input.trim()}
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
      )}
    </>
  )
}
