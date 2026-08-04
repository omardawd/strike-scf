'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { renderMarkdownWithBlocks } from '@/components/ai-chat-message'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/locale-context'

// Extracted from app/(portal)/ai/page.tsx so the real GATE-1/GATE-2 approval
// thread UI (proposal card, live negotiation progress, revise-via-chat,
// Approve/Reject/Retry) has exactly one implementation — shared by the real
// Agent tab and the demo tour's inline live-activity panel
// (components/demo/DemoAgentActivityFeed.tsx). Do not fork this; extend here.

type TFn = (key: string, vars?: Record<string, string | number>) => string

// ============== Types ==============
export interface NegotiationProgress {
  id: string
  status: string
  current_round: number
  last_tick_at: string | null
  halt_requested: boolean
  outcome_summary: string | null
}

export interface AgentTask {
  id: string
  active_task_id?: string
  type: string
  title: string
  body: string | null
  status: string
  proposed_action: { tool_name: string; tool_input: Record<string, unknown> } | null
  plan: { max_rounds?: number; guardrails_configured?: boolean; deadline_at?: string } | null
  result: Record<string, unknown> | null
  created_at: string
  updated_at?: string
  approved_at: string | null
  rejected_reason: string | null
  negotiation: NegotiationProgress | null
}

export interface TaskThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

// ============== Labels / status helpers ==============
function toolLabels(t: TFn): Record<string, string> {
  return {
    get_active_deals: t('aiPage.tool.reviewActiveDeals'),
    create_financing_request: t('aiPage.tool.submitFinancingRequest'),
    create_marketplace_listing: t('aiPage.tool.createMarketplaceListing'),
    submit_marketplace_offer: t('aiPage.tool.submitOffer'),
    counter_marketplace_offer: t('aiPage.tool.sendCounterOffer'),
    accept_marketplace_offer: t('aiPage.tool.finalizeDeal'),
    reject_marketplace_offer: t('aiPage.tool.rejectOffer'),
    search_marketplace_listings: t('aiPage.tool.searchMarketplace'),
    get_agent_tasks: t('aiPage.tool.checkAgentTasks'),
  }
}

export function friendlyToolLabel(tool: string | undefined, t: TFn): string {
  if (!tool) return t('aiPage.advisory')
  return toolLabels(t)[tool] ?? tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function describeOutcome(task: AgentTask, t: TFn): { summary: string; href?: string } | null {
  const tool = task.proposed_action?.tool_name
  const result = task.result
  if (!result || 'error' in result) return null

  switch (tool) {
    case 'create_financing_request': {
      const amount = Number(result.amount_requested ?? 0)
      const currency = String(result.currency ?? 'USD')
      return {
        summary: t('aiPage.outcome.financingRequestSubmitted', { currency, amount: amount.toLocaleString() }),
        href: typeof result.url === 'string' ? result.url : undefined,
      }
    }
    case 'create_marketplace_listing': {
      const listingId = result.listing_id
      return {
        summary: t('aiPage.outcome.listingCreated'),
        href: typeof listingId === 'string' ? `/marketplace/listings/${listingId}` : undefined,
      }
    }
    case 'submit_marketplace_offer':
      return { summary: t('aiPage.outcome.offerSubmitted') }
    case 'counter_marketplace_offer':
      return { summary: t('aiPage.outcome.counterOfferSent') }
    case 'accept_marketplace_offer': {
      const dealId = result.deal_id
      return {
        summary: t('aiPage.outcome.termsFinalized'),
        href: typeof dealId === 'string' ? `/deals/${dealId}` : undefined,
      }
    }
    case 'reject_marketplace_offer':
      return { summary: t('aiPage.outcome.offerRejected') }
    case 'get_active_deals':
      return { summary: t('aiPage.outcome.dealsReviewed') }
    case 'get_agent_tasks':
      return { summary: t('aiPage.outcome.taskListReviewed') }
    default:
      return { summary: t('aiPage.outcome.actionCompleted') }
  }
}

export function negotiationStatusLabels(t: TFn): Record<string, string> {
  return {
    active:                t('aiPage.negStatus.negotiating'),
    awaiting_finalization: t('aiPage.negStatus.awaitingFinalization'),
    halted_by_user:        t('aiPage.negStatus.stopped'),
    halted_guardrail:      t('aiPage.negStatus.haltedDeactivated'),
    completed_accepted:    t('aiPage.negStatus.dealFinalized'),
    completed_rejected:    t('aiPage.negStatus.rejected'),
    completed_withdrawn:   t('aiPage.negStatus.withdrawn'),
    completed_deadline:    t('aiPage.negStatus.deadlineReached'),
    failed:                t('aiPage.negStatus.failed'),
  }
}

export function timeSince(iso: string | null, t: TFn): string {
  if (!iso) return t('aiPage.notYet')
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return t('aiPage.justNowLower')
  if (mins < 60) return `${mins}m ${t('aiPage.ago')}`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ${t('aiPage.ago')}`
  return `${Math.round(hours / 24)}d ${t('aiPage.ago')}`
}

const STATUS_COLOR: Record<string, string> = {
  awaiting_approval: 'var(--color-amber)',
  approved:          'var(--color-green)',
  executing:         'var(--blue)',
  completed:         'var(--color-green)',
  rejected:          'var(--gray)',
  failed:            'var(--color-red)',
}
const STATUS_BG: Record<string, string> = {
  awaiting_approval: '#FEF3C7',
  approved:          '#EDFAF4',
  executing:         'var(--blue-light)',
  completed:         '#EDFAF4',
  rejected:          'var(--offwhite)',
  failed:            '#FEE2E2',
}
function statusLabels(t: TFn): Record<string, string> {
  return {
    awaiting_approval: t('aiPage.taskStatus.needsApproval'),
    approved:          t('aiPage.taskStatus.approved'),
    executing:         t('aiPage.negStatus.negotiating'),
    completed:         t('deals.status.completed'),
    rejected:          t('listingDetail.offerStatus.rejected'),
    failed:            t('aiPage.negStatus.failed'),
  }
}

export function StatusBadge({ status }: { status: string }) {
  const t = useT()
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: STATUS_BG[status] ?? 'var(--offwhite)',
      color: STATUS_COLOR[status] ?? 'var(--gray)',
    }}>
      {statusLabels(t)[status] ?? status}
    </span>
  )
}

// ============== Message bubbles ==============
function WorkingBubble({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        maxWidth: '80%', padding: '10px 14px', borderRadius: 14,
        fontSize: 13.5, background: 'var(--white)', border: '1px solid var(--border)', color: 'var(--gray)',
      }}>
        <span style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)',
              animation: `ai-dot-pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
        </span>
        {label}
      </div>
    </div>
  )
}

function MessageBubble({ role, content }: { role: TaskThreadMessage['role']; content: string }) {
  if (role === 'system') {
    // Negotiation-round narration carries a [[STRIKE_BLOCK:...]] comparison —
    // too wide for the narrow centered pill below, render it as a real card.
    if (content.includes('[[STRIKE_BLOCK:')) {
      return <div style={{ margin: '8px 0', fontSize: 13, color: 'var(--ink-soft, var(--ink))' }}>{renderMarkdownWithBlocks(content, `sys-${content.length}`)}</div>
    }
    return (
      <div style={{ textAlign: 'center', margin: '4px 0' }}>
        <span style={{
          display: 'inline-block', fontSize: 12, color: 'var(--ink-soft)',
          background: 'var(--offwhite)', borderRadius: 999, padding: '6px 14px', lineHeight: 1.5,
        }}>
          {content}
        </span>
      </div>
    )
  }
  const isUser = role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div className="fade-in" style={{
        maxWidth: '80%',
        padding: '10px 14px',
        borderRadius: 14,
        fontSize: 13.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        background: isUser ? 'var(--blue)' : 'var(--white)',
        color: isUser ? 'var(--white)' : 'var(--ink)',
        border: isUser ? 'none' : '1px solid var(--border)',
      }}>
        {content}
      </div>
    </div>
  )
}

// What to show while a proposed action is actually executing — keyed by
// tool_name so the preview reads like real activity, not a generic spinner.
function workingLabels(t: TFn): Record<string, string> {
  return {
    create_marketplace_listing: t('aiPage.working.postingListing'),
    submit_marketplace_offer: t('aiPage.working.submittingOffer'),
    counter_marketplace_offer: t('aiPage.working.sendingCounterOffer'),
    accept_marketplace_offer: t('aiPage.working.finalizingDeal'),
    reject_marketplace_offer: t('aiPage.working.rejectingOffer'),
    create_financing_request: t('aiPage.working.submittingFinancingRequest'),
    search_marketplace_listings: t('aiPage.working.searchingMarketplace'),
    get_active_deals: t('aiPage.working.reviewingActiveDeals'),
    get_agent_tasks: t('aiPage.working.checkingAgentTasks'),
  }
}

function describeWorking(toolName: string | undefined, t: TFn): string {
  if (!toolName) return t('aiPage.working.working')
  return workingLabels(t)[toolName] ?? t('aiPage.working.running', { tool: toolName.replace(/_/g, ' ') })
}

// ============== Task thread view (per-plan chat) ==============
// The real GATE-1/GATE-2 approval UI: proposal card, live negotiation
// progress (round N of M, halt button), revise-via-chat, Approve/Reject/Retry.
export function TaskThreadView({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [rootTask, setRootTask] = useState<AgentTask | null>(null)
  const [currentTask, setCurrentTask] = useState<AgentTask | null>(null)
  const [messages, setMessages] = useState<TaskThreadMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [acting, setActing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/agents/tasks/${taskId}/messages`)
    if (res.ok) {
      const data = await res.json()
      setRootTask(data.rootTask ?? null)
      setCurrentTask(data.currentTask ?? null)
      setMessages(data.messages ?? [])
    }
    setLoading(false)
  }, [taskId])

  useEffect(() => { load() }, [load])

  // While a negotiation is actively being monitored by the tick loop, poll
  // gently so a counter/escalation/finalization that lands in the background
  // (cron fires every minute regardless of whether this tab is open) appears
  // here without the user needing to back out and reopen the thread. This is
  // a backstop for the realtime subscription below (missed events, WebSocket
  // blocked), not the primary update path — see that effect's comment.
  const negotiationIsLive = rootTask?.negotiation?.status === 'active'
  useEffect(() => {
    if (!negotiationIsLive) return
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [negotiationIsLive, load])

  // Supabase Realtime subscription — same pattern as Strike Rooms
  // (app/(portal)/rooms/[id]/page.tsx). Without this, a round that lands via
  // the tick loop only appears here after the next 15s poll, while the same
  // round shows up instantly in the deal's Strike Room (which is realtime).
  // All messages in a thread (root task + escalation/finalization follow-ups)
  // are stored under the root task's id (see postSystemMessage in
  // lib/ai/agent-task-chat.ts), so filtering on taskId alone covers the
  // whole thread. Refetches the full thread rather than patching state in
  // place, since a new message often also means currentTask/negotiation
  // fields changed (round count, status) — not just the message list.
  useEffect(() => {
    if (!taskId) return
    let supabase: ReturnType<typeof createClient> | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null
    try {
      supabase = createClient()
      channel = supabase
        .channel(`agent-task-thread:${taskId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'agent_task_messages', filter: `agent_task_id=eq.${taskId}` },
          () => { load() }
        )
        .subscribe()
    } catch {
      // Realtime unavailable (e.g. WebSocket blocked); thread still works via the poll above
    }
    return () => { if (supabase && channel) supabase.removeChannel(channel) }
  }, [taskId, load])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function send() {
    const content = input.trim()
    if (!content || sending) return
    setInput('')
    setSending(true)
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString() }])
    try {
      const res = await fetch(`/api/agents/tasks/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        const data = await res.json()
        setRootTask(data.rootTask ?? null)
        setCurrentTask(data.currentTask ?? null)
        setMessages(data.messages ?? [])
      }
    } finally { setSending(false) }
  }

  async function approve() {
    if (!currentTask) return
    setActing(true)
    try {
      await fetch(`/api/agents/tasks/${currentTask.id}/approve`, { method: 'POST' })
      await load()
    } finally { setActing(false) }
  }

  async function reject() {
    if (!currentTask) return
    setActing(true)
    try {
      await fetch(`/api/agents/tasks/${currentTask.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Declined by user' }),
      })
      await load()
    } finally { setActing(false) }
  }

  async function retry() {
    if (!currentTask) return
    setActing(true)
    try {
      await fetch(`/api/agents/tasks/${currentTask.id}/retry`, { method: 'POST' })
      await load()
    } finally { setActing(false) }
  }

  async function haltNegotiation() {
    if (!rootTask) return
    setActing(true)
    try {
      await fetch(`/api/agents/tasks/${rootTask.id}/halt`, { method: 'POST' })
      await load()
    } finally { setActing(false) }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>{t('common.loading')}</div>
  }
  if (!rootTask || !currentTask) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>
        <div style={{ marginBottom: 12 }}>{t('aiPage.planNotFound')}</div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← {t('dealImport.back')}</button>
      </div>
    )
  }

  const effectiveStatus = currentTask.status
  const isAwaitingApproval = effectiveStatus === 'awaiting_approval'
  const isFailed = effectiveStatus === 'failed'
  const isNegotiating = effectiveStatus === 'executing' && !!rootTask.negotiation

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--gray)', marginBottom: 8 }}
        >
          ← {t('aiPage.backToAllPlans')}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <StatusBadge status={effectiveStatus} />
          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{friendlyToolLabel(currentTask.proposed_action?.tool_name, t)}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{rootTask.title}</div>

        {isNegotiating && rootTask.negotiation && (
          <div className="ai-sheen" style={{ marginTop: 10, padding: '10px 12px', background: 'var(--blue-light)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {rootTask.negotiation.status === 'active' && !rootTask.negotiation.halt_requested && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--color-green)',
                  animation: 'badge-pulse 2.4s ease infinite',
                }} />
              )}
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>
                {negotiationStatusLabels(t)[rootTask.negotiation.status] ?? rootTask.negotiation.status}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>
                {t('aiPage.roundOf', { round: rootTask.negotiation.current_round, max: rootTask.plan?.max_rounds ?? '—' })}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gray-soft)' }}>
                · {t('aiPage.lastChecked')} {timeSince(rootTask.negotiation.last_tick_at, t)}
              </span>
            </div>
            {rootTask.negotiation.status === 'active' && !rootTask.negotiation.halt_requested && (
              <div style={{ fontSize: 11.5, color: 'var(--gray)', marginBottom: 8 }}>
                {t('aiPage.liveNegotiatingHint')}
              </div>
            )}
            {rootTask.negotiation.halt_requested ? (
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('aiPage.stopRequestedHint')}</div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={haltNegotiation}
                disabled={acting}
                style={{ color: 'var(--color-red)', borderColor: 'var(--color-red)' }}
              >
                {acting ? t('aiPage.stopping') : t('aiPage.stopNegotiation')}
              </button>
            )}
          </div>
        )}

        {currentTask.plan?.guardrails_configured === false && (isAwaitingApproval || isNegotiating) && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#FEF3C7', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#92620A', lineHeight: 1.5 }}>
            {t('aiPage.noGuardrailsFullHint')}
          </div>
        )}

        {currentTask.proposed_action?.tool_name && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setShowDetails((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--gray-soft)', textDecoration: 'underline' }}
            >
              {showDetails ? t('aiPage.hideTechnicalDetails') : t('aiPage.technicalDetails')}
            </button>
            {showDetails && (
              <div style={{ marginTop: 6, padding: '8px 12px', background: 'var(--offwhite)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{currentTask.proposed_action.tool_name}</span>
                {' '}
                <span style={{ color: 'var(--gray)' }}>
                  {Object.entries(currentTask.proposed_action.tool_input ?? {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Message list */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MessageBubble role="assistant" content={rootTask.body ?? rootTask.title} />
        {messages.map((m) => <MessageBubble key={m.id} role={m.role} content={m.content} />)}
        {acting && (
          <WorkingBubble label={describeWorking(currentTask.proposed_action?.tool_name, t)} />
        )}
        {sending && !acting && (
          <WorkingBubble label={t('aiPage.thinking')} />
        )}
        {currentTask.status === 'completed' && (() => {
          const outcome = describeOutcome(currentTask, t)
          return outcome?.href ? (
            <div style={{ textAlign: 'center' }}>
              <a href={outcome.href} style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 700, textDecoration: 'underline' }}>
                {t('aiPage.viewIt')}
              </a>
            </div>
          ) : null
        })()}
      </div>

      {/* Approve/Reject/Retry */}
      {(isAwaitingApproval || isFailed) && (
        <div style={{ display: 'flex', gap: 8, padding: '0 24px 14px' }}>
          {isAwaitingApproval && (
            <>
              <button className="btn btn-primary btn-sm shine" onClick={approve} disabled={acting} style={{ minWidth: 96 }}>
                {acting ? t('aiPage.executing') : `✓ ${t('listingDetail.accept')}`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={reject} disabled={acting}>{t('listingDetail.reject')}</button>
            </>
          )}
          {isFailed && (
            <button className="btn btn-ghost btn-sm" onClick={retry} disabled={acting} style={{ color: 'var(--color-amber)', borderColor: 'var(--color-amber)' }}>
              {acting ? t('aiPage.resetting') : `↺ ${t('aiPage.retry')}`}
            </button>
          )}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={t('aiPage.askAboutPlanPlaceholder')}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 'var(--radius-input)',
            border: '1px solid var(--border)', fontSize: 13.5, background: 'var(--offwhite)',
          }}
        />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !input.trim()}>
          {sending ? t('aiPage.sending') : t('aiPage.send')}
        </button>
      </div>
    </div>
  )
}
