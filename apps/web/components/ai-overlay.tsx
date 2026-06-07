'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface AIOverlayProps {
  portal: 'bank' | 'anchor' | 'supplier'
  userName?: string
}

function readContext(): { pageName: string; contextData: unknown } {
  let pageName = 'this page'
  let contextData: unknown = null
  try {
    const el = document.querySelector('[data-ai-context]')
    const raw = el?.getAttribute('data-ai-context')
    if (raw) contextData = JSON.parse(raw)
  } catch {
    contextData = null
  }
  try {
    const nameEl = document.querySelector('[data-page-name]')
    pageName = nameEl?.getAttribute('data-page-name') || document.title || 'this page'
  } catch {
    pageName = 'this page'
  }
  return { pageName, contextData }
}

const UPLOAD_ICON = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const SEND_ICON = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

// TF.2 — Strike spark/bolt mark for the always-present floating trigger button.
const TRIGGER_ICON = (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13 2.5 5.5 13h5l-1.2 8.5L19 10h-5.2z" />
  </svg>
)

export function AIOverlay({ portal, userName }: AIOverlayProps) {
  const pathname = usePathname()
  const isAIPage = pathname.startsWith('/ai')

  const [pillVisible, setPillVisible] = useState(false)
  const [focused, setFocused] = useState(false)
  const [input, setInput] = useState('')

  const [clusterOpen, setClusterOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  // TF.2 — unread "signal" count on the floating trigger.
  // NOTE: `ai_signals` is not yet in the live schema (see apps/web/CLAUDE.md), so the
  // badge is wired to the user's unread notifications (GET /api/notifications), which is
  // the closest existing org/user-scoped "active signals" source. Fully fail-soft:
  // any error or a zero count renders no badge.
  const [signalCount, setSignalCount] = useState(0)

  // Cluster drag position
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, top: 0, left: 0 })

  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)

  // ── Hover-trigger detection ──
  useEffect(() => {
    if (isAIPage) return
    function onMove(e: MouseEvent) {
      const inZone = e.clientY > window.innerHeight - 80
      hovering.current = inZone
      setPillVisible(inZone || focused || input.trim().length > 0)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [isAIPage, focused, input])

  // Keep pill visible while focused or has text
  useEffect(() => {
    if (focused || input.trim().length > 0) setPillVisible(true)
    else if (!hovering.current) setPillVisible(false)
  }, [focused, input])

  // ── TF.2: unread signal count for the trigger badge (fail-soft) ──
  useEffect(() => {
    if (isAIPage) return
    let cancelled = false
    async function loadSignals() {
      try {
        const res = await fetch('/api/notifications?unread_only=true&limit=100')
        if (!res.ok) return
        const data = await res.json()
        const count = typeof data?.unread_count === 'number'
          ? data.unread_count
          : Array.isArray(data?.notifications) ? data.notifications.length : 0
        if (!cancelled) setSignalCount(count > 0 ? count : 0)
      } catch {
        if (!cancelled) setSignalCount(0)
      }
    }
    loadSignals()
    const id = window.setInterval(loadSignals, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
    // Refetch when the cluster closes — the user may have acted on signals.
  }, [isAIPage, clusterOpen])

  // ── Listen for external prompt events (from insight cards) ──
  useEffect(() => {
    if (isAIPage) return
    function onPrompt(e: Event) {
      const detail = (e as CustomEvent).detail as { prompt?: string } | undefined
      if (detail?.prompt) {
        setClusterOpen(true)
        send(detail.prompt)
      }
    }
    window.addEventListener('strike-ai-prompt', onPrompt as EventListener)
    return () => window.removeEventListener('strike-ai-prompt', onPrompt as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAIPage])

  // ── Escape closes cluster ──
  useEffect(() => {
    if (!clusterOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setClusterOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clusterOpen])

  // ── Cluster drag ──
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      setPos({
        top: Math.max(8, dragStart.current.top + dy),
        left: Math.max(8, Math.min(window.innerWidth - 380, dragStart.current.left + dx)),
      })
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget.closest('[data-cluster]') as HTMLElement)?.getBoundingClientRect()
    dragging.current = true
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      top: rect ? rect.top : 72,
      left: rect ? rect.left : window.innerWidth - 404,
    }
    e.preventDefault()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const { pageName, contextData } = readContext()
    setInput('')
    setClusterOpen(true)
    setLoading(true)

    const next: Message[] = [
      ...messages,
      { role: 'user', content: trimmed, timestamp: new Date().toISOString() },
    ]
    setMessages(next)

    const systemPrompt = `You are Strike AI. You can see what the user sees.
Page: ${pageName}
${contextData ? `Page context: ${JSON.stringify(contextData)}` : ''}
User: ${userName ?? 'Unknown'} (${portal} portal)
Answer concisely. You are an overlay — keep responses brief and actionable.`

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          model: undefined,
          system: systemPrompt,
          messages: next.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 1024,
        }),
      })
      if (res.status === 429) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Daily AI limit reached. Resets at midnight UTC.',
          timestamp: new Date().toISOString(),
        }])
        return
      }
      const data = await res.json()
      const reply: string = data.content?.find?.((b: { type: string; text?: string }) => b.type === 'text')?.text
        ?? data.content?.[0]?.text
        ?? 'No response'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setLoading(false)
    }
  }, [loading, messages, portal, userName])

  if (isAIPage) return null

  const showPill = pillVisible && !clusterOpen

  return (
    <>
      <style>{`
        @keyframes strike-overlay-spin { to { transform: rotate(360deg); } }
        @keyframes strike-overlay-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        /* TF.2 — floating Strike AI trigger button */
        .strike-ai-fab { transition: background 0.15s, box-shadow 0.15s; }
        .strike-ai-fab:hover { background: var(--blue-hover); box-shadow: var(--shadow-elevated); }
      `}</style>

      {/* Trigger zone */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 80,
        pointerEvents: 'none', zIndex: 140,
      }} />

      {/* Pill input */}
      <div style={{
        position: 'fixed', bottom: 16, left: '50%', zIndex: 150,
        width: 'min(680px, calc(100vw - 48px))', height: 56,
        background: 'var(--white)', borderRadius: 999,
        boxShadow: 'var(--shadow-elevated)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
        transition: 'transform 0.2s ease-out, opacity 0.2s ease-out',
        transform: showPill ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(160%)',
        opacity: showPill ? 1 : 0,
        pointerEvents: showPill ? 'auto' : 'none',
      }}>
        <button
          type="button"
          aria-label="Upload"
          style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: '50%',
            background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {UPLOAD_ICON}
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); send(input) }
          }}
          placeholder="Ask Strike anything..."
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-body)',
          }}
        />
        <button
          type="button"
          aria-label="Send"
          onClick={() => send(input)}
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: '50%',
            background: 'var(--blue)', color: '#fff', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {SEND_ICON}
        </button>
      </div>

      {/* TF.2 — always-present floating trigger button. Hidden while the cluster is open,
          and while the centered hover-pill is showing (they'd overlap on narrow viewports
          and are redundant entry points in that moment).
          Clicking opens the Strike AI overlay; a red badge surfaces unread signals. */}
      {!clusterOpen && !showPill && (
        <button
          type="button"
          className="strike-ai-fab"
          aria-label={signalCount > 0 ? `Open Strike AI (${signalCount} unread)` : 'Open Strike AI'}
          title="Strike AI"
          onClick={() => setClusterOpen(true)}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 150,
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {TRIGGER_ICON}
          {signalCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18,
                padding: '0 5px', borderRadius: 999,
                background: 'var(--color-red)', color: '#fff',
                fontSize: 10, fontWeight: 700, lineHeight: '18px',
                fontFamily: 'var(--font-body)', textAlign: 'center',
                border: '2px solid var(--white)', boxSizing: 'content-box',
              }}
            >
              {signalCount > 9 ? '9+' : signalCount}
            </span>
          )}
        </button>
      )}

      {/* Floating cluster */}
      {clusterOpen && (
        <div
          data-cluster
          style={{
            position: 'fixed',
            top: pos ? pos.top : 72,
            ...(pos ? { left: pos.left } : { right: 24 }),
            width: 380, maxHeight: 480, zIndex: 180,
            background: 'var(--white)', borderRadius: 20,
            boxShadow: 'var(--shadow-elevated)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header / drag handle */}
          <div
            onMouseDown={onHeaderDown}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 14px', borderBottom: '1px solid var(--border)',
              cursor: dragging.current ? 'grabbing' : 'grab', userSelect: 'none', flexShrink: 0,
            }}
          >
            <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Strike AI</span>
            <span style={{ fontSize: 11, color: 'var(--gray)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {readContext().pageName}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setClusterOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 18, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} style={{
                  alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 14px',
                  background: 'var(--blue)', color: '#fff',
                  borderRadius: '20px 20px 4px 20px', fontSize: 13, lineHeight: 1.55,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', animation: 'strike-overlay-in 0.2s ease',
                }}>
                  {m.content}
                </div>
              ) : (
                <div key={i} style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', maxWidth: '92%', animation: 'strike-overlay-in 0.2s ease' }}>
                  <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0, marginTop: 2 }} />
                  <div style={{
                    padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)',
                    borderRadius: '4px 20px 20px 20px', fontSize: 13, lineHeight: 1.55,
                    color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {m.content}
                  </div>
                </div>
              )
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', alignItems: 'center' }}>
                <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', animation: 'strike-overlay-spin 0.9s linear infinite' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)' }}>Thinking</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              border: '1px solid var(--border)', borderRadius: 999, padding: '4px 4px 4px 14px',
            }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(input) } }}
                placeholder="Ask Strike anything..."
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)' }}
              />
              <button
                type="button"
                aria-label="Send"
                onClick={() => send(input)}
                disabled={loading}
                style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: '50%',
                  background: 'var(--blue)', color: '#fff', border: 'none',
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {SEND_ICON}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
