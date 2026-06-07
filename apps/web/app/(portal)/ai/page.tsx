'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'

// ============== Types ==============
interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isDocument?: boolean
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

const CONVERSATIONS_KEY = 'strike-ai-conversations'
// TF.1 — exact key required by the spec; persists the conversation-log collapse state.
const COLLAPSED_KEY = 'strike_ai_log_collapsed'
const MAX_CONVERSATIONS = 50

// ============== Helpers ==============
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {}
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isMessage(v: unknown): v is Message {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (o.role === 'user' || o.role === 'assistant') &&
    typeof o.content === 'string' &&
    typeof o.timestamp === 'string'
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string' &&
    Array.isArray(o.messages) &&
    o.messages.every(isMessage)
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConversation)
  } catch {
    return []
  }
}

function saveConversations(convos: Conversation[]) {
  try {
    const pruned = [...convos]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_CONVERSATIONS)
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(pruned))
  } catch {}
}

function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return 'New conversation'
  return firstUser.content.slice(0, 40) || 'New conversation'
}

function buildSystemPrompt(portal: string, page: string, userName?: string): string {
  return `You are Strike AI, the intelligent operating system embedded in Strike SCF — an AI-native supply chain finance platform.

You are not a chatbot. You are an autonomous agent that can take actions on the platform on behalf of the user.

Current user: ${userName ?? 'Unknown'}
Portal: ${portal}
Current page: ${page}

Your capabilities:
- Create listings on Strike Place
- Request financing on behalf of suppliers
- Generate professional documents (transaction summaries, KYB reports, audit logs)
- Retrieve PassportScore and risk data
- Answer questions about SCF workflows, platform features, and counterparty data

Rules:
1. Only reference data explicitly provided in context. Never invent figures.
2. When asked to take an action, confirm with the user before executing.
3. Be concise. Use bullet points for lists. Format currency as $X,XXX.
4. You speak to CFOs, Treasurers, and Trade Finance professionals. Institutional tone.`
}

const QUICK_PROMPTS: Record<string, string[]> = {
  supplier: [
    'List a product on Strike Place',
    'Request invoice financing',
    'Check my PassportScore',
    'Generate a trade summary',
  ],
  anchor: [
    'View pending supplier invoices',
    'Set up a financing program',
    'Invite suppliers',
    'Analyze supplier risk',
  ],
  bank: [
    'Review KYB queue',
    'Generate portfolio report',
    'Analyze risk exposure',
    'Approve pending transactions',
  ],
}

// Keywords that should surface an agentic confirmation card before executing.
const ACTION_KEYWORDS = ['list', 'create listing', 'request financing', 'upload', 'generate document', 'get score']

function describeAction(text: string): string | null {
  const t = text.toLowerCase()
  if (t.includes('create listing') || t.includes('list ')) return 'Create a new listing on Strike Place from your catalog data.'
  if (t.includes('request financing')) return 'Submit a financing request on your behalf using current invoice data.'
  if (t.includes('upload')) return 'Upload and attach a document to the relevant entity.'
  if (t.includes('generate document')) return 'Generate a professional document from the current context.'
  if (t.includes('get score')) return 'Retrieve PassportScore and risk data for the relevant organization.'
  if (t.includes('list')) return 'Create a new listing on Strike Place from your catalog data.'
  return null
}

function needsConfirmation(text: string): boolean {
  const t = text.toLowerCase()
  return ACTION_KEYWORDS.some(k => t.includes(k))
}

// TF.1 — subtle single-chevron glyph (‹ / ›) for the conversation-log collapse toggle.
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width={16} height={16} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {dir === 'left' ? <path d="M12 5l-5 5 5 5" /> : <path d="M8 5l5 5-5 5" />}
    </svg>
  )
}

// ============== Page ==============
export default function AIWorkspacePage() {
  const portal = usePortal()
  const user = useUser()
  const userName = user?.full_name || undefined

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ text: string; description: string } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Load on mount ──
  useEffect(() => {
    setConversations(loadConversations())
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {}
  }, [])

  const activeConvo = conversations.find(c => c.id === activeId) ?? null
  const messages = activeConvo?.messages ?? []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading, pendingAction])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  function newChat() {
    setActiveId(null)
    setPendingAction(null)
    setInput('')
    inputRef.current?.focus()
  }

  const persist = useCallback((convos: Conversation[]) => {
    setConversations(convos)
    saveConversations(convos)
  }, [])

  const runMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    setInput('')
    setLoading(true)

    const now = new Date().toISOString()
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: now }

    // Resolve or create the active conversation
    let convoId = activeId
    let working: Conversation[]
    if (convoId) {
      working = conversations.map(c =>
        c.id === convoId
          ? { ...c, messages: [...c.messages, userMsg], title: deriveTitle([...c.messages, userMsg]), updatedAt: now }
          : c
      )
    } else {
      convoId = newId()
      const fresh: Conversation = {
        id: convoId,
        title: deriveTitle([userMsg]),
        messages: [userMsg],
        createdAt: now,
        updatedAt: now,
      }
      working = [fresh, ...conversations]
      setActiveId(convoId)
    }
    persist(working)

    const convoMessages = working.find(c => c.id === convoId)?.messages ?? [userMsg]
    const isDocRequest = trimmed.toLowerCase().includes('document') || trimmed.toLowerCase().includes('report') || trimmed.toLowerCase().includes('summary')

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          model: 'sonnet',
          system: buildSystemPrompt(portal, 'ai', userName),
          messages: convoMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 2048,
        }),
      })

      let reply: string
      if (res.status === 429) {
        reply = 'Daily AI limit reached. Resets at midnight UTC.'
      } else {
        const data = await res.json()
        reply = data.content?.find?.((b: { type: string; text?: string }) => b.type === 'text')?.text
          ?? data.content?.[0]?.text
          ?? 'No response'
      }

      const replyTime = new Date().toISOString()
      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: replyTime, isDocument: isDocRequest }
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === convoId
            ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: replyTime }
            : c
        )
        saveConversations(updated)
        return updated
      })
    } catch {
      const errTime = new Date().toISOString()
      const errMsg: Message = { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.', timestamp: errTime }
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === convoId ? { ...c, messages: [...c.messages, errMsg], updatedAt: errTime } : c
        )
        saveConversations(updated)
        return updated
      })
    } finally {
      setLoading(false)
    }
  }, [activeId, conversations, loading, persist, portal, userName])

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    const description = describeAction(trimmed)
    if (needsConfirmation(trimmed) && description) {
      setPendingAction({ text: trimmed, description })
      setInput('')
      return
    }
    runMessage(trimmed)
  }

  function confirmAction() {
    if (!pendingAction) return
    const { text } = pendingAction
    setPendingAction(null)
    runMessage(text)
  }

  const quickPrompts = QUICK_PROMPTS[portal] ?? QUICK_PROMPTS.bank!
  const contextBadge = portal.charAt(0).toUpperCase() + portal.slice(1) + ' Portal'

  return (
    <>
      <style>{`
        @keyframes strike-ai-spin { to { transform: rotate(360deg); } }
        @keyframes strike-ai-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .strike-ai-newchat:hover { background: var(--blue-hover) !important; }
        .strike-ai-quick:hover { border-color: var(--blue) !important; }
        .strike-ai-convo:hover { background: var(--offwhite); }
        /* TF.1 — subtle icon-only collapse chevron */
        .strike-ai-log-toggle { color: var(--gray-soft); transition: color 0.15s, background 0.15s; }
        .strike-ai-log-toggle:hover { color: var(--ink); background: var(--offwhite); }
      `}</style>

      <div style={{ display: 'flex', flex: 1, height: '100vh', overflow: 'hidden', position: 'relative' }}>

        {/* ── LEFT: Conversation history (claude.ai pattern — TF.1) ── */}
        <div style={{
          width: collapsed ? 0 : 280,
          flexShrink: 0,
          height: '100%',
          background: 'var(--white)',
          borderRight: collapsed ? 'none' : '1px solid var(--border)',
          overflow: 'hidden',
          transition: 'width 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '16px 12px 12px 16px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid var(--border)',
            minWidth: 280, /* keep header from reflowing while the panel collapses */
          }}>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>Strike AI</span>
            <button
              type="button"
              className="strike-ai-newchat"
              onClick={newChat}
              style={{
                padding: '6px 12px', borderRadius: 999, background: 'var(--blue)',
                color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                transition: 'background 0.15s', flexShrink: 0,
              }}
            >
              New Chat
            </button>
            {/* Collapse chevron — icon only, top-right of the panel */}
            <button
              type="button"
              className="strike-ai-log-toggle"
              onClick={toggleCollapsed}
              aria-label="Collapse conversation history"
              title="Collapse"
              style={{
                width: 28, height: 28, flexShrink: 0, borderRadius: 8,
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Chevron dir="left" />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {conversations.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
                No conversations yet
              </div>
            ) : (
              [...conversations]
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .map(c => {
                  const active = c.id === activeId
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="strike-ai-convo"
                      onClick={() => { setActiveId(c.id); setPendingAction(null) }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '10px 12px',
                        borderRadius: 8, cursor: 'pointer', border: 'none',
                        borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                        background: active ? 'var(--color-accent-light)' : 'transparent',
                        marginBottom: 2, display: 'block',
                      }}
                    >
                      <div style={{
                        fontSize: 13, color: 'var(--ink)', fontWeight: active ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {c.title || 'New conversation'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                        {relativeTime(c.updatedAt)}
                      </div>
                    </button>
                  )
                })
            )}
          </div>
        </div>

        {/* Expand chevron — only visible when collapsed; sits at the top-left of the chat pane */}
        {collapsed && (
          <button
            type="button"
            className="strike-ai-log-toggle"
            onClick={toggleCollapsed}
            aria-label="Expand conversation history"
            title="Expand"
            style={{
              position: 'absolute', left: 10, top: 14,
              width: 28, height: 28, borderRadius: 8, zIndex: 10,
              background: 'var(--white)', border: '1px solid var(--border)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Chevron dir="right" />
          </button>
        )}

        {/* ── RIGHT: Chat ── */}
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header (left padding grows when collapsed to clear the expand chevron) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px', paddingLeft: collapsed ? 48 : 18,
            borderBottom: '1px solid var(--border)', flexShrink: 0,
            transition: 'padding-left 0.2s ease',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>S</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Strike AI</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>Supply chain intelligence</div>
            </div>
            <span style={{
              padding: '4px 10px', borderRadius: 999, background: 'var(--color-accent-light)',
              color: 'var(--blue)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {contextBadge}
            </span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {messages.length === 0 && !loading && !pendingAction ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 6 }}>
                <img src="/favicon.png" alt="" draggable={false} style={{ width: 56, height: 56, objectFit: 'contain', animation: 'strike-ai-spin 4s linear infinite' }} />
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-display)', marginTop: 8 }}>Strike AI</div>
                <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>Your autonomous supply chain finance agent</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 480, width: '100%' }}>
                  {quickPrompts.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="strike-ai-quick"
                      onClick={() => submit(p)}
                      style={{
                        padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)',
                        background: 'var(--white)', cursor: 'pointer', textAlign: 'left',
                        fontSize: 13, color: 'var(--ink)', transition: 'border-color 0.15s',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 3, animation: 'strike-ai-in 0.2s ease' }}>
                    {m.role === 'user' ? (
                      <div style={{
                        maxWidth: '80%', padding: '10px 14px', background: 'var(--blue)', color: '#fff',
                        borderRadius: '20px 20px 4px 20px', fontSize: 13, lineHeight: 1.65,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {m.content}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, maxWidth: '92%' }}>
                        <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0, marginTop: 2 }} />
                        <div style={{
                          padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)',
                          borderRadius: '4px 20px 20px 20px', fontSize: 13, lineHeight: 1.65,
                          color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.content}
                        </div>
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--gray-soft)', paddingLeft: m.role === 'assistant' ? 28 : 0 }}>
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}

                {/* Agentic confirmation card */}
                {pendingAction && (
                  <div style={{
                    background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12,
                    padding: 16, animation: 'strike-ai-in 0.2s ease', maxWidth: '92%',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                      Strike AI wants to execute an action
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.5, marginBottom: 14 }}>
                      {pendingAction.description}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={confirmAction}
                        style={{
                          padding: '8px 16px', borderRadius: 999, background: 'var(--blue)', color: '#fff',
                          border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        }}
                      >
                        Execute
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction(null)}
                        style={{
                          padding: '8px 16px', borderRadius: 999, background: 'transparent',
                          color: 'var(--ink)', border: '1px solid var(--border)', cursor: 'pointer',
                          fontSize: 13, fontWeight: 600,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {loading && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', animation: 'strike-ai-in 0.2s ease' }}>
                    <img src="/favicon.png" alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain', animation: 'strike-ai-spin 0.9s linear infinite' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)' }}>Thinking</span>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 18px 18px', flexShrink: 0 }}>
            <div style={{
              minHeight: 56, borderRadius: 28, background: 'var(--white)',
              boxShadow: 'var(--shadow-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
            }}>
              <button
                type="button"
                aria-label="Upload"
                style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit(input)
                  }
                }}
                rows={1}
                placeholder="Ask Strike anything..."
                style={{
                  flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-body)',
                  padding: '17px 0', lineHeight: 1.3, maxHeight: 120,
                }}
              />
              <button
                type="button"
                aria-label="Send"
                onClick={() => submit(input)}
                disabled={!input.trim() || loading}
                style={{
                  width: 40, height: 40, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)',
                  color: '#fff', border: 'none',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  opacity: input.trim() && !loading ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
