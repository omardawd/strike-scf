'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'

// ============== Types ==============
interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isDocument?: boolean
  attachmentName?: string // filename pill for display; full file text is embedded in content
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

function buildSystemPrompt(portal: string, page: string, userName?: string, orgId?: string, bankId?: string): string {
  const identity = [
    orgId   ? `org_id: ${orgId}`   : null,
    bankId  ? `bank_id: ${bankId}` : null,
  ].filter(Boolean).join('\n')

  const today = new Date().toISOString().split('T')[0]

  return `You are Strike AI, the intelligent operating system embedded in Strike SCF — an AI-native supply chain finance platform.

You are an autonomous agent that takes actions on the platform on behalf of the user. When you have enough information to complete an action, execute it immediately using the appropriate tool — do not ask for confirmation unless a genuinely required field is missing.

Today's date: ${today}
Current user: ${userName ?? 'Unknown'}
Portal: ${portal}
Current page: ${page}
${identity ? `\nUser identity (use these IDs when calling tools):\n${identity}` : ''}

Your tools:
- search_marketplace_listings — find existing listings on Strike Place. After returning results, emit [LISTING_CARD:{id}] on its own line for EACH listing so the user gets a clickable card.
- submit_marketplace_offer — submit an offer ON an existing listing. Use this when the user wants to bid or respond to a listing someone else posted. NEVER use create_marketplace_listing for this.
- create_marketplace_listing — post a NEW listing (your own product/service or PO request). ALWAYS ask about incoterms and payment terms first. After creating, emit [LISTING_CARD:{listing_id}] on its own line.
- get_active_deals — list all active (non-completed, non-cancelled) deals for an org
- evaluate_supplier_passport — deep evaluation of a supplier's trust score, financials, history
- find_and_recommend_deals — match and score deals between buyer/supplier
- get_pricing_insights — internal platform benchmarks + live external market pricing
- summarize_deal_negotiation — timeline, open issues, and suggested next steps for a deal
- score_and_rank_financing_offers — rank bank offers by cost, speed, or flexibility
- detect_deal_risk_signals — fraud, compliance, payment, and delivery risk signals on a deal
- recommend_suppliers_for_buyer — find the best-matched suppliers for a buyer's needs
- generate_deal_term_sheet — structured term sheet with parties, goods, payment, and financing
- proactive_portfolio_alerts — overdue, at-risk, and concentration alerts (bank users only)

Rules:
1. Only reference data explicitly returned by tools or provided in context. Never invent figures.
2. Be concise. Use bullet points for lists. Format currency as $X,XXX.
3. You speak to CFOs, Treasurers, and Trade Finance professionals. Institutional tone.
4. Always use today's date (${today}) when creating listings or term sheets — never use a past year.`
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

const LISTING_CARD_RE = /\[LISTING_CARD:([0-9a-f-]{36})\]/gi

function ListingCard({ id }: { id: string }) {
  return (
    <a
      href={`/marketplace/listings/${id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '8px 0', padding: '12px 16px',
        background: 'var(--white)', border: '1px solid var(--border)',
        borderRadius: 12, textDecoration: 'none', color: 'var(--ink)',
        fontSize: 13, fontWeight: 600, boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: 'var(--blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M7 10h6M7 13h4" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>View listing on Strike Place</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>Click to open your new listing →</div>
      </div>
    </a>
  )
}

const MD_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '14px 0 6px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '12px 0 5px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ children }: any) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: '10px 0 4px' }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children }: any) => <div style={{ margin: '4px 0', lineHeight: 1.65 }}>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong: ({ children }: any) => <strong style={{ fontWeight: 700, color: 'var(--ink)' }}>{children}</strong>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  em: ({ children }: any) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  hr: () => <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ul>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</ol>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children }: any) => <li style={{ lineHeight: 1.6, color: 'var(--ink)' }}>{children}</li>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: ({ children }: any) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>{children}</table>
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thead: ({ children }: any) => <thead style={{ background: 'var(--offwhite)' }}>{children}</thead>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th: ({ children }: any) => <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{children}</th>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td: ({ children }: any) => <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{children}</td>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: ({ children }: any) => <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--offwhite)', padding: '1px 5px', borderRadius: 4 }}>{children}</code>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote: ({ children }: any) => <div style={{ borderLeft: '3px solid var(--border-strong)', paddingLeft: 10, margin: '6px 0', color: 'var(--gray)' }}>{children}</div>,
}

function renderAssistantContent(content: string): React.ReactNode {
  // Split on [LISTING_CARD:uuid] tokens — render each segment separately
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  LISTING_CARD_RE.lastIndex = 0
  while ((match = LISTING_CARD_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before) {
      parts.push(
        <ReactMarkdown key={`md-${lastIndex}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {before}
        </ReactMarkdown>
      )
    }
    const listingId = match[1]!
    parts.push(<ListingCard key={listingId} id={listingId} />)
    lastIndex = match.index + match[0].length
  }
  const remainder = content.slice(lastIndex).trim()
  if (remainder) {
    parts.push(
      <ReactMarkdown key={`md-${lastIndex}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {remainder}
      </ReactMarkdown>
    )
  }
  return <>{parts}</>
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
  const [loadingPhrase, setLoadingPhrase] = useState('Thinking')
  const [collapsed, setCollapsed] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ text: string; description: string } | null>(null)
  const [attachment, setAttachment] = useState<{ filename: string; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load on mount ──
  useEffect(() => {
    setConversations(loadConversations())
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {}
  }, [])

  // ── Cycle loading phrases while the agent is working ──
  const LOADING_PHRASES = [
    'Thinking', 'Analyzing', 'Researching', 'Evaluating',
    'Structuring', 'Calculating', 'Synthesizing', 'Strategizing',
    'Calibrating', 'Sourcing', 'Deliberating', 'Processing',
    'Negotiating', 'Weighing options', 'Cross-referencing',
  ]
  useEffect(() => {
    if (!loading) {
      setLoadingPhrase('Thinking')
      return
    }
    let idx = 0
    const tick = () => {
      idx = (idx + 1) % LOADING_PHRASES.length
      setLoadingPhrase(LOADING_PHRASES[idx] ?? 'Thinking')
    }
    const id = setInterval(tick, 1800)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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

  const runMessage = useCallback(async (text: string, attachmentName?: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    setInput('')
    setLoading(true)

    const now = new Date().toISOString()
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: now, attachmentName }

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
          portal,
          system: buildSystemPrompt(portal, 'ai', userName, user?.org_id ?? undefined, user?.bank_id ?? undefined),
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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/ai/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Upload failed'); return }
      setAttachment({ filename: data.filename as string, text: data.text as string })
      inputRef.current?.focus()
    } catch {
      alert('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function submit(text: string) {
    const trimmed = text.trim()
    if ((!trimmed && !attachment) || loading) return

    if (attachment) {
      const userTyped = trimmed || 'Please analyze this document.'
      const fullContent = `[Attached document: "${attachment.filename}"]\n\n${attachment.text}\n\n---\n\n${userTyped}`
      const att = attachment
      setAttachment(null)
      setInput('')
      runMessage(fullContent, att.filename)
    } else {
      runMessage(trimmed)
    }
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
        @keyframes strike-ai-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes strike-ai-dot { 0%,80%,100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
        @keyframes strike-ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
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
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                <path d="M16 4.5v2M15 5.5h2" />
              </svg>
            </div>
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
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 32px rgba(20,40,204,0.22)',
                }}>
                  <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                    <path d="M16 4.5v2M15 5.5h2" />
                  </svg>
                </div>
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
                      <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {m.attachmentName && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                            background: 'var(--blue-light)', borderRadius: 8,
                            fontSize: 11, fontWeight: 600, color: 'var(--blue)', maxWidth: '100%',
                          }}>
                            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{m.attachmentName}</span>
                          </div>
                        )}
                        <div style={{
                          padding: '10px 14px', background: 'var(--blue)', color: '#fff',
                          borderRadius: '20px 20px 4px 20px', fontSize: 13, lineHeight: 1.65,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.attachmentName && m.content.includes('\n\n---\n\n')
                            ? (m.content.split('\n\n---\n\n').at(-1) ?? m.content)
                            : m.content}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, maxWidth: '92%' }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                          background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                            <path d="M16 4.5v2M15 5.5h2" />
                          </svg>
                        </div>
                        <div style={{
                          padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)',
                          borderRadius: '4px 20px 20px 20px', fontSize: 13, lineHeight: 1.65,
                          color: 'var(--ink)', wordBreak: 'break-word',
                        }}>
                          {renderAssistantContent(m.content)}
                        </div>
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', paddingLeft: m.role === 'assistant' ? 28 : 0 }}>
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
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: 'linear-gradient(135deg, var(--blue) 0%, #7C3AED 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                        <path d="M16 4.5v2M15 5.5h2" />
                      </svg>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{
                          width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block',
                          animation: `strike-ai-dot 1.2s ${i * 0.2}s ease-in-out infinite`,
                        }} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 18px 18px', flexShrink: 0 }}>
            {/* Attachment pill */}
            {attachment && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 10px', background: 'var(--blue-light)', borderRadius: 10, width: 'fit-content', maxWidth: '100%' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                  {attachment.filename}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                >
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
            <div style={{
              minHeight: 56, borderRadius: 28, background: 'var(--white)',
              boxShadow: 'var(--shadow-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
            }}>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.json,.md,.docx,.doc"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                aria-label={uploading ? 'Uploading…' : 'Attach file'}
                onClick={() => !uploading && fileInputRef.current?.click()}
                disabled={uploading}
                title="Attach a file (PDF, image, text, CSV)"
                style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: '50%',
                  background: uploading ? 'var(--gray-soft)' : attachment ? 'var(--blue-hover)' : 'var(--blue)',
                  color: '#fff', border: 'none', cursor: uploading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
              >
                {uploading ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" style={{ animation: 'strike-ai-spin 0.9s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10" />
                  </svg>
                ) : (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
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
                placeholder={attachment ? `Ask about ${attachment.filename}…` : 'Ask Strike anything…'}
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
                disabled={(!input.trim() && !attachment) || loading}
                style={{
                  width: 40, height: 40, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)',
                  color: '#fff', border: 'none',
                  cursor: (input.trim() || attachment) && !loading ? 'pointer' : 'default',
                  opacity: (input.trim() || attachment) && !loading ? 1 : 0.5,
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
