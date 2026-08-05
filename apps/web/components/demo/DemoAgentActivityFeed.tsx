'use client'

import { useEffect, useRef, useState } from 'react'
import { useDemoFormBridge } from './DemoFormBridge'
import { sleep } from './demo-utils'

// Three scripted chat messages — everything downstream (the plan Strike AI
// proposes, the real submit_marketplace_offer tool call, the real GATE-1
// auto-approval that comes from an explicit chat instruction, the real
// tick-loop negotiation, GATE 2, and the resulting deal) is live, not
// scripted. Splitting this into propose -> revise -> execute (rather than
// one message that both researches AND submits) mirrors the real two-gate
// shape: the agent has to lay out a plan and be told to act before it
// commits anything. Responses are cached per label after the first real run
// (see lib/ai/demo-ai-cache.ts) — replays don't re-spend real API credits.
const PLAN_MESSAGE =
  "We need to lock in a larger steel inventory for Q4. Before we commit to anything, put together a plan — the best available listing on Strike Place, a target quantity, and a sensible opening price."
const REVISE_MESSAGE =
  "Tighten the price ceiling a bit and make sure the deadline is no more than 14 days out."
const EXECUTE_MESSAGE =
  "That works — go ahead and submit the opening offer now."

type Phase = 'landing' | 'planning' | 'revising' | 'executing' | 'negotiating' | 'wrapping' | 'done' | 'error'

interface TaskListItem { id: string }
interface ThreadMessage { id: string; role: 'user' | 'assistant' | 'system'; content: string; created_at: string }
interface NegotiationInfo { status: string; current_round: number }
interface ThreadTask {
  id: string
  status: string
  type: string
  result?: Record<string, unknown> | null
  negotiation?: NegotiationInfo | null
}

async function fetchTaskIds(): Promise<Set<string>> {
  try {
    const res = await fetch('/api/agents/tasks?limit=100', { cache: 'no-store' })
    if (!res.ok) return new Set()
    const data = await res.json()
    return new Set(((data.tasks ?? []) as TaskListItem[]).map((t) => t.id))
  } catch {
    return new Set()
  }
}

async function fetchThread(rootId: string): Promise<{ rootTask: ThreadTask | null; currentTask: ThreadTask | null; messages: ThreadMessage[] }> {
  try {
    const res = await fetch(`/api/agents/tasks/${rootId}/messages`, { cache: 'no-store' })
    if (!res.ok) return { rootTask: null, currentTask: null, messages: [] }
    const data = await res.json()
    return { rootTask: data.rootTask ?? null, currentTask: data.currentTask ?? null, messages: data.messages ?? [] }
  } catch {
    return { rootTask: null, currentTask: null, messages: [] }
  }
}

async function postApprove(taskId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/agents/tasks/${taskId}/approve`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

interface CounterpartyTaskInfo { id: string; type: string; status: string }

// A good offer can be finalized from EITHER side of a negotiation (see
// runListingDefenseTick in lib/ai/agent-tick.ts) — when the counterparty
// (listing owner) decides to accept, that finalize task is created under
// THEIR org, invisible to our own thread. There's no counterparty session in
// this demo to click their own approve button, so this cross-org lookup +
// approve pair (both demo-gated) lets the loop react to whichever side
// actually produces the finalize card.
async function fetchCounterpartyTask(rootId: string): Promise<CounterpartyTaskInfo | null> {
  try {
    const res = await fetch(`/api/demo/negotiation-status?rootTaskId=${rootId}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.counterpartyTask ?? null) as CounterpartyTaskInfo | null
  } catch {
    return null
  }
}

async function postApproveAny(taskId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch('/api/demo/approve-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.result ?? null) as Record<string, unknown> | null
  } catch {
    return null
  }
}

async function postTick() {
  try {
    // /api/demo/tick, not /api/agents/tick — the real, session-scoped tick
    // route only advances the CALLER's own org's side of a negotiation, but
    // Harborview (the demo login) just made the opening offer, so it's the
    // counterparty's (listing owner's) turn to respond first. The demo-only
    // route ticks both sides unscoped, same as the real pg_cron job does.
    await fetch('/api/demo/tick', { method: 'POST' })
  } catch {
    // The next loop iteration just retries — a single missed tick isn't fatal.
  }
}

// Force-closes the demo tenant's negotiation the instant this run is done
// with it (success, timeout, error, or an early skip) — see the route's own
// doc comment for why this can't just wait for the next Replay's reset.
// Fire-and-forget: never let a cleanup call block or throw into the caller.
function closeDemoNegotiation() {
  fetch('/api/demo/close-negotiation', { method: 'POST' }).catch(() => {})
}

// Finds the agent_tasks thread the EXECUTE_MESSAGE just created by diffing
// against the task ids that existed right before sending it — reliable even
// though the demo org already has several seeded, unrelated pending tasks.
async function pollForNewTask(before: Set<string>, isCancelled: () => boolean): Promise<string | null> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (isCancelled()) return null
    const res = await fetch('/api/agents/tasks?limit=100', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      const found = ((data.tasks ?? []) as TaskListItem[]).find((t) => !before.has(t.id))
      if (found) return found.id
    }
    await sleep(450)
  }
  return null
}

const TERMINAL_NEGOTIATION_STATUSES = new Set([
  'completed_rejected', 'failed', 'halted_by_user', 'halted_guardrail', 'completed_withdrawn', 'completed_deadline',
])

// Drives the real tick loop at demo speed (every ~700ms instead of pg_cron's
// once-a-minute cadence) and auto-approves whatever comes back needing a
// human — an escalation (out-of-guardrail terms) or the GATE-2 finalize card
// — exactly the same way a live viewer clicking Approve would. Streams every
// real round to the caller via `onMessages`/`onStatus` (the caller decides
// how much of that to actually show — see `roundsShown` in the component
// below, which freezes the visible feed after a few rounds while the loop
// itself keeps running for real underneath). Returns the resulting deal id
// once GATE 2 is actually approved, or null if the negotiation ends any
// other way — a live negotiation is not guaranteed to close.
async function runNegotiationLoop(
  rootId: string,
  isCancelled: () => boolean,
  onStatus: (s: string, round: number) => void,
  onMessages: (msgs: ThreadMessage[]) => void
): Promise<string | null> {
  const deadline = Date.now() + 60000
  let ticks = 0
  while (Date.now() < deadline && ticks < 50) {
    if (isCancelled()) return null
    await postTick()
    ticks++
    await sleep(700)
    if (isCancelled()) return null

    const { rootTask, currentTask, messages } = await fetchThread(rootId)
    onMessages(messages)
    if (!rootTask || !currentTask) continue

    if (currentTask.status === 'awaiting_approval') {
      const isFinalize = currentTask.type === 'negotiation_ready_to_finalize'
      onStatus(
        isFinalize
          ? 'Terms look good — one final approval before this becomes a real deal.'
          : 'It hit a guardrail and is asking for guidance — approving to keep it moving.',
        rootTask.negotiation?.current_round ?? 0
      )
      await sleep(900)
      if (isCancelled()) return null
      await postApprove(currentTask.id)
      if (isFinalize) {
        await sleep(500)
        const { currentTask: finalized } = await fetchThread(rootId)
        const dealId = finalized?.result?.deal_id
        return typeof dealId === 'string' ? dealId : null
      }
      continue
    }

    // Our own side has nothing pending — check whether the COUNTERPARTY's
    // agent decided to accept instead.
    const counterpartyTask = await fetchCounterpartyTask(rootId)
    if (counterpartyTask?.type === 'negotiation_ready_to_finalize') {
      onStatus('The counterparty’s agent is ready to accept — approving finalization.', rootTask.negotiation?.current_round ?? 0)
      await sleep(900)
      if (isCancelled()) return null
      const result = await postApproveAny(counterpartyTask.id)
      const dealId = result?.deal_id
      if (typeof dealId === 'string') return dealId
      continue
    }

    const negStatus = rootTask.negotiation?.status
    if (negStatus && TERMINAL_NEGOTIATION_STATUSES.has(negStatus)) {
      onStatus('This round didn’t land a deal — even Strike AI knows when to walk away.', rootTask.negotiation?.current_round ?? 0)
      return null
    }

    onStatus(`Round ${rootTask.negotiation?.current_round ?? '—'} — reasoning through terms in real time.`, rootTask.negotiation?.current_round ?? 0)
  }
  onStatus('Still negotiating — real rounds can take a little longer than a script.', 0)
  return null
}

async function submitFinancing(dealId: string): Promise<string | null> {
  try {
    const dealRes = await fetch(`/api/deals/${dealId}`)
    if (!dealRes.ok) return null
    const { deal } = await dealRes.json()
    const amount = Math.round(Number(deal?.total_value ?? 0))
    if (!amount) return null
    const currency = deal?.agreed_currency ?? 'USD'
    const res = await fetch('/api/marketplace/financing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deal_id: dealId,
        structure_type: 'open',
        amount_requested: amount,
        preferred_tenor_days: 60,
        currency,
      }),
    })
    if (!res.ok) return null
    return `${currency} ${amount.toLocaleString()}`
  } catch {
    return null
  }
}

// Trims a system-narration message down to one readable line — for the
// compact log feed AND for the copy that gets surfaced into the real chat as
// an assistant message (see appendAssistantMessage in DemoFormBridge.tsx).
function shortMsg(content: string): string {
  const cut = content.indexOf('[[')
  const plain = (cut >= 0 ? content.slice(0, cut) : content).trim()
  return plain.length > 200 ? `${plain.slice(0, 197)}…` : plain
}

// Distills the real plan reply into a short spoken-style highlight — gives
// the plan a beat of its own instead of vanishing straight into the revise
// message, so the viewer actually registers what Strike AI came back with.
function planHighlight(reply: string): string {
  const stripped = reply
    .replace(/\[LISTING_CARD:[^\]]+\]/g, '')
    .replace(/\[\[STRIKE_BLOCK:[\s\S]*?\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return 'Here’s the plan it came back with.'
  const excerpt = stripped.length > 200 ? `${stripped.slice(0, 197)}…` : stripped
  return `Here’s the plan it came back with: ${excerpt}`
}

const MAX_ROUNDS_SHOWN = 3

// Narrates the scene from the TOP of the screen instead of the bottom — the
// real chat this scene is built around lives at the bottom of the page (the
// message list + its input box), and a bottom-fixed caption used to sit
// right on top of both, hiding the very thing the scene is supposed to show.
function TopCaption({ line, onSkip }: { line: string; onSkip: () => void }) {
  if (!line) return null
  return (
    <div
      style={{
        position: 'fixed', left: '50%', top: 68, transform: 'translateX(-50%)',
        maxWidth: 560, width: 'calc(100% - 48px)',
        background: 'var(--ink)', color: 'var(--white)',
        borderRadius: 'var(--radius-card)', padding: '14px 20px',
        fontSize: 14, lineHeight: 1.5, textAlign: 'center',
        boxShadow: 'var(--shadow-elevated)', zIndex: 9995,
      }}
    >
      {line}
      <button
        type="button"
        onClick={onSkip}
        style={{
          display: 'block', margin: '8px auto 0', background: 'none', border: 'none',
          color: 'var(--gray-soft)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        Skip demo
      </button>
    </div>
  )
}

// Small collapsible status pill, top-right (below the real topbar) — clear
// of the chat's own input box and latest messages at the bottom of the
// screen. Collapsed, it's just a one-line status ("Strike AI is negotiating
// — round 2"); expanded, it shows what it's doing now/next and a capped,
// read-only feed of the real negotiation rounds, like a small window into
// the Strike Room rather than a full replica of it.
function AgentLogPanel({
  expanded,
  onToggle,
  status,
  now,
  next,
  feed,
  moreRoundsHappening,
}: {
  expanded: boolean
  onToggle: () => void
  status: string
  now: string
  next: string | null
  feed: ThreadMessage[]
  moreRoundsHappening: boolean
}) {
  return (
    <div
      style={{
        position: 'fixed', right: 20, top: 68, zIndex: 9994,
        width: expanded ? 320 : 'auto', maxWidth: 'calc(100vw - 40px)',
        background: 'var(--white)', borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-elevated)', border: '1px solid var(--border-strong)',
        overflow: 'hidden', transition: 'width 240ms ease',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '9px 13px', background: expanded ? 'var(--gradient-ai)' : 'var(--white)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: expanded ? '#fff' : 'var(--blue)',
          animation: 'badge-pulse 2.4s ease infinite',
        }} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600,
          color: expanded ? '#fff' : 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {expanded ? 'Agent Log' : status}
        </span>
        <span style={{ fontSize: 10, color: expanded ? 'rgba(255,255,255,0.85)' : 'var(--gray-soft)', flexShrink: 0 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '11px 13px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 3 }}>Now</div>
            <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{now}</div>
          </div>
          {next && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 3 }}>Up next</div>
              <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.4 }}>{next}</div>
            </div>
          )}

          {feed.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {feed.map((m) => (
                <div key={m.id} style={{ fontSize: 11, lineHeight: 1.4, color: m.role === 'system' ? 'var(--ink-soft, var(--ink))' : 'var(--gray)' }}>
                  {shortMsg(m.content)}
                </div>
              ))}
              {moreRoundsHappening && (
                <div style={{ fontSize: 10.5, color: 'var(--gray-soft)', fontStyle: 'italic' }}>
                  …more rounds happening live, condensed here.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Scene 7's centerpiece — the one entirely live, unscripted stretch of the
// tour. Three chat messages are scripted (for reliability in front of a live
// prospect): propose a plan, revise it, then say go — but everything that
// happens as a result is real: the actual /api/ai/chat replies (rendered in
// the real Home chat log, not a copy of it), a real submit_marketplace_offer
// tool call, a real accelerated tick-loop negotiation, a real GATE-2
// finalize, and a real financing request on the resulting deal. As the
// negotiation runs, each new real round also gets appended straight into the
// visible chat (not just the small Agent Log) — see appendAssistantMessage.
export function DemoAgentActivityFeed({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const bridge = useDemoFormBridge()
  const [phase, setPhase] = useState<Phase>('landing')
  const [caption, setCaption] = useState('Landing on Home…')
  const [expanded, setExpanded] = useState(false)
  const [logStatus, setLogStatus] = useState('Strike AI is idle')
  const [logNow, setLogNow] = useState('Getting oriented on Home.')
  const [logNext, setLogNext] = useState<string | null>(null)
  const [feed, setFeed] = useState<ThreadMessage[]>([])
  const [roundsShown, setRoundsShown] = useState(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // A local closure variable, not a ref — React StrictMode double-invokes
    // this effect in dev (mount -> cleanup -> mount again), and a shared ref
    // would have the second invocation's reset silently un-cancel the first,
    // now-orphaned run, leaving two concurrent copies of this whole sequence
    // racing each other. Matches the same pattern DemoConductor.tsx uses for
    // its own beat-scheduling effect.
    let cancelled = false
    const isCancelled = () => cancelled
    let framesFrozen = false
    let negotiationStarted = false
    const chatAppendedIds = new Set<string>()

    async function expandFor(ms: number) {
      setExpanded(true)
      await sleep(ms)
      if (!isCancelled()) setExpanded(false)
    }

    ;(async () => {
      try {
        await sleep(700) // let the Home page visibly settle before anything moves
        if (isCancelled()) return

        // ── 1. Propose a plan ──────────────────────────────────────────────
        setPhase('planning')
        setCaption('Watch it plan first, then act — nothing gets submitted yet.')
        setLogStatus('Strike AI is researching…')
        setLogNow('Searching Strike Place and benchmarking price for a larger steel order.')
        setLogNext('Come back with a recommended listing, quantity, and opening price.')
        void expandFor(2400)
        const planReply = await bridge?.getChatApi()?.sendMessage(PLAN_MESSAGE, 'demo-plan')
        if (isCancelled()) return

        // ── 1b. Give the plan itself a beat before revising it — otherwise
        //     it lands and immediately gets talked over, and the viewer never
        //     actually registers what Strike AI produced.
        const highlight = planHighlight(planReply || '')
        setCaption(highlight)
        setLogNow('Plan received — reviewing it before deciding what to change.')
        await sleep(Math.min(6000, Math.max(3000, highlight.split(' ').length * 220)))
        if (isCancelled()) return

        // ── 2. Revise it ─────────────────────────────────────────────────
        setPhase('revising')
        setCaption('A quick revision, the same way you’d ask a real analyst.')
        setLogStatus('Revising the plan…')
        setLogNow('Tightening the price ceiling and shortening the deadline.')
        setLogNext('Wait for a go-ahead before submitting anything.')
        await sleep(500)
        if (isCancelled()) return
        await bridge?.getChatApi()?.sendMessage(REVISE_MESSAGE, 'demo-revise')
        if (isCancelled()) return

        // ── 3. Execute — this is the one message that actually acts ────────
        setPhase('executing')
        setCaption('One instruction to act — everything after this is real.')
        setLogStatus('Submitting the offer…')
        setLogNow('Opening a real offer on the listing, on your behalf.')
        setLogNext(null)
        await sleep(400)
        if (isCancelled()) return
        const before = await fetchTaskIds()
        await bridge?.getChatApi()?.sendMessage(EXECUTE_MESSAGE, 'demo-execute')
        if (isCancelled()) return

        const rootId = await pollForNewTask(before, isCancelled)
        if (isCancelled()) return
        if (!rootId) {
          setCaption('The offer is taking longer than usual to appear this run.')
          setPhase('error')
          await sleep(2200)
          if (!isCancelled()) onDoneRef.current()
          return
        }

        // ── 4. Negotiate — real, live, capped to a few visible rounds ───────
        negotiationStarted = true
        setPhase('negotiating')
        setCaption('Live — negotiating autonomously, inside the limits it was given.')
        setLogStatus('Negotiating…')
        setLogNow('Live round-by-round negotiation with the counterparty’s own agent.')
        void expandFor(2000)

        const dealId = await runNegotiationLoop(
          rootId,
          isCancelled,
          (status, round) => {
            if (isCancelled() || framesFrozen) return
            setLogNow(status)
            if (round >= MAX_ROUNDS_SHOWN) {
              framesFrozen = true
              setPhase('wrapping')
              setCaption('A few real rounds in — fast-forwarding past the rest.')
              setLogStatus('Wrapping up…')
              setLogNow('Reviewing final terms in the background — the rest of the back-and-forth is condensed here.')
              setExpanded(false)
            }
          },
          (msgs) => {
            if (isCancelled()) return
            setFeed(msgs.slice(-6))
            setRoundsShown(r => r + 1)
            if (framesFrozen) return
            // Surface each new real round straight into the visible chat —
            // not just the small Agent Log — so the negotiation is actually
            // watchable where the rest of this scene has been happening. Full
            // content (not shortMsg's truncated version) so the round's own
            // [[STRIKE_BLOCK:{"type":"comparison",...}]] renders as a real
            // "their offer" vs "our counter" card — this IS the window into
            // the two agents actually negotiating with each other, not just a
            // one-line price update.
            for (const m of msgs) {
              if (m.role !== 'system' || chatAppendedIds.has(m.id)) continue
              if (chatAppendedIds.size >= MAX_ROUNDS_SHOWN) break
              chatAppendedIds.add(m.id)
              bridge?.getChatApi()?.appendAssistantMessage?.(m.content)
            }
          }
        )
        if (isCancelled()) return

        if (!dealId) {
          setPhase('done')
          setLogStatus('Round ended without a deal')
          await sleep(2200)
          if (!isCancelled()) onDoneRef.current()
          return
        }

        // However many rounds were actually visible above (the round cap
        // freezes the chat feed after MAX_ROUNDS_SHOWN so a long real
        // negotiation doesn't stall the tour), the convergence itself always
        // gets its own line in the chat — the viewer needs to see the two
        // agents actually landing on terms, not just watch the feed go quiet.
        const { messages: finalMsgs } = await fetchThread(rootId)
        const finalSystemMsg = [...finalMsgs].reverse().find(m => m.role === 'system')
        if (finalSystemMsg && !chatAppendedIds.has(finalSystemMsg.id)) {
          chatAppendedIds.add(finalSystemMsg.id)
          bridge?.getChatApi()?.appendAssistantMessage?.(finalSystemMsg.content)
        }

        setPhase('done')
        setCaption('Deal closed — now it’s in the contract period, and it requests financing automatically.')
        setLogStatus('Deal finalized ✓')
        setLogNow('Terms agreed. Now in the contract period.')
        setLogNext(null)
        await sleep(900)
        if (isCancelled()) return
        const summary = await submitFinancing(dealId)
        if (isCancelled()) return
        if (summary) setLogNow(`Terms agreed — now in the contract period. Financing requested: ${summary}.`)
        setCaption(
          summary
            ? 'Sourced to financed — with a human only ever asked to say yes.'
            : 'Deal closed. Sourced to signed — now in the contract period.'
        )
        await sleep(2600)
        if (!isCancelled()) onDoneRef.current()
      } catch {
        if (isCancelled()) return
        setCaption('Something interrupted this live run.')
        setPhase('error')
        await sleep(2000)
        if (!isCancelled()) onDoneRef.current()
      } finally {
        // Whatever happened — success, timeout, or error — a real
        // negotiation may still be sitting 'active' in the DB. Close it now
        // rather than leaving it for the real, unscoped pg_cron job to keep
        // ticking (and spending real credits on) until someone replays.
        if (negotiationStarted) closeDemoNegotiation()
      }
    })()

    return () => {
      cancelled = true
      // Covers an early skip/navigation-away mid-negotiation — the async
      // function above may never reach its own `finally` if it's paused on
      // an in-flight await when this fires, so close defensively here too.
      if (negotiationStarted) closeDemoNegotiation()
    }
    // Runs exactly once per mount — this whole sequence only ever plays
    // through a single fresh proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <TopCaption line={caption} onSkip={onSkip} />
      <AgentLogPanel
        expanded={expanded}
        onToggle={() => setExpanded(v => !v)}
        status={logStatus}
        now={logNow}
        next={logNext}
        feed={phase === 'negotiating' || phase === 'wrapping' || phase === 'done' ? feed : []}
        moreRoundsHappening={phase === 'wrapping' && roundsShown >= MAX_ROUNDS_SHOWN}
      />
    </>
  )
}
