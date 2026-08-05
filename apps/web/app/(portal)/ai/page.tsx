'use client'
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { SkeletonCard } from '@/components/motion'
import { renderAssistantContent } from '@/components/ai-chat-message'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import {
  type Message, type Conversation,
  newId, loadConversations, saveConversations, deriveTitle,
} from '@/lib/ai/conversation-store'
import { useT, useLocale } from '@/lib/i18n/locale-context'
import { TaskThreadView, StatusBadge, friendlyToolLabel, timeSince, type AgentTask } from '@/components/agent-task-thread'

type TFn = (key: string, vars?: Record<string, string | number>) => string

// TF.1 — exact key required by the spec; persists the conversation-log collapse state.
const COLLAPSED_KEY = 'strike_ai_log_collapsed'

// ============== Helpers ==============
function relativeTime(iso: string, t: TFn): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  if (diff < 60_000) return t('aiPage.justNow')
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ${t('aiPage.ago')}`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ${t('aiPage.ago')}`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ${t('aiPage.ago')}`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

function describeAction(text: string, t: TFn): string | null {
  const lower = text.toLowerCase()
  if (lower.includes('create listing') || lower.includes('list ')) return t('aiPage.actionCreateListing')
  if (lower.includes('request financing')) return t('aiPage.actionRequestFinancing')
  if (lower.includes('upload')) return t('aiPage.actionUpload')
  if (lower.includes('generate document')) return t('aiPage.actionGenerateDocument')
  if (lower.includes('get score')) return t('aiPage.actionGetScore')
  if (lower.includes('list')) return t('aiPage.actionCreateListing')
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

function AgentPanel({ orgId, initialOpenTaskId }: { orgId: string; initialOpenTaskId?: string | null }) {
  void orgId
  const router = useRouter()
  const t = useT()
  const [tasks, setTasks]         = useState<AgentTask[]>([])
  const [counts, setCounts]       = useState({ pending: 0, completed: 0 })
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<'all' | 'awaiting_approval' | 'completed'>('all')
  const [scanRunning, setScanRunning] = useState(false)
  const [scanMsg, setScanMsg]     = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  // A sidebar click on an agent-originated thread jumps straight here.
  useEffect(() => {
    if (initialOpenTaskId) setOpenTaskId(initialOpenTaskId)
  }, [initialOpenTaskId])

  const loadTasks = useCallback(async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetch(`/api/agents/tasks${params}`)
      if (!res.ok) return
      const data = await res.json()
      setTasks(data.tasks ?? [])
      setCounts(data.counts ?? { pending: 0, completed: 0 })
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { loadTasks() }, [loadTasks])

  async function runScan() {
    setScanRunning(true)
    setScanMsg(null)
    try {
      const res = await fetch('/api/agents/scan', { method: 'POST' })
      const json = await res.json()
      setScanMsg(json.message ?? t('agentSettings.scanComplete'))
      await loadTasks()
    } finally { setScanRunning(false) }
  }

  if (openTaskId) {
    return (
      <TaskThreadView
        taskId={openTaskId}
        onBack={() => { setOpenTaskId(null); loadTasks() }}
      />
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{t('aiPage.agentTaskQueue')}</h2>
          <p style={{ fontSize: 13, color: 'var(--gray)', margin: '3px 0 0' }}>
            {t('aiPage.pendingCompletedCounts', { pending: counts.pending, completed: counts.completed })}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => router.push('/settings/agent')}
        >
          {t('aiPage.agentSettings')}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={runScan}
          disabled={scanRunning}
        >
          {scanRunning ? t('agentSettings.scanning') : t('aiPage.runScan')}
        </button>
      </div>

      {scanMsg && (
        <div style={{ padding: '10px 14px', background: '#EDFAF4', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-green)', marginBottom: 16 }}>
          {scanMsg}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['all', 'awaiting_approval', 'completed'] as const).map((f) => (
          <button
            key={f}
            className="btn btn-ghost btn-sm"
            onClick={() => setFilter(f)}
            style={{
              fontWeight: filter === f ? 700 : 400,
              background: filter === f ? 'var(--blue-light)' : undefined,
              color: filter === f ? 'var(--blue)' : undefined,
            }}
          >
            {f === 'all' ? t('common.all') : f === 'awaiting_approval' ? t('aiPage.pendingCount', { count: counts.pending }) : t('aiPage.doneCount', { count: counts.completed })}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} height={110} />)}
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--gray)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t('aiPage.noTasksYet')}</div>
          <div style={{ fontSize: 13 }}>{t('aiPage.runScanHint')}</div>
        </div>
      ) : (
        <div className="reveal-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {tasks.map((task) => (
            <button
              key={task.id}
              className="card-interactive"
              onClick={() => setOpenTaskId(task.active_task_id ?? task.id)}
              data-demo-target={`agent-task-${task.id}`}
              style={{
                textAlign: 'left',
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)',
                padding: '18px 20px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge status={task.status} />
                <span style={{ fontSize: 11, color: 'var(--gray)' }}>
                  {friendlyToolLabel(task.proposed_action?.tool_name, t)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--gray-soft)', marginLeft: 'auto' }}>
                  {new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{task.title}</div>
              {task.body && (
                <div style={{
                  fontSize: 13, color: 'var(--gray)', lineHeight: 1.5,
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {task.body}
                </div>
              )}
              {task.status === 'executing' && task.negotiation && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--blue)', fontWeight: 600, marginTop: 2 }}>
                  {task.negotiation.status === 'active' && !task.negotiation.halt_requested && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-green)', animation: 'badge-pulse 2.4s ease infinite', flexShrink: 0 }} />
                  )}
                  {t('aiPage.roundOfLastChecked', { round: task.negotiation.current_round, max: task.plan?.max_rounds ?? '—', time: timeSince(task.negotiation.last_tick_at, t) })}
                </div>
              )}
              {task.plan && task.plan.guardrails_configured === false && task.status === 'awaiting_approval' && (
                <div style={{ fontSize: 11, color: '#92620A', fontWeight: 600, marginTop: 2 }}>
                  {t('aiPage.noPriceGuardrails')}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600, marginTop: 4 }}>{t('aiPage.openChat')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============== Page ==============
function AIWorkspaceInner() {
  const portal = usePortal()
  const user = useUser()
  const userName = user?.full_name || undefined
  const searchParams = useSearchParams()
  const router = useRouter()
  const t = useT()
  const { locale } = useLocale()

  const [activeTab, setActiveTab] = useState<'chat' | 'agent'>(
    searchParams.get('tab') === 'agent' ? 'agent' : 'chat'
  )

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingPhrase, setLoadingPhrase] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ text: string; description: string } | null>(null)
  const [attachment, setAttachment] = useState<{ filename: string; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [agentThreads, setAgentThreads] = useState<AgentTask[]>([])
  const [jumpToTaskId, setJumpToTaskId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load on mount — waits on user.id since conversations are scoped per
  //    signed-in user (see conversation-store.ts); re-runs if it changes
  //    (e.g. a different account signs in on the same browser) so this
  //    account never sees another one's history. ──
  useEffect(() => {
    if (!user?.id) { setConversations([]); return }
    setConversations(loadConversations(user.id))
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {}
  }, [user?.id])

  // ── Agent-originated threads for the sidebar — the agent's own proposals/
  // negotiations are real conversations too, not just entries under the Agent tab. ──
  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    const load = () => {
      fetch('/api/agents/tasks?limit=8')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d?.tasks) setAgentThreads(d.tasks) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    return () => { cancelled = true; clearInterval(t) }
  }, [user?.org_id])

  function openAgentThread(taskId: string) {
    setJumpToTaskId(taskId)
    setActiveTab('agent')
    router.replace('/ai?tab=agent', { scroll: false })
  }

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
    if (user?.id) saveConversations(user.id, convos)
  }, [user?.id])

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
          ? { ...c, messages: [...c.messages, userMsg], title: deriveTitle([...c.messages, userMsg], t), updatedAt: now }
          : c
      )
    } else {
      convoId = newId()
      const fresh: Conversation = {
        id: convoId,
        title: deriveTitle([userMsg], t),
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
          locale,
        }),
      })

      let reply: string
      if (res.status === 429) {
        reply = t('aiPage.dailyLimitReached')
      } else {
        const data = await res.json()
        reply = data.content?.find?.((b: { type: string; text?: string }) => b.type === 'text')?.text
          ?? data.content?.[0]?.text
          ?? t('aiPage.noResponse')
      }

      const replyTime = new Date().toISOString()
      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: replyTime, isDocument: isDocRequest }
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === convoId
            ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: replyTime }
            : c
        )
        if (user?.id) saveConversations(user.id, updated)
        return updated
      })
    } catch {
      const errTime = new Date().toISOString()
      const errMsg: Message = { role: 'assistant', content: t('aiPage.encounteredError'), timestamp: errTime }
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === convoId ? { ...c, messages: [...c.messages, errMsg], updatedAt: errTime } : c
        )
        if (user?.id) saveConversations(user.id, updated)
        return updated
      })
    } finally {
      setLoading(false)
    }
  }, [activeId, conversations, loading, persist, portal, userName, user?.id, t, locale])

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
      if (!res.ok) { alert(data.error ?? t('aiPage.uploadFailed')); return }
      setAttachment({ filename: data.filename as string, text: data.text as string })
      inputRef.current?.focus()
    } catch {
      alert(t('aiPage.uploadFailedRetry'))
    } finally {
      setUploading(false)
    }
  }

  function submit(text: string) {
    const trimmed = text.trim()
    if ((!trimmed && !attachment) || loading) return

    if (attachment) {
      const userTyped = trimmed || t('aiPage.pleaseAnalyzeDocument')
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
  const contextBadge = t(`aiPage.${portal}Portal`)

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
              {t('aiPage.newChat')}
            </button>
            {/* Collapse chevron — icon only, top-right of the panel */}
            <button
              type="button"
              className="strike-ai-log-toggle"
              onClick={toggleCollapsed}
              aria-label={t('aiPage.collapseConversationHistory')}
              title={t('aiPage.collapse')}
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
            {agentThreads.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{
                  padding: '4px 12px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--blue)',
                }}>
                  {t('aiPage.agent')}
                </div>
                {[...agentThreads]
                  .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
                  .map(th => (
                    <button
                      key={th.id}
                      type="button"
                      className="strike-ai-convo card-interactive"
                      onClick={() => openAgentThread(th.id)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '10px 12px',
                        borderRadius: 8, cursor: 'pointer', border: 'none',
                        borderLeft: '2px solid transparent', background: 'transparent',
                        marginBottom: 2, display: 'flex', alignItems: 'flex-start', gap: 8,
                      }}
                    >
                      <span className="ai-breathe" style={{
                        width: 6, height: 6, marginTop: 5, borderRadius: '50%',
                        background: 'var(--gradient-ai)', flexShrink: 0,
                      }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 13, color: 'var(--ink)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {th.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                          {relativeTime(th.updated_at ?? th.created_at, t)}
                        </div>
                      </span>
                    </button>
                  ))}
              </div>
            )}
            {conversations.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
                {t('aiPage.noConversationsYet')}
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
                        {c.title || t('aiPage.newConversation')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                        {relativeTime(c.updatedAt, t)}
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
            aria-label={t('aiPage.expandConversationHistory')}
            title={t('aiPage.expand')}
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

        {/* ── RIGHT: Chat / Agent ── */}
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
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
            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--offwhite)', borderRadius: 999, padding: '3px' }}>
              {(['chat', 'agent'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-demo-target={tab === 'agent' ? 'ai-tab-agent' : undefined}
                  onClick={() => {
                    setActiveTab(tab)
                    router.replace(`/ai${tab === 'agent' ? '?tab=agent' : ''}`, { scroll: false })
                  }}
                  style={{
                    padding: '5px 14px', borderRadius: 999, border: 'none',
                    fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                    background: activeTab === tab ? 'var(--white)' : 'transparent',
                    color: activeTab === tab ? 'var(--blue)' : 'var(--gray)',
                    cursor: 'pointer', transition: 'all .12s',
                    boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                  }}
                >
                  {tab === 'chat' ? t('aiPage.chatTab') : t('aiPage.agent')}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span style={{
              padding: '4px 10px', borderRadius: 999, background: 'var(--color-accent-light)',
              color: 'var(--blue)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {contextBadge}
            </span>
          </div>

          {/* Agent tab */}
          {activeTab === 'agent' && user?.org_id && (
            <AgentPanel orgId={user.org_id} initialOpenTaskId={jumpToTaskId} />
          )}

          {/* Chat tab — messages + input */}
          {activeTab === 'chat' && <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {messages.length === 0 && !loading && !pendingAction ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 6 }}>
                <div className="reveal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
                  <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>{t('aiPage.autonomousAgentSubtitle')}</div>
                </div>
                <div className="reveal-stagger" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 480, width: '100%' }}>
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
                  <div key={i} className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 3 }}>
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
                  <div className="ai-sheen fade-in" style={{
                    background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12,
                    padding: 16, maxWidth: '92%',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                      {t('aiPage.wantsToExecuteAction')}
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
                        {t('aiPage.execute')}
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
                        {t('common.cancel')}
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
                  aria-label={t('aiPage.removeAttachment')}
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
                aria-label={uploading ? t('aiPage.uploading') : t('aiPage.attachFile')}
                onClick={() => !uploading && fileInputRef.current?.click()}
                disabled={uploading}
                title={t('aiPage.attachFileTitle')}
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
                placeholder={attachment ? t('aiPage.askAboutAttachment', { filename: attachment.filename }) : t('aiPage.askStrikeAnything')}
                style={{
                  flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-body)',
                  padding: '17px 0', lineHeight: 1.3, maxHeight: 120,
                }}
              />
              <button
                type="button"
                aria-label={t('aiPage.send')}
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
          </>}
        </div>
      </div>
    </>
  )
}

export default function AIWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <AIWorkspaceInner />
    </Suspense>
  )
}
