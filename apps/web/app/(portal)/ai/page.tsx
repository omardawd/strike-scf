'use client'
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { SkeletonCard } from '@/components/motion'
import { STRIKE_BLOCK_RE, StrikeBlockFromJson } from '@/components/ai-blocks'

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
- submit_marketplace_offer — submit an offer ON an existing listing. Use this when the user wants to bid or respond to a listing someone else posted. NEVER use create_marketplace_listing for this. If the tool result includes autonomous_follow_through.started = true, tell the user in plain language that you'll keep negotiating this on their behalf and check the Agent tab for progress — don't just report the offer was submitted. If started = false because reason is "agent_inactive", mention they can activate their agent in Settings → Agent for hands-off follow-up negotiation next time.
- counter_marketplace_offer — respond to an offer/counter-offer with new terms. Same autonomous_follow_through behavior as submit_marketplace_offer above.
- create_marketplace_listing — post a NEW listing. DOCUMENT ATTACHED ([Attached document:] in message): extract ALL fields from the document (title, line items, quantities, units, prices, incoterms, payment terms, delivery date/location, currency) and call immediately — do not ask for info already in the document. Infer listing_type from portal (anchor → po_request, supplier → product_service). Use org_id from context. NO DOCUMENT: ask incoterms + payment terms first. After creating, emit [LISTING_CARD:{listing_id}] on its own line.
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
- get_erp_data — live cash position, AR/AP aging, inventory levels, open orders from the org's connected ERP
- get_capital_position — cash + receivables/payables + deal-book concentration risk in one call; use for "should we take this deal" / "can we afford this" / capital-allocation questions. Pass hypothetical_deal_value (+ hypothetical_counterparty_org_id if known) to model adding one more deal to the current book.

Structured response blocks: for numeric or comparative answers — capital position, risk concentration, before/after scenarios, financial call-outs — render a block instead of prose-only. Emit ONE directive per block, alone on its own line, with compact single-line JSON (no line breaks inside it):
  [[STRIKE_BLOCK:{"type":"stat_row","title":"optional","stats":[{"label":"Net Cash","value":"$850,000","tone":"default"}]}]]
  [[STRIKE_BLOCK:{"type":"comparison","title":"optional","left":{"label":"Current","items":[{"label":"Concentration","value":"53.9%"}]},"right":{"label":"If we take this deal","items":[{"label":"Concentration","value":"65.7%"}]}}]]
  [[STRIKE_BLOCK:{"type":"alert","tone":"warn","title":"Concentration risk rising","body":"optional detail"}]]
tone is one of default|good|warn|bad. Still write normal prose around the block to explain your reasoning — the block presents the numbers, your words present the judgment. Don't overuse it; reserve it for genuinely numeric/comparative moments, not every reply.

Rules:
1. Only reference data explicitly returned by tools or provided in context. Never invent figures.
2. Be concise. Use bullet points for lists. Format currency as $X,XXX.
3. You speak to CFOs, Treasurers, and Trade Finance professionals. Institutional tone.
4. Always use today's date (${today}) when creating listings or term sheets — never use a past year.
5. Document attachments: when the user's message starts with [Attached document: "filename"], the full document text appears before the "---" divider. Treat it as ground truth. Extract all relevant fields from it before asking any questions or calling tools. Never ask for information that is visible in the attached document.`
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

// Splits markdown text on [[STRIKE_BLOCK:{...}]] directives, rendering each
// as a real component and everything else through ReactMarkdown.
function renderMarkdownWithBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  STRIKE_BLOCK_RE.lastIndex = 0
  while ((m = STRIKE_BLOCK_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim()
    if (before) {
      out.push(
        <ReactMarkdown key={`${keyPrefix}-md-${last}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {before}
        </ReactMarkdown>
      )
    }
    out.push(<StrikeBlockFromJson key={`${keyPrefix}-blk-${m.index}`} keyProp={`${keyPrefix}-blk-${m.index}`} raw={m[1]!} />)
    last = m.index + m[0].length
  }
  const remainder = text.slice(last).trim()
  if (remainder) {
    out.push(
      <ReactMarkdown key={`${keyPrefix}-md-${last}`} remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {remainder}
      </ReactMarkdown>
    )
  }
  return out
}

function renderAssistantContent(content: string): React.ReactNode {
  // First split on [LISTING_CARD:uuid] tokens, then run each remaining text
  // segment through the [[STRIKE_BLOCK:...]] splitter above.
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  LISTING_CARD_RE.lastIndex = 0
  while ((match = LISTING_CARD_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before) parts.push(...renderMarkdownWithBlocks(before, `seg-${lastIndex}`))
    const listingId = match[1]!
    parts.push(<ListingCard key={listingId} id={listingId} />)
    lastIndex = match.index + match[0].length
  }
  const remainder = content.slice(lastIndex).trim()
  if (remainder) parts.push(...renderMarkdownWithBlocks(remainder, `seg-${lastIndex}`))
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

// ============== Agent Task Panel ==============
interface NegotiationProgress {
  id: string
  status: string
  current_round: number
  last_tick_at: string | null
  halt_requested: boolean
  outcome_summary: string | null
}

interface AgentTask {
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

interface TaskThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

const TOOL_LABELS: Record<string, string> = {
  get_active_deals: 'Review active deals',
  create_financing_request: 'Submit financing request',
  create_marketplace_listing: 'Create marketplace listing',
  submit_marketplace_offer: 'Submit offer',
  counter_marketplace_offer: 'Send counter-offer',
  accept_marketplace_offer: 'Finalize deal',
  reject_marketplace_offer: 'Reject offer',
  search_marketplace_listings: 'Search marketplace',
  get_agent_tasks: 'Check agent tasks',
}

function friendlyToolLabel(tool: string | undefined): string {
  if (!tool) return 'Advisory'
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function describeOutcome(task: AgentTask): { summary: string; href?: string } | null {
  const tool = task.proposed_action?.tool_name
  const result = task.result
  if (!result || 'error' in result) return null

  switch (tool) {
    case 'create_financing_request': {
      const amount = Number(result.amount_requested ?? 0)
      const currency = String(result.currency ?? 'USD')
      return {
        summary: `Financing request for ${currency} ${amount.toLocaleString()} was submitted and is now visible to banks on Strike Place.`,
        href: typeof result.url === 'string' ? result.url : undefined,
      }
    }
    case 'create_marketplace_listing': {
      const listingId = result.listing_id
      return {
        summary: 'Listing was created and published to Strike Place.',
        href: typeof listingId === 'string' ? `/marketplace/listings/${listingId}` : undefined,
      }
    }
    case 'submit_marketplace_offer':
      return { summary: 'Offer was submitted on the listing.' }
    case 'counter_marketplace_offer':
      return { summary: 'Counter-offer was sent to the counterparty.' }
    case 'accept_marketplace_offer': {
      const dealId = result.deal_id
      return {
        summary: 'Terms were finalized — a deal was created.',
        href: typeof dealId === 'string' ? `/deals/${dealId}` : undefined,
      }
    }
    case 'reject_marketplace_offer':
      return { summary: 'The offer was rejected and the negotiation ended.' }
    case 'get_active_deals':
      return { summary: 'Deals reviewed — no changes were made to your account.' }
    case 'get_agent_tasks':
      return { summary: 'Task list reviewed — no changes were made to your account.' }
    default:
      return { summary: 'Action completed successfully.' }
  }
}

const NEGOTIATION_STATUS_LABELS: Record<string, string> = {
  active:                'Negotiating',
  awaiting_finalization: 'Awaiting finalization',
  halted_by_user:        'Stopped',
  halted_guardrail:      'Halted — agent deactivated',
  completed_accepted:    'Deal finalized',
  completed_rejected:    'Rejected',
  completed_withdrawn:   'Withdrawn',
  completed_deadline:    'Deadline reached',
  failed:                'Failed',
}

function timeSince(iso: string | null): string {
  if (!iso) return 'not yet'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
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
const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: 'Needs approval',
  approved:          'Approved',
  executing:         'Negotiating',
  completed:         'Completed',
  rejected:          'Rejected',
  failed:            'Failed',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: STATUS_BG[status] ?? 'var(--offwhite)',
      color: STATUS_COLOR[status] ?? 'var(--gray)',
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function AgentPanel({ orgId, initialOpenTaskId }: { orgId: string; initialOpenTaskId?: string | null }) {
  void orgId
  const router = useRouter()
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
      setScanMsg(json.message ?? 'Scan complete.')
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
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Agent Task Queue</h2>
          <p style={{ fontSize: 13, color: 'var(--gray)', margin: '3px 0 0' }}>
            {counts.pending} pending · {counts.completed} completed
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => router.push('/settings/agent')}
        >
          Agent Settings
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={runScan}
          disabled={scanRunning}
        >
          {scanRunning ? 'Scanning…' : 'Run Scan'}
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
            {f === 'all' ? 'All' : f === 'awaiting_approval' ? `Pending (${counts.pending})` : `Done (${counts.completed})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} height={110} />)}
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--gray)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No tasks yet</div>
          <div style={{ fontSize: 13 }}>Run a scan to let your agent analyse your ERP data and propose actions.</div>
        </div>
      ) : (
        <div className="reveal-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {tasks.map((task) => (
            <button
              key={task.id}
              className="card-interactive"
              onClick={() => setOpenTaskId(task.active_task_id ?? task.id)}
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
                  {friendlyToolLabel(task.proposed_action?.tool_name)}
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
                  Round {task.negotiation.current_round} of {task.plan?.max_rounds ?? '—'} · last checked {timeSince(task.negotiation.last_tick_at)}
                </div>
              )}
              {task.plan && task.plan.guardrails_configured === false && task.status === 'awaiting_approval' && (
                <div style={{ fontSize: 11, color: '#92620A', fontWeight: 600, marginTop: 2 }}>
                  No price guardrails configured
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600, marginTop: 4 }}>Open chat →</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============== Task thread view (per-plan chat) ==============
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
const WORKING_LABELS: Record<string, string> = {
  create_marketplace_listing: 'Posting your listing to Strike Place…',
  submit_marketplace_offer: 'Submitting your offer…',
  counter_marketplace_offer: 'Sending your counter-offer…',
  accept_marketplace_offer: 'Finalizing the deal…',
  reject_marketplace_offer: 'Rejecting the offer…',
  create_financing_request: 'Submitting your financing request…',
  search_marketplace_listings: 'Searching the marketplace…',
  get_active_deals: 'Reviewing active deals…',
  get_agent_tasks: 'Checking agent tasks…',
}

function describeWorking(toolName: string | undefined): string {
  if (!toolName) return 'Working…'
  return WORKING_LABELS[toolName] ?? `Running ${toolName.replace(/_/g, ' ')}…`
}

function TaskThreadView({ taskId, onBack }: { taskId: string; onBack: () => void }) {
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
  // (cron fires every 5 minutes regardless of whether this tab is open)
  // appears here without the user needing to back out and reopen the thread.
  const negotiationIsLive = rootTask?.negotiation?.status === 'active'
  useEffect(() => {
    if (!negotiationIsLive) return
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [negotiationIsLive, load])

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
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>Loading…</div>
  }
  if (!rootTask || !currentTask) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>
        <div style={{ marginBottom: 12 }}>This plan couldn&apos;t be found.</div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
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
          ← Back to all plans
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <StatusBadge status={effectiveStatus} />
          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{friendlyToolLabel(currentTask.proposed_action?.tool_name)}</span>
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
                {NEGOTIATION_STATUS_LABELS[rootTask.negotiation.status] ?? rootTask.negotiation.status}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>
                Round {rootTask.negotiation.current_round} of {rootTask.plan?.max_rounds ?? '—'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gray-soft)' }}>
                · last checked {timeSince(rootTask.negotiation.last_tick_at)}
              </span>
            </div>
            {rootTask.negotiation.status === 'active' && !rootTask.negotiation.halt_requested && (
              <div style={{ fontSize: 11.5, color: 'var(--gray)', marginBottom: 8 }}>
                Live — negotiating autonomously with the counterparty&apos;s agent. Checks automatically every few minutes; this page refreshes on its own.
              </div>
            )}
            {rootTask.negotiation.halt_requested ? (
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>Stop requested — will halt on the next check.</div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={haltNegotiation}
                disabled={acting}
                style={{ color: 'var(--color-red)', borderColor: 'var(--color-red)' }}
              >
                {acting ? 'Stopping…' : 'Stop negotiation'}
              </button>
            )}
          </div>
        )}

        {currentTask.plan?.guardrails_configured === false && (isAwaitingApproval || isNegotiating) && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#FEF3C7', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#92620A', lineHeight: 1.5 }}>
            No price guardrails are configured for your agent — it will use its own judgment on price. You&apos;ll still approve the final terms before any deal is created.
          </div>
        )}

        {currentTask.proposed_action?.tool_name && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setShowDetails((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--gray-soft)', textDecoration: 'underline' }}
            >
              {showDetails ? 'Hide technical details' : 'Technical details'}
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
          <WorkingBubble label={describeWorking(currentTask.proposed_action?.tool_name)} />
        )}
        {sending && !acting && (
          <WorkingBubble label="Thinking…" />
        )}
        {currentTask.status === 'completed' && (() => {
          const outcome = describeOutcome(currentTask)
          return outcome?.href ? (
            <div style={{ textAlign: 'center' }}>
              <a href={outcome.href} style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 700, textDecoration: 'underline' }}>
                View it →
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
                {acting ? 'Executing…' : '✓ Approve'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={reject} disabled={acting}>Reject</button>
            </>
          )}
          {isFailed && (
            <button className="btn btn-ghost btn-sm" onClick={retry} disabled={acting} style={{ color: 'var(--color-amber)', borderColor: 'var(--color-amber)' }}>
              {acting ? 'Resetting…' : '↺ Retry'}
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
          placeholder="Ask Strike AI about this plan, or ask it to revise the terms…"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 'var(--radius-input)',
            border: '1px solid var(--border)', fontSize: 13.5, background: 'var(--offwhite)',
          }}
        />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !input.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
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

  const [activeTab, setActiveTab] = useState<'chat' | 'agent'>(
    searchParams.get('tab') === 'agent' ? 'agent' : 'chat'
  )

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingPhrase, setLoadingPhrase] = useState('Thinking')
  const [collapsed, setCollapsed] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ text: string; description: string } | null>(null)
  const [attachment, setAttachment] = useState<{ filename: string; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [agentThreads, setAgentThreads] = useState<AgentTask[]>([])
  const [jumpToTaskId, setJumpToTaskId] = useState<string | null>(null)

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
            {agentThreads.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{
                  padding: '4px 12px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--blue)',
                }}>
                  Agent
                </div>
                {[...agentThreads]
                  .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
                  .map(t => (
                    <button
                      key={t.id}
                      type="button"
                      className="strike-ai-convo card-interactive"
                      onClick={() => openAgentThread(t.id)}
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
                          {t.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                          {relativeTime(t.updated_at ?? t.created_at)}
                        </div>
                      </span>
                    </button>
                  ))}
              </div>
            )}
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
                  {tab === 'chat' ? 'Chat' : 'Agent'}
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
                  <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>Your autonomous supply chain finance agent</div>
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
