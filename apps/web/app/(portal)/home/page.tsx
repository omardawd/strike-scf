'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import {
  Topbar, fmtCurrency, AgentActivityTicker,
  scoreColor, scoreTierClass, scoreTierLabel,
  type KpiItem,
} from '@/components/dashboard/shared'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { Skeleton, SkeletonText, CountUp } from '@/components/motion'
import { renderAssistantContent } from '@/components/ai-chat-message'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import {
  type Message, type Conversation,
  newId, loadConversations, saveConversations, deriveTitle,
} from '@/lib/ai/conversation-store'
import { useT, useLocale } from '@/lib/i18n/locale-context'
import { useDemoFormBridge } from '@/components/demo/DemoFormBridge'
import { sleep } from '@/components/demo/demo-utils'

type TFn = (key: string, vars?: Record<string, string | number>) => string

function greetingKey(): string {
  const h = new Date().getHours()
  if (h < 12) return 'dashboard.goodMorning'
  if (h < 17) return 'dashboard.goodAfternoon'
  return 'dashboard.goodEvening'
}

interface DealRow {
  id: string
  status: string
  total_value: number | null
  agreed_price: number | null
  user_role?: 'buyer' | 'supplier'
  counterparty?: { id: string; legal_name: string | null; passport_score: number | null } | null
}

interface FinRow {
  id: string
  status: string
  amount_requested: number
  offer_count?: number | null
}

function dealValue(d: DealRow): number {
  return Number(d.total_value ?? d.agreed_price ?? 0)
}

const TERMINAL = ['completed', 'cancelled']

// Deal lifecycle collapsed into the five stages a procurement/finance team
// actually manages against. Ordering matters — it drives the pipeline flow.
const STAGES: { key: string; labelKey: string; color: string; statuses: string[] }[] = [
  { key: 'negotiation', labelKey: 'dashboardPage.d2StageNegotiation', color: '#7C3AED', statuses: ['negotiating'] },
  { key: 'contracting', labelKey: 'dashboardPage.d2StageContracting', color: '#1428CC', statuses: ['agreed', 'contract_pending', 'documents_pending'] },
  { key: 'production',  labelKey: 'dashboardPage.d2StageProduction',  color: '#0EA5E9', statuses: ['confirmed', 'in_preparation', 'active'] },
  { key: 'transit',     labelKey: 'dashboardPage.d2StageTransit',     color: '#F59E0B', statuses: ['shipped'] },
  { key: 'settlement',  labelKey: 'dashboardPage.d2StageSettlement',  color: '#10B981', statuses: ['delivery_confirmed', 'payment_due', 'payment_overdue', 'payment_confirmed', 'financing_requested', 'financing_active'] },
]

function SparkIcon({ size = 14, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z" fill={color} />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="d2-chev">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Card shell ───────────────────────────────────────────────────────────────
function Panel({ title, meta, children, style }: {
  title: string; meta?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <section className="d2-card" style={style}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <h2 style={{
          margin: 0, fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gray)',
        }}>{title}</h2>
        {meta}
      </header>
      {children}
    </section>
  )
}

export default function Dashboard2Page() {
  const portal = usePortal()
  const user = useUser()
  const t = useT()
  const router = useRouter()
  const { locale } = useLocale()

  const firstName = user?.full_name?.split(' ')[0] ?? ''

  const [loading, setLoading] = useState(true)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [passportScore, setPassportScore] = useState<number | null>(null)
  const [kpis, setKpis] = useState<KpiItem[]>([])
  const [aiContext, setAiContext] = useState<Record<string, unknown>>({})
  const [deals, setDeals] = useState<DealRow[]>([])
  const [finReqs, setFinReqs] = useState<FinRow[]>([])
  const [passport, setPassport] = useState<{ trade_count_total: number; trade_volume_total: number; risk_tier: string | null } | null>(null)
  const [bank, setBank] = useState<Record<string, unknown> | null>(null)

  const [opener, setOpener] = useState<string | null>(null)
  const [openerSuggestion, setOpenerSuggestion] = useState<string | null>(null)
  const [openerLoading, setOpenerLoading] = useState(true)

  const [started, setStarted] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  // The messages container's own `overflowY:'auto'` never actually engages —
  // its flex ancestor chain up to `.page` uses `minHeight` (not a bounded
  // `height`), so the container just grows with its content and the real
  // document/window ends up doing the scrolling instead. scrollTo() on
  // scrollRef was therefore a no-op past the first exchange (which happens to
  // fit the initial viewport). A sentinel scrollIntoView follows the actual
  // scrolling ancestor, whichever element that turns out to be.
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const demoBridge = useDemoFormBridge()

  // ── Load real dashboard data (mirrors app/(portal)/dashboard/page.tsx's per-portal fetch) ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const orgId = user?.org_id
        const [dashRes, dealsRes, finRes, passRes] = await Promise.all([
          fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
          portal !== 'bank' ? fetch('/api/deals').then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
          portal !== 'bank' ? fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
          portal !== 'bank' && orgId ? fetch(`/api/passport/${orgId}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return

        const deals: DealRow[] = dealsRes?.deals ?? []
        const activeDeals = deals.filter(d => !TERMINAL.includes(d.status))
        const financingReqs: FinRow[] = finRes?.requests ?? []
        setDeals(deals)
        setFinReqs(financingReqs)

        if (portal === 'bank') {
          setBank(dashRes ?? null)
          setOrgName(dashRes?.bank_name ?? null)
          setKpis([
            { label: t('dashboardPage.activePrograms'), value: dashRes?.active_program_count ?? 0, icon: 'programs', tint: 'var(--blue)' },
            { label: t('reportingPage.outstandingBalance'), value: dashRes?.outstanding_balance ?? 0, format: fmtCurrency, icon: 'balance', tint: 'var(--color-green)' },
          ])
          setAiContext({
            portal: 'bank', bank_name: dashRes?.bank_name ?? null,
            active_programs: dashRes?.active_program_count ?? 0,
            pending_bank_review: dashRes?.pending_bank_review ?? 0,
            outstanding_balance: dashRes?.outstanding_balance ?? 0,
          })
        } else {
          const tradeVolume = deals.filter(d => d.status !== 'cancelled').reduce((s, d) => s + dealValue(d), 0)
          const financingActive = financingReqs.filter(f => ['open', 'offers_received', 'accepted'].includes(f.status)).reduce((s, f) => s + f.amount_requested, 0)
          setOrgName(dashRes?.org_name ?? null)
          setPassportScore(passRes?.organization?.passport_score ?? null)
          setPassport(passRes?.organization ? {
            trade_count_total:  passRes.organization.trade_count_total ?? 0,
            trade_volume_total: passRes.organization.trade_volume_total ?? 0,
            risk_tier:          passRes.organization.risk_tier ?? null,
          } : null)
          setKpis([
            { label: t('marketplace.activeDeals'), value: activeDeals.length, icon: 'deals', tint: 'var(--blue)' },
            portal === 'supplier'
              ? { label: t('anchorDetail.totalFinanced'), value: financingActive, format: fmtCurrency, icon: 'financing', tint: 'var(--color-green)' }
              : { label: t('dashboardPage.tradeVolume'), value: tradeVolume, format: fmtCurrency, icon: 'volume', tint: 'var(--color-green)' },
          ])
          setAiContext({
            portal, org_name: dashRes?.org_name ?? null,
            passport_score: passRes?.organization?.passport_score ?? null,
            risk_tier: passRes?.organization?.risk_tier ?? null,
            active_deals: activeDeals.length,
            trade_volume: tradeVolume,
            financing_active: financingActive,
            deals_needing_action: deals.filter(d =>
              (d.status === 'negotiating') || (portal === 'anchor' ? false : d.status === 'agreed')
            ).length,
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [portal, user?.org_id, t])

  // ── Personalized, actionable opener (same /api/ai/insight the rest of the app uses) ──
  // insightFetchedRef guards against firing this more than once per mount —
  // confirmed live (via network-request logging) that this effect was
  // issuing THREE real POSTs per page load instead of one, each one paying
  // full AI cost whenever the server-side cache hadn't been populated yet
  // (React StrictMode's dev-mode double-invoke plus at least one more re-run
  // from this effect's own dependency instability). The server-side cache in
  // /api/ai/insight only protects the demo org and only once a value exists;
  // this ref-guard is what actually stops the redundant calls from firing in
  // the first place, for every user, not just the demo org.
  const insightFetchedRef = useRef(false)
  useEffect(() => {
    if (loading) return
    if (insightFetchedRef.current) return
    insightFetchedRef.current = true
    let cancelled = false
    fetch('/api/ai/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'home', portal, data: aiContext, locale }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.insight) return
        setOpener(d.insight as string)
        const withPrompt = (d.actions ?? []).find((a: { prompt?: string }) => a.prompt)
        setOpenerSuggestion(withPrompt?.prompt ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOpenerLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  useEffect(() => {
    // 'smooth' here was the actual bug: a user message and its reply land in
    // quick succession (two effect runs a beat apart), and the second smooth
    // scroll — animating toward a target that just grew taller — regularly
    // got cut short by the first animation still in flight, leaving the
    // input pill just off the bottom of the viewport. Instant has no
    // animation to interrupt, so it always lands exactly at the sentinel.
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
  }, [messages, sending])

  const runFirstMessage = useCallback(async (text: string, cacheKey?: string) => {
    const trimmed = text.trim()
    const uid = user?.id
    if (!trimmed || sending || !uid) return ''

    setCollapsing(true)
    // Swap just before the leave animation fully settles so the two states
    // overlap rather than butting up against each other.
    setTimeout(() => setStarted(true), 430)

    const t0 = new Date().toISOString()
    const openerMsg: Message = { role: 'assistant', content: opener ?? t('dashboardPage.d2FallbackOpener'), timestamp: t0 }
    const t1 = new Date(Date.now() + 1).toISOString()
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: t1 }

    const id = newId()
    const convo: Conversation = {
      id,
      title: deriveTitle([userMsg], t),
      messages: [openerMsg, userMsg],
      createdAt: t0,
      updatedAt: t1,
    }
    setConversationId(id)
    setMessages(convo.messages)
    setInput('')
    setSending(true)
    // localStorage read+write is synchronous and was landing right in the middle
    // of the leave animation — defer it past the transition so it can't drop frames.
    setTimeout(() => saveConversations(uid, [convo, ...loadConversations(uid)]), 500)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          model: 'sonnet',
          portal,
          system: buildSystemPrompt(portal, 'home', user?.full_name, user?.org_id ?? undefined, user?.bank_id ?? undefined),
          messages: convo.messages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 2048,
          locale,
          demoCacheKey: cacheKey,
        }),
      })
      const data = await res.json()
      const reply: string = res.status === 429
        ? t('aiPage.dailyLimitReached')
        : (data.content?.find?.((b: { type: string; text?: string }) => b.type === 'text')?.text ?? data.content?.[0]?.text ?? t('aiPage.noResponse'))
      const replyTime = new Date().toISOString()
      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: replyTime }
      setMessages(prev => {
        const updated = [...prev, assistantMsg]
        const all = loadConversations(uid).map(c => c.id === id ? { ...c, messages: updated, updatedAt: replyTime } : c)
        saveConversations(uid, all)
        return updated
      })
      return reply
    } catch {
      const errTime = new Date().toISOString()
      const errMsg: Message = { role: 'assistant', content: t('aiPage.encounteredError'), timestamp: errTime }
      setMessages(prev => {
        const updated = [...prev, errMsg]
        const all = loadConversations(uid).map(c => c.id === id ? { ...c, messages: updated, updatedAt: errTime } : c)
        saveConversations(uid, all)
        return updated
      })
      return ''
    } finally {
      setSending(false)
    }
  }, [opener, portal, sending, t, user?.id, user?.full_name, user?.org_id, user?.bank_id, locale])

  const runFollowUpMessage = useCallback(async (text: string, cacheKey?: string) => {
    const trimmed = text.trim()
    const uid = user?.id
    if (!trimmed || sending || !conversationId || !uid) return ''

    const now = new Date().toISOString()
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: now }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setInput('')
    setSending(true)
    saveConversations(uid, loadConversations(uid).map(c => c.id === conversationId ? { ...c, messages: withUser, title: deriveTitle(withUser, t), updatedAt: now } : c))

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'chat',
          model: 'sonnet',
          portal,
          system: buildSystemPrompt(portal, 'home', user?.full_name, user?.org_id ?? undefined, user?.bank_id ?? undefined),
          messages: withUser.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 2048,
          locale,
          demoCacheKey: cacheKey,
        }),
      })
      const data = await res.json()
      const reply: string = res.status === 429
        ? t('aiPage.dailyLimitReached')
        : (data.content?.find?.((b: { type: string; text?: string }) => b.type === 'text')?.text ?? data.content?.[0]?.text ?? t('aiPage.noResponse'))
      const replyTime = new Date().toISOString()
      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: replyTime }
      setMessages(prev => {
        const updated = [...prev, assistantMsg]
        saveConversations(uid, loadConversations(uid).map(c => c.id === conversationId ? { ...c, messages: updated, updatedAt: replyTime } : c))
        return updated
      })
      return reply
    } catch {
      const errTime = new Date().toISOString()
      const errMsg: Message = { role: 'assistant', content: t('aiPage.encounteredError'), timestamp: errTime }
      setMessages(prev => {
        const updated = [...prev, errMsg]
        saveConversations(uid, loadConversations(uid).map(c => c.id === conversationId ? { ...c, messages: updated, updatedAt: errTime } : c))
        return updated
      })
      return ''
    } finally {
      setSending(false)
    }
  }, [messages, sending, conversationId, portal, t, user?.id, user?.full_name, user?.org_id, user?.bank_id, locale])

  function handleSubmit() {
    if (!started) runFirstMessage(input)
    else runFollowUpMessage(input)
  }

  // Appends a message straight into the visible conversation — no
  // /api/ai/chat call — used by DemoAgentActivityFeed (Scene 7) to surface
  // real negotiation rounds (already fetched from agent_task_messages) into
  // the actual chat instead of only its own small Agent Log panel.
  const appendAssistantMessage = useCallback((text: string) => {
    if (!conversationId || !user?.id) return
    const uid = user.id
    const now = new Date().toISOString()
    const msg: Message = { role: 'assistant', content: text, timestamp: now }
    setMessages(prev => {
      const updated = [...prev, msg]
      saveConversations(uid, loadConversations(uid).map(c => c.id === conversationId ? { ...c, messages: updated, updatedAt: now } : c))
      return updated
    })
  }, [conversationId, user?.id])

  // Lets the demo tour's Scene 7 (DemoAgentActivityFeed) send a scripted
  // message through this exact same real send path — same request shape,
  // same conversation state, same rendering — rather than a parallel/mocked
  // one. No-op registration for every non-demo user (useDemoFormBridge()
  // returns null without a DemoConductor provider in the tree). Types the
  // message into the visible input first, the way a real user would, rather
  // than having it appear already-sent — `runFirstMessage`/`runFollowUpMessage`
  // both take the text as an argument (not from `input` state), so this
  // typing animation is purely visual and never races the actual send.
  useEffect(() => {
    if (!demoBridge) return
    demoBridge.registerChatApi({
      sendMessage: async (text, cacheKey) => {
        for (let i = 1; i <= text.length; i++) {
          setInput(text.slice(0, i))
          await sleep(16)
        }
        await sleep(450)
        setInput('')
        return started ? runFollowUpMessage(text, cacheKey) : runFirstMessage(text, cacheKey)
      },
      appendAssistantMessage,
    })
    return () => demoBridge.registerChatApi(null)
  }, [demoBridge, started, runFirstMessage, runFollowUpMessage, appendAssistantMessage])

  function resetToIdle() {
    setStarted(false)
    setCollapsing(false)
    setMessages([])
    setConversationId(null)
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  // Suggestion chips shown around the prompt — the AI's own recommended follow-up
  // first (if any), then a few evergreen quick-starts. De-duped, capped at 4.
  const chips = [
    openerSuggestion,
    t('dashboardPage.d2Chip1'),
    t('dashboardPage.d2Chip2'),
    portal !== 'bank' ? t('dashboardPage.d2Chip3') : null,
  ].filter((c): c is string => !!c)
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 4)

  // ── Derived analytics (org portals) ────────────────────────────────────────
  const activeDeals = deals.filter(d => !TERMINAL.includes(d.status))
  const activeValue = activeDeals.reduce((s, d) => s + dealValue(d), 0)

  // Wrap a Latin/numeric value in Unicode isolates so it renders as its own
  // LTR run when interpolated into an RTL sentence (otherwise "$5.6M" gets
  // visually shredded into "5.6$ … M" in Arabic).
  const iso = (s: string) => `⁨${s}⁩`

  const stages = STAGES.map(st => {
    const rows = activeDeals.filter(d => st.statuses.includes(d.status))
    return { ...st, count: rows.length, value: rows.reduce((s, d) => s + dealValue(d), 0) }
  })

  const receivables = activeDeals.filter(d => d.user_role === 'supplier').reduce((s, d) => s + dealValue(d), 0)
  const payables    = activeDeals.filter(d => d.user_role === 'buyer').reduce((s, d) => s + dealValue(d), 0)
  const financingInFlight = finReqs
    .filter(f => ['open', 'offers_received', 'accepted'].includes(f.status))
    .reduce((s, f) => s + (f.amount_requested ?? 0), 0)

  // Counterparty concentration across active trade value — the single most
  // telling risk read on a trade book.
  const exposure = Object.values(
    activeDeals.reduce<Record<string, { name: string; score: number | null; value: number }>>((acc, d) => {
      const name = d.counterparty?.legal_name
      if (!name) return acc
      const cur = acc[name] ?? { name, score: d.counterparty?.passport_score ?? null, value: 0 }
      cur.value += dealValue(d)
      acc[name] = cur
      return acc
    }, {})
  ).sort((a, b) => b.value - a.value).slice(0, 4)
  const exposureTotal = exposure.reduce((s, e) => s + e.value, 0) || 1

  const overdueCount     = activeDeals.filter(d => d.status === 'payment_overdue').length
  const dueCount         = activeDeals.filter(d => d.status === 'payment_due').length
  const negotiatingCount = activeDeals.filter(d => d.status === 'negotiating').length
  const offersCount      = finReqs.filter(f => f.status === 'offers_received').length

  const attention = [
    overdueCount     > 0 && { text: t('dashboardPage.d2AttnOverdue',     { n: iso(String(overdueCount)) }),     color: 'var(--color-red)',   href: '/deals' },
    offersCount      > 0 && { text: t('dashboardPage.d2AttnOffers',      { n: iso(String(offersCount)) }),      color: 'var(--blue)',        href: '/marketplace/financing' },
    dueCount         > 0 && { text: t('dashboardPage.d2AttnDue',         { n: iso(String(dueCount)) }),         color: 'var(--color-amber)', href: '/deals' },
    negotiatingCount > 0 && { text: t('dashboardPage.d2AttnNegotiating', { n: iso(String(negotiatingCount)) }), color: 'var(--color-purple)', href: '/deals' },
  ].filter((x): x is { text: string; color: string; href: string } => !!x)

  // Bank portfolio distribution
  const dist = (bank?.passport_distribution ?? null) as
    { total: number; avg_score: number | null; strong: number; fair: number; weak: number; pending: number } | null

  return (
    <>
      <style>{`
        .d2-prompt {
          position: relative; display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 7px 7px 18px;
          background: var(--white); border: 1.5px solid var(--border-strong);
          border-radius: 18px; box-shadow: var(--shadow-card);
          transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
        }
        .d2-prompt:focus-within {
          border-color: var(--blue);
          box-shadow: 0 0 0 4px var(--blue-light), 0 12px 34px rgba(20,40,204,.14);
        }
        .d2-prompt-input {
          flex: 1; min-width: 0; border: none; outline: none; background: transparent;
          font-family: var(--font-body); font-size: 15px; color: var(--ink); padding: 9px 0;
        }
        .d2-prompt-input::placeholder { color: var(--gray-soft); }
        .d2-send {
          flex-shrink: 0; width: 40px; height: 40px; border: none; border-radius: 13px;
          background: var(--gradient-ai); display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: opacity .15s ease, transform .15s ease;
          box-shadow: 0 4px 14px rgba(20,40,204,.28);
        }
        .d2-send:hover:not(:disabled) { transform: translateY(-1px); }
        .d2-send:disabled { opacity: .4; cursor: default; box-shadow: none; }
        .d2-chip {
          font-family: var(--font-body); font-size: 13px; color: var(--ink-soft, var(--ink));
          background: var(--white); border: 1px solid var(--border);
          border-radius: 999px; padding: 8px 15px; cursor: pointer; white-space: nowrap;
          transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
        }
        .d2-chip:hover {
          background: var(--blue-light); border-color: transparent; color: var(--blue);
          transform: translateY(-1px);
        }

        /* ── Cinematic backdrop: slow-drifting aurora behind the hero ── */
        .d2-aurora {
          position: absolute; inset: -40px -120px -20px; pointer-events: none; z-index: 0; overflow: hidden;
          /* Fade the whole field out toward the edges so it reads as light, not as a box */
          -webkit-mask-image: radial-gradient(120% 90% at 50% 42%, #000 38%, transparent 78%);
          mask-image: radial-gradient(120% 90% at 50% 42%, #000 38%, transparent 78%);
        }
        .d2-aurora span {
          position: absolute; border-radius: 50%; filter: blur(56px); opacity: .8;
          will-change: transform;
        }
        .d2-aurora span:nth-child(1) {
          width: 520px; height: 360px; left: 8%; top: 30px;
          background: radial-gradient(circle, rgba(20,40,204,.26), transparent 70%);
          animation: d2drift1 22s ease-in-out infinite;
        }
        .d2-aurora span:nth-child(2) {
          width: 460px; height: 340px; right: 10%; top: 6px;
          background: radial-gradient(circle, rgba(124,58,237,.26), transparent 70%);
          animation: d2drift2 26s ease-in-out infinite;
        }
        .d2-aurora span:nth-child(3) {
          width: 380px; height: 280px; left: 40%; top: 130px;
          background: radial-gradient(circle, rgba(14,165,233,.20), transparent 70%);
          animation: d2drift3 30s ease-in-out infinite;
        }
        @keyframes d2drift1 { 0%,100%{transform:translate3d(0,0,0) scale(1)} 50%{transform:translate3d(60px,26px,0) scale(1.12)} }
        @keyframes d2drift2 { 0%,100%{transform:translate3d(0,0,0) scale(1)} 50%{transform:translate3d(-54px,32px,0) scale(1.15)} }
        @keyframes d2drift3 { 0%,100%{transform:translate3d(0,0,0) scale(1)} 50%{transform:translate3d(30px,-24px,0) scale(.9)} }

        /* Drifting light motes — ambient life while the page sits idle */
        .d2-motes { position: absolute; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
        .d2-motes i {
          position: absolute; width: 4px; height: 4px; border-radius: 50%;
          background: radial-gradient(circle, rgba(124,58,237,.55), rgba(20,40,204,.16) 60%, transparent 70%);
          opacity: 0; will-change: transform, opacity;
        }
        .d2-motes i:nth-child(1) { left: 14%; top: 74%; animation: d2mote 15s ease-in-out infinite; }
        .d2-motes i:nth-child(2) { left: 28%; top: 86%; animation: d2mote 19s ease-in-out infinite 2.4s; }
        .d2-motes i:nth-child(3) { left: 47%; top: 80%; animation: d2mote 17s ease-in-out infinite 5.1s; }
        .d2-motes i:nth-child(4) { left: 63%; top: 88%; animation: d2mote 21s ease-in-out infinite 1.2s; }
        .d2-motes i:nth-child(5) { left: 78%; top: 76%; animation: d2mote 16s ease-in-out infinite 7.3s; }
        .d2-motes i:nth-child(6) { left: 89%; top: 84%; animation: d2mote 23s ease-in-out infinite 3.8s; }
        @keyframes d2mote {
          0%   { transform: translate3d(0,0,0) scale(.6); opacity: 0 }
          12%  { opacity: .85 }
          70%  { opacity: .5 }
          100% { transform: translate3d(16px,-190px,0) scale(1.3); opacity: 0 }
        }

        /* Fine film grain — keeps the large flat areas from looking plasticky */
        .d2-grain {
          position: absolute; inset: 0; pointer-events: none; z-index: 1; opacity: .5; mix-blend-mode: multiply;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.055'/%3E%3C/svg%3E");
        }

        /* ── The agent's incoming message ── */
        .d2-incoming { animation: d2msgin .6s var(--ease-spring, cubic-bezier(.2,.8,.2,1)) both .12s; }
        @keyframes d2msgin { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .d2-bubble {
          position: relative; padding: 13px 17px; border-radius: 4px 16px 16px 16px;
          background: var(--white); border: 1px solid var(--border);
          box-shadow: 0 1px 2px rgba(13,13,13,.04), 0 10px 26px -16px rgba(20,40,204,.30);
          font-size: 14px; line-height: 1.6; color: var(--ink);
        }
        [dir="rtl"] .d2-bubble { border-radius: 16px 4px 16px 16px; }
        /* Soft halo that breathes around the agent avatar while idle */
        .d2-avatar { position: relative; box-shadow: 0 2px 8px rgba(20,40,204,.25); }
        .d2-avatar::after {
          content: ''; position: absolute; inset: -5px; border-radius: 50%;
          background: var(--gradient-ai); opacity: .22; z-index: -1;
          animation: d2halo 3.4s ease-in-out infinite;
        }
        @keyframes d2halo { 0%,100% { transform: scale(1); opacity: .20 } 50% { transform: scale(1.22); opacity: .05 } }

        .d2-typing { display: inline-flex; gap: 5px; align-items: center; padding: 3px 0; }
        .d2-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gray-soft); animation: d2dot 1.3s ease-in-out infinite; }
        .d2-typing i:nth-child(2) { animation-delay: .17s }
        .d2-typing i:nth-child(3) { animation-delay: .34s }
        @keyframes d2dot { 0%,60%,100% { transform: translateY(0); opacity: .45 } 30% { transform: translateY(-4px); opacity: 1 } }

        /* Idle prompt breathes very faintly so the page never feels frozen */
        .d2-prompt-idle::after {
          content: ''; position: absolute; inset: -1px; border-radius: 19px; pointer-events: none;
          box-shadow: 0 0 0 0 rgba(20,40,204,.16);
          animation: d2breathe 4.6s ease-in-out infinite;
        }
        .d2-prompt-idle:focus-within::after { animation: none; }
        @keyframes d2breathe {
          0%,100% { box-shadow: 0 0 0 0 rgba(20,40,204,.14) }
          50%     { box-shadow: 0 0 0 7px rgba(20,40,204,0) }
        }

        /* ── Idle → session transition ──
           Layers leave in depth order (panels first, greeting last). Deliberately
           opacity + transform ONLY: both are compositor-driven, so the swap stays
           at 60fps. An earlier filter:blur() version looked nice in isolation but
           forced a full repaint of the whole panel grid every frame and was the
           actual source of the stutter. */
        .d2-idle > * {
          transition: opacity .38s var(--ease-out, cubic-bezier(.2,.7,.3,1)),
                      transform .44s var(--ease-spring, cubic-bezier(.2,.8,.2,1));
        }
        .d2-idle.is-leaving { pointer-events: none; }
        .d2-idle.is-leaving > * { will-change: opacity, transform; }
        .d2-idle.is-leaving .d2-leave-a { opacity: 0; transform: translate3d(0,-16px,0) scale(.988); transition-delay: .07s; }
        .d2-idle.is-leaving .d2-leave-b { opacity: 0; transform: translate3d(0,14px,0)  scale(.99); }

        .d2-session { animation: d2enter .46s var(--ease-out, cubic-bezier(.2,.7,.3,1)) both .04s; will-change: opacity, transform; }
        @keyframes d2enter { from { opacity: 0; transform: translate3d(0,18px,0) } to { opacity: 1; transform: none } }
        .d2-msg { animation: d2msgin .5s var(--ease-spring, cubic-bezier(.2,.8,.2,1)) both; }

        /* ── Panels ── */
        .d2-card {
          position: relative; overflow: hidden; min-width: 0;
          background: var(--white); border: 1px solid var(--border);
          border-radius: var(--radius-card); padding: 20px 22px;
          box-shadow: 0 1px 2px rgba(13,13,13,.04), 0 8px 24px -12px rgba(13,13,13,.10);
          transition: box-shadow .35s var(--ease-out, ease), border-color .35s ease, transform .35s var(--ease-out, ease);
        }
        /* Hairline specular highlight along the top edge */
        .d2-card::before {
          content: ''; position: absolute; inset: 0 0 auto; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.9) 22%, rgba(255,255,255,.9) 78%, transparent);
          opacity: .7; pointer-events: none;
        }
        .d2-card:hover {
          transform: translateY(-2px);
          border-color: rgba(20,40,204,.16);
          box-shadow: 0 2px 4px rgba(13,13,13,.04), 0 20px 44px -18px rgba(20,40,204,.26);
        }

        /* ── Pipeline ── */
        .d2-flow { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--offwhite); gap: 2px; }
        .d2-flow i {
          display: block; height: 100%; border-radius: 999px; position: relative; overflow: hidden;
          animation: d2grow .9s var(--ease-spring, cubic-bezier(.2,.8,.2,1)) both;
        }
        .d2-flow i::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent);
          transform: translateX(-100%); animation: d2sheen 3.4s ease-in-out infinite;
        }
        @keyframes d2grow { from { transform: scaleX(0); transform-origin: left } to { transform: scaleX(1) } }
        @keyframes d2sheen { 0%,60%{transform:translateX(-100%)} 100%{transform:translateX(220%)} }

        .d2-stagegrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 14px 10px; margin-top: 18px; }
        .d2-stage-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* ── Rows (exposure / attention) ── */
        .d2-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 10px; margin: 0 -10px; border: none; background: none;
          border-radius: 12px; cursor: pointer; text-align: start; font-family: inherit;
          transition: background .18s ease;
        }
        .d2-row:hover { background: var(--offwhite); }
        .d2-chev { color: var(--gray-soft); opacity: 0; transform: translateX(-4px); transition: opacity .18s ease, transform .18s ease; }
        .d2-row:hover .d2-chev { opacity: 1; transform: translateX(0); }
        .d2-track { height: 5px; border-radius: 999px; background: var(--offwhite); overflow: hidden; }
        .d2-track i { display: block; height: 100%; border-radius: 999px; animation: d2grow 1s var(--ease-spring, cubic-bezier(.2,.8,.2,1)) both; }

        .d2-figure { font-family: var(--font-display); font-size: 23px; font-weight: 600; letter-spacing: -.02em; color: var(--ink); }
        .d2-caption { font-family: var(--font-body); font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--gray); }

        /* ── Responsive ── */
        .d2-grid-main { display: grid; grid-template-columns: minmax(0,1.65fr) minmax(0,1fr); gap: 14px; }
        .d2-grid-sub  { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: 14px; margin-top: 14px; }
        @media (max-width: 900px) { .d2-grid-main { grid-template-columns: 1fr; } }

        @media (prefers-reduced-motion: reduce) {
          .d2-aurora span, .d2-flow i::after, .d2-motes i,
          .d2-avatar::after, .d2-prompt-idle::after,
          .d2-flow i, .d2-track i, .d2-incoming, .d2-session, .d2-msg {
            animation: none !important;
          }
          .d2-idle > * { transition: opacity .2s linear !important; }
          .d2-idle.is-leaving .d2-leave-a,
          .d2-idle.is-leaving .d2-leave-b { transform: none; filter: none; }
          .d2-card:hover { transform: none; }
        }
      `}</style>

      <Topbar crumbs={[{ label: t('nav.home') }]} actions={
        started ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetToIdle}>
            {t('dashboardPage.d2NewChat')}
          </button>
        ) : undefined
      } />

      <div
        className="page"
        data-page-name="Home"
        data-ai-context={JSON.stringify({ portal, page: 'home', ...aiContext })}
        style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 56px)' }}
      >
        {!started ? (
          /* ───────────────── Command center (waiting to be prompted) ───────────────── */
          <div className={`d2-idle${collapsing ? ' is-leaving' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Hero — greeting, the agent's opening text, then the prompt */}
            <div className="reveal d2-leave-a" style={{ position: 'relative', textAlign: 'center', padding: '34px 0 26px' }}>
              <div className="d2-aurora" aria-hidden="true"><span /><span /><span /></div>
              <div className="d2-motes" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
              <div className="d2-grain" aria-hidden="true" />
              <h1 style={{ position: 'relative', zIndex: 2, fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--ink)', margin: '0 0 8px' }}>
                {t(greetingKey(), { name: firstName })}
              </h1>
              <div className="subtitle" style={{ position: 'relative', zIndex: 2, marginBottom: 26 }}>
                {loading ? <Skeleton height={14} width={200} style={{ margin: '0 auto' }} /> : (
                  <>{orgName ? <span style={{ color: 'var(--ink-soft, var(--gray))', fontWeight: 500 }}>{orgName}</span> : null}
                    {orgName ? '  ·  ' : ''}{t('dashboardPage.d2Tagline')}</>
                )}
              </div>

              <div style={{ position: 'relative', zIndex: 2, maxWidth: 680, margin: '0 auto', width: '100%' }}>
                {/* The agent's briefing, delivered as an incoming message */}
                <div className="d2-incoming" style={{ display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'start', marginBottom: 18 }}>
                  <span className="d2-avatar" style={{
                    width: 30, height: 30, borderRadius: '50%', background: 'var(--gradient-ai)', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
                  }}>
                    <SparkIcon size={14} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--blue)' }}>
                        {t('dashboardPage.d2AgentName')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--gray-soft)' }}>{t('dashboardPage.d2Briefing')}</span>
                    </div>
                    <div className="d2-bubble">
                      {openerLoading
                        ? <span className="d2-typing" aria-label={t('aiPage.thinking')}><i /><i /><i /></span>
                        : (opener ?? t('dashboardPage.d2FallbackOpener'))}
                    </div>
                  </div>
                </div>

                {/* The prompt */}
                <div className="d2-prompt d2-prompt-idle">
                  <SparkIcon size={17} color="var(--blue)" />
                  <input
                    ref={inputRef}
                    className="d2-prompt-input"
                    placeholder={t('aiPage.askStrikeAnything')}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                    data-demo-target="home-chat-input"
                  />
                  <button type="button" className="d2-send" onClick={handleSubmit} disabled={!input.trim()} aria-label={t('aiPage.send')}>
                    <SendIcon />
                  </button>
                </div>

                {/* Suggestion chips */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
                  {chips.map((chip, i) => (
                    <button key={i} type="button" className="d2-chip reveal" style={{ animationDelay: `${i * 60}ms` }} onClick={() => runFirstMessage(chip)}>
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Live agent activity — sits right under the prompt cluster */}
                <div style={{ marginTop: 18, textAlign: 'start' }}><AgentActivityTicker /></div>
              </div>
            </div>

            {/* ── Overview: everything going on around the prompt ── */}
            <div className="reveal-stagger d2-leave-b" style={{ marginTop: 4 }}>

              {portal === 'bank' ? (
                /* ── Bank: portfolio health + book ── */
                <div className="d2-grid-main">
                  <Panel
                    title={t('dashboardPage.d2Portfolio')}
                    meta={dist?.avg_score != null ? <span className="d2-caption">{t('dashboardShared.scoreValue', { score: dist.avg_score })}</span> : undefined}
                  >
                    {loading || !dist ? <SkeletonText lines={3} /> : (
                      <>
                        <div className="d2-flow">
                          {[
                            { n: dist.strong,  c: 'var(--color-green)' },
                            { n: dist.fair,    c: 'var(--color-amber)' },
                            { n: dist.weak,    c: 'var(--color-red)' },
                            { n: dist.pending, c: 'var(--border-strong)' },
                          ].filter(s => s.n > 0).map((s, i) => (
                            <i key={i} style={{ flex: s.n, background: s.c, animationDelay: `${i * 90}ms` }} />
                          ))}
                        </div>
                        <div className="d2-stagegrid">
                          {[
                            { label: t('dashboardPage.d2ScoreStrong'), n: dist.strong,  c: 'var(--color-green)' },
                            { label: t('dashboardPage.d2ScoreFair'),   n: dist.fair,    c: 'var(--color-amber)' },
                            { label: t('dashboardPage.d2ScoreWeak'),   n: dist.weak,    c: 'var(--color-red)' },
                            { label: t('dashboardPage.d2Unrated'),     n: dist.pending, c: 'var(--gray-soft)' },
                          ].map(s => (
                            <div key={s.label} style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                <span className="d2-stage-dot" style={{ background: s.c }} />
                                <span className="d2-caption" style={{ letterSpacing: '.05em' }}>{s.label}</span>
                              </div>
                              <div className="d2-figure" style={{ fontSize: 20 }}><CountUp value={s.n} /></div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </Panel>

                  <Panel title={t('dashboardPage.d2Capital')}>
                    {loading ? <SkeletonText lines={3} /> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                          <div className="d2-caption" style={{ marginBottom: 4 }}>{t('dashboardPage.d2Outstanding')}</div>
                          <div className="d2-figure"><CountUp value={Number(bank?.outstanding_balance ?? 0)} format={fmtCurrency} /></div>
                        </div>
                        <div style={{ height: 1, background: 'var(--border)' }} />
                        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                          <div>
                            <div className="d2-caption" style={{ marginBottom: 4 }}>{t('dashboardPage.activePrograms')}</div>
                            <div className="d2-figure" style={{ fontSize: 19 }}><CountUp value={Number(bank?.active_program_count ?? 0)} /></div>
                          </div>
                          <div>
                            <div className="d2-caption" style={{ marginBottom: 4 }}>{t('dashboardPage.d2AwaitingReview')}</div>
                            <div className="d2-figure" style={{ fontSize: 19, color: Number(bank?.pending_bank_review ?? 0) > 0 ? 'var(--color-amber)' : 'var(--ink)' }}>
                              <CountUp value={Number(bank?.pending_bank_review ?? 0)} />
                            </div>
                          </div>
                        </div>
                        {Number(bank?.suppliers_at_risk ?? 0) > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-red)' }}>
                            <span className="d2-stage-dot" style={{ background: 'var(--color-red)' }} />
                            <strong style={{ fontWeight: 600 }}>{Number(bank?.suppliers_at_risk)}</strong>
                            <span style={{ color: 'var(--gray)' }}>{t('dashboardPage.d2SuppliersAtRisk')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>
                </div>
              ) : (
                <>
                  {/* ── Row 1: pipeline + trust ── */}
                  <div className="d2-grid-main">
                    <Panel
                      title={t('dashboardPage.d2Pipeline')}
                      meta={!loading && (
                        <span className="d2-caption" style={{ letterSpacing: '.03em', textTransform: 'none', fontSize: 12, fontWeight: 500 }}>
                          {t('dashboardPage.d2InFlight', { n: iso(String(activeDeals.length)), v: iso(fmtCurrency(activeValue)) })}
                        </span>
                      )}
                    >
                      {loading ? <SkeletonText lines={3} /> : activeDeals.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('dashboardPage.d2NoPipeline')}</div>
                      ) : (
                        <>
                          <div className="d2-flow">
                            {stages.filter(s => s.count > 0).map((s, i) => (
                              <i key={s.key} style={{ flex: s.count, background: s.color, animationDelay: `${i * 90}ms` }} />
                            ))}
                          </div>
                          <div className="d2-stagegrid">
                            {stages.map(s => (
                              <div key={s.key} style={{ minWidth: 0, opacity: s.count === 0 ? .42 : 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                  <span className="d2-stage-dot" style={{ background: s.color }} />
                                  <span className="d2-caption" style={{ letterSpacing: '.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {t(s.labelKey)}
                                  </span>
                                </div>
                                <div className="d2-figure" style={{ fontSize: 20 }}><CountUp value={s.count} /></div>
                                <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>{fmtCurrency(s.value)}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </Panel>

                    <Panel title={t('dashboardPage.d2Trust')}>
                      {loading ? <SkeletonText lines={3} /> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                          <PassportScoreRing score={passportScore} size="md" />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ marginBottom: 12 }}>
                              <span className={`badge ${scoreTierClass(passportScore)}`}>{scoreTierLabel(passportScore, t)}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                <span className="d2-caption">{t('dealDetail.totalTrades')}</span>
                                <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600 }}>
                                  <CountUp value={passport?.trade_count_total ?? 0} />
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                <span className="d2-caption">{t('financing.totalVolume')}</span>
                                <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600 }}>
                                  <CountUp value={passport?.trade_volume_total ?? 0} format={fmtCurrency} />
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </Panel>
                  </div>

                  {/* ── Row 2: capital · exposure · attention ── */}
                  <div className="d2-grid-sub">
                    <Panel title={t('dashboardPage.d2Capital')}>
                      {loading ? <SkeletonText lines={3} /> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {[
                            { label: t('dashboardPage.d2Receivables'),      value: receivables,       color: 'var(--color-green)' },
                            { label: t('dashboardPage.d2Payables'),         value: payables,          color: 'var(--blue)' },
                            { label: t('dashboardPage.d2FinancingInFlight'), value: financingInFlight, color: 'var(--color-purple)' },
                          ].map(row => (
                            <div key={row.label}>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                                <span className="d2-caption">{row.label}</span>
                                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                                  <CountUp value={row.value} format={fmtCurrency} />
                                </span>
                              </div>
                              <div className="d2-track">
                                <i style={{
                                  width: `${Math.min(100, (row.value / Math.max(receivables, payables, financingInFlight, 1)) * 100)}%`,
                                  background: row.color,
                                }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>

                    <Panel title={t('dashboardPage.d2Exposure')} meta={<span className="d2-caption" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11.5 }}>{t('dashboardPage.d2ExposureSub')}</span>}>
                      {loading ? <SkeletonText lines={3} /> : exposure.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('dashboardPage.d2NoExposure')}</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {exposure.map(e => (
                            <div key={e.name}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {e.name}
                                </span>
                                {e.score != null && (
                                  <span style={{
                                    flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
                                    background: `color-mix(in srgb, ${scoreColor(e.score)} 12%, transparent)`, color: scoreColor(e.score),
                                  }}>{e.score}</span>
                                )}
                                <span style={{ flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600 }}>
                                  {Math.round((e.value / exposureTotal) * 100)}%
                                </span>
                              </div>
                              <div className="d2-track">
                                <i style={{ width: `${(e.value / exposureTotal) * 100}%`, background: 'var(--gradient-ai)' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>

                    <Panel title={t('dashboardPage.d2Attention')}>
                      {loading ? <SkeletonText lines={3} /> : attention.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--gray)' }}>
                          <span className="d2-stage-dot" style={{ background: 'var(--color-green)' }} />
                          {t('dashboardPage.d2AllClear')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {attention.map(a => (
                            <button key={a.text} type="button" className="d2-row" onClick={() => router.push(a.href)}>
                              <span className="d2-stage-dot" style={{ background: a.color }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)' }}>{a.text}</span>
                              <Chevron />
                            </button>
                          ))}
                        </div>
                      )}
                    </Panel>
                  </div>
                </>
              )}

            </div>
          </div>
        ) : (
          /* ───────────────────────── Active session ───────────────────────── */
          <div className="d2-session" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 2px 16px' }}>
              {messages.map((m, i) => (
                m.role === 'assistant' ? (
                  <div
                    key={i}
                    className="d2-msg"
                    // Lets DemoAgentActivityFeed (Scene 7) spotlight the AI's own
                    // latest reply in the real chat — only ever the most recent
                    // assistant bubble carries this, so the target always tracks
                    // whichever response the tour is currently narrating.
                    data-demo-target={i === messages.length - 1 ? 'chat-last-assistant' : undefined}
                    style={{ display: 'flex', gap: 11, alignItems: 'flex-start', maxWidth: '82%', animationDelay: `${Math.min(i, 3) * 70}ms` }}
                  >
                    <span className="d2-avatar" style={{
                      width: 30, height: 30, borderRadius: '50%', background: 'var(--gradient-ai)', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
                    }}>
                      <SparkIcon size={14} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 5 }}>
                        {t('dashboardPage.d2AgentName')}
                      </div>
                      <div className="d2-bubble">
                        {renderAssistantContent(m.content)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="d2-msg" style={{ display: 'flex', justifyContent: 'flex-end', animationDelay: `${Math.min(i, 3) * 70}ms` }}>
                    <div style={{
                      maxWidth: '78%', padding: '11px 16px', borderRadius: '16px 16px 4px 16px',
                      background: 'var(--blue)', color: '#fff', fontSize: 14, lineHeight: 1.55,
                      boxShadow: '0 8px 20px -12px rgba(20,40,204,.6)',
                    }}>
                      {m.content}
                    </div>
                  </div>
                )
              ))}
              {sending && (
                <div className="d2-msg" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                  <span className="d2-avatar" style={{
                    width: 30, height: 30, borderRadius: '50%', background: 'var(--gradient-ai)', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <SparkIcon size={14} />
                  </span>
                  <span className="d2-typing" aria-label={t('aiPage.thinking')}><i /><i /><i /></span>
                </div>
              )}
            </div>
            <div className="d2-prompt" style={{ marginTop: 8 }}>
              <SparkIcon size={17} color="var(--blue)" />
              <input
                className="d2-prompt-input"
                placeholder={t('aiPage.askStrikeAnything')}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
              />
              <button type="button" className="d2-send" onClick={handleSubmit} disabled={sending || !input.trim()} aria-label={t('aiPage.send')}>
                <SendIcon />
              </button>
            </div>
            {/* Scrolled into view *after* the input bar, not the last message —
                otherwise the newest message lands flush with the viewport edge
                and pushes the input pill itself out of view below it. */}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}
      </div>
    </>
  )
}
