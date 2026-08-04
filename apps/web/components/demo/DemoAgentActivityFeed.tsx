'use client'

import { useEffect, useRef, useState } from 'react'
import { useDemoFormBridge } from './DemoFormBridge'
import { TaskThreadView, type AgentTask } from '@/components/agent-task-thread'
import { DemoPlanCard, type PlanFacts } from './DemoPlanCard'
import { DemoNarrator } from './DemoNarrator'
import { sleep } from './demo-utils'

// The one scripted line in this entire scene — everything downstream is a
// real, live Claude response and real backend state. Has to be decisive
// enough for Claude to commit to a real submit_marketplace_offer tool call
// in one turn rather than only searching/recommending and asking a
// clarifying question first — a vaguer "we need more steel" phrasing was
// tested and reliably stopped short of actually opening an offer.
const STEEL_MESSAGE =
  "We need to lock in a larger steel inventory before Q4. Find the best available steel listing on Strike Place and submit an opening offer on our behalf now — use your judgment on quantity and price within a sensible market range."
const REVISE_MESSAGE =
  "Actually, tighten the price ceiling a bit and make sure the deadline is no more than 14 days out before you send it."

type Phase = 'sending' | 'waiting' | 'plan' | 'thread' | 'done' | 'error'

interface TaskListItem { id: string }

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

async function fetchThread(rootId: string): Promise<{ rootTask: AgentTask | null; currentTask: AgentTask | null }> {
  try {
    const res = await fetch(`/api/agents/tasks/${rootId}/messages`, { cache: 'no-store' })
    if (!res.ok) return { rootTask: null, currentTask: null }
    const data = await res.json()
    return { rootTask: data.rootTask ?? null, currentTask: data.currentTask ?? null }
  } catch {
    return { rootTask: null, currentTask: null }
  }
}

async function postRevise(rootId: string, content: string) {
  try {
    await fetch(`/api/agents/tasks/${rootId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  } catch {
    // Best-effort — the sequence continues to GATE 1 with the original terms
    // if the revise round fails for any reason.
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

interface CounterpartyTaskInfo {
  id: string
  type: string
  status: string
}

// A good offer can be finalized from EITHER side of a negotiation (see
// runListingDefenseTick in lib/ai/agent-tick.ts) — when the counterparty
// (listing owner) decides to accept, that finalize task is created under
// THEIR org, invisible to our own thread. There's no counterparty session in
// this demo to click their own approve button, so this cross-org lookup +
// approve pair (both demo-gated, see their route doc comments) lets the loop
// react to whichever side actually produces the finalize card.
async function fetchDemoStatus(rootId: string): Promise<{ counterpartyTask: CounterpartyTaskInfo | null; planFacts: PlanFacts | null }> {
  try {
    const res = await fetch(`/api/demo/negotiation-status?rootTaskId=${rootId}`, { cache: 'no-store' })
    if (!res.ok) return { counterpartyTask: null, planFacts: null }
    const data = await res.json()
    return {
      counterpartyTask: (data?.counterpartyTask ?? null) as CounterpartyTaskInfo | null,
      planFacts: (data?.planFacts ?? null) as PlanFacts | null,
    }
  } catch {
    return { counterpartyTask: null, planFacts: null }
  }
}

async function fetchCounterpartyTask(rootId: string): Promise<CounterpartyTaskInfo | null> {
  return (await fetchDemoStatus(rootId)).counterpartyTask
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

// Finds the agent_tasks thread the scripted message just created by diffing
// against the task ids that existed right before sending it — reliable even
// though the demo org already has several seeded, unrelated pending tasks.
async function pollForNewTask(before: Set<string>, isCancelled: () => boolean): Promise<string | null> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (isCancelled()) return null
    const res = await fetch('/api/agents/tasks?limit=100', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      const found = ((data.tasks ?? []) as TaskListItem[]).find((t) => !before.has(t.id))
      if (found) return found.id
    }
    await sleep(1000)
  }
  return null
}

const TERMINAL_NEGOTIATION_STATUSES = new Set([
  'completed_rejected', 'failed', 'halted_by_user', 'halted_guardrail', 'completed_withdrawn', 'completed_deadline',
])

// Drives the real tick loop at demo speed (every ~1.5s instead of pg_cron's
// once-a-minute cadence) and auto-approves whatever comes back needing a
// human — an escalation (out-of-guardrail terms) or the GATE-2 finalize card
// — exactly the same way a live viewer clicking Approve would. Returns the
// resulting deal id once GATE 2 is actually approved, or null if the
// negotiation ends any other way (rejected, deadline, guardrail halt, or the
// loop's own safety cap) — a live negotiation is not guaranteed to close.
async function runNegotiationLoop(
  rootId: string,
  isCancelled: () => boolean,
  setCaption: (s: string) => void
): Promise<string | null> {
  const deadline = Date.now() + 100000
  let ticks = 0
  while (Date.now() < deadline && ticks < 50) {
    if (isCancelled()) return null
    await postTick()
    ticks++
    await sleep(1500)
    if (isCancelled()) return null

    const { rootTask, currentTask } = await fetchThread(rootId)
    if (!rootTask || !currentTask) continue

    if (currentTask.status === 'awaiting_approval') {
      const isFinalize = currentTask.type === 'negotiation_ready_to_finalize'
      setCaption(
        isFinalize
          ? 'Terms look good — one final human approval before this becomes a real deal.'
          : 'It hit a guardrail and is asking for guidance — approving to keep it moving.'
      )
      await sleep(2200)
      if (isCancelled()) return null
      await postApprove(currentTask.id)
      if (isFinalize) {
        await sleep(1200)
        const { currentTask: finalized } = await fetchThread(rootId)
        const dealId = finalized?.result?.deal_id
        return typeof dealId === 'string' ? dealId : null
      }
      continue
    }

    // Our own side has nothing pending — check whether the COUNTERPARTY's
    // agent decided to accept instead (see fetchCounterpartyTask doc comment).
    const counterpartyTask = await fetchCounterpartyTask(rootId)
    if (counterpartyTask?.type === 'negotiation_ready_to_finalize') {
      setCaption('The counterparty’s agent is ready to accept — approving finalization.')
      await sleep(2200)
      if (isCancelled()) return null
      const result = await postApproveAny(counterpartyTask.id)
      const dealId = result?.deal_id
      if (typeof dealId === 'string') return dealId
      continue
    }

    const negStatus = rootTask.negotiation?.status
    if (negStatus && TERMINAL_NEGOTIATION_STATUSES.has(negStatus)) {
      setCaption('This round didn’t land a deal — even Strike AI knows when to walk away.')
      return null
    }

    setCaption(`Round ${rootTask.negotiation?.current_round ?? '—'} — reasoning through terms in real time.`)
  }
  setCaption('Still negotiating — real rounds can take a little longer than a script.')
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
      // structure_type 'open' + no financing_type deliberately avoids the
      // reverse-factoring/PO-financing shipment-stage gates in
      // app/api/marketplace/financing/route.ts — this deal is fresh
      // ('agreed'), not yet shipped.
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

function TypingDots() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)',
              animation: `ai-dot-pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </span>
    </div>
  )
}

// Scene 7's centerpiece — the one entirely live, unscripted stretch of the
// tour. The chat message is scripted (for reliability in front of a live
// prospect) but everything downstream is real: the actual /api/ai/chat
// sourcing + vetting + offer, the actual GATE-1/GATE-2 approval thread
// (TaskThreadView, unmodified — the same component the real Agent tab uses),
// a real accelerated tick-loop negotiation, and a real financing request on
// the resulting deal. Docked beside the real chat rather than covering it —
// the point of this scene is "watch it happen inline," not a fullscreen
// takeover.
export function DemoAgentActivityFeed({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const bridge = useDemoFormBridge()
  const [phase, setPhase] = useState<Phase>('sending')
  const [caption, setCaption] = useState('Sending a real request to Strike AI…')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [planFacts, setPlanFacts] = useState<PlanFacts | null>(null)
  const [financingSummary, setFinancingSummary] = useState<string | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // A local closure variable, not a ref — React StrictMode double-invokes
    // this effect in dev (mount -> cleanup -> mount again), and a shared ref
    // would have the second invocation's reset silently un-cancel the first,
    // now-orphaned run, leaving two concurrent copies of this whole sequence
    // racing each other (duplicate chat sends, a stale poll latching onto an
    // unrelated older task). Matches the same pattern DemoConductor.tsx
    // already uses for its own beat-scheduling effect.
    let cancelled = false
    const isCancelled = () => cancelled

    ;(async () => {
      try {
        const before = await fetchTaskIds()
        if (isCancelled()) return

        await bridge?.getChatApi()?.sendMessage(STEEL_MESSAGE)
        if (isCancelled()) return

        setCaption('Sourced and vetted — now watch it open a real offer.')
        setPhase('waiting')
        const rootId = await pollForNewTask(before, isCancelled)
        if (isCancelled()) return
        if (!rootId) {
          setCaption('The proposal is taking longer than usual to appear this run.')
          setPhase('error')
          await sleep(3500)
          if (!isCancelled()) onDoneRef.current()
          return
        }
        setTaskId(rootId)

        // Show the reasoning BEFORE the transcript: which listing it picked,
        // what it bid, who it's dealing with — scored the same way the Passport
        // scores a company, so the plan is legible rather than a black box.
        const status = await fetchDemoStatus(rootId)
        if (isCancelled()) return
        if (status.planFacts) {
          setPlanFacts(status.planFacts)
          setPhase('plan')
          setCaption('Before sending anything, it scored the deal — price position, counterparty trust, execution risk, and how tightly it is allowed to act.')
          await sleep(7000)
          if (isCancelled()) return
        }

        setPhase('thread')
        setCaption('This is the real agent activity log — every round it runs on your behalf lands here, live.')

        await sleep(2800)
        if (isCancelled()) return
        const { currentTask } = await fetchThread(rootId)

        // A direct chat request to submit an offer is itself the human
        // approval (see lib/ai/agent-negotiation-setup.ts) — the resulting
        // task starts life already 'executing', with no separate GATE-1 card.
        // Only a scan-sourced proposal (not this path) would still be
        // 'awaiting_approval' here, but this stays defensive against that
        // case rather than assuming.
        if (currentTask?.status === 'awaiting_approval') {
          setCaption('Tightening the terms before it goes any further.')
          await postRevise(rootId, REVISE_MESSAGE)
          await sleep(2200)
          if (isCancelled()) return
          setCaption('One human approval starts it — then it runs on its own.')
          await sleep(1600)
          if (isCancelled()) return
          const { currentTask: reloaded } = await fetchThread(rootId)
          if (reloaded?.status === 'awaiting_approval') await postApprove(reloaded.id)
        } else {
          setCaption('It already sourced, vetted, and opened a real offer — sending it was the approval.')
          await sleep(2600)
        }
        if (isCancelled()) return

        setCaption('Live — negotiating autonomously, inside the limits it was given.')
        const dealId = await runNegotiationLoop(rootId, isCancelled, setCaption)
        if (isCancelled()) return

        if (!dealId) {
          setPhase('done')
          await sleep(4000)
          if (!isCancelled()) onDoneRef.current()
          return
        }

        setCaption('Deal closed — now it requests financing automatically.')
        await sleep(2000)
        if (isCancelled()) return
        const summary = await submitFinancing(dealId)
        if (isCancelled()) return
        setFinancingSummary(summary)
        setCaption(
          summary
            ? 'Sourced to financed — with a human only ever asked to say yes.'
            : 'Deal closed. Sourced to signed — with a human only ever asked to say yes.'
        )
        setPhase('done')
        await sleep(4600)
        if (!isCancelled()) onDoneRef.current()
      } catch {
        if (isCancelled()) return
        setCaption('Something interrupted this live run.')
        setPhase('error')
        await sleep(3000)
        if (!isCancelled()) onDoneRef.current()
      }
    })()

    return () => { cancelled = true }
    // Runs exactly once per mount — this whole sequence only ever plays
    // through a single fresh proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
    {/* Same narrator bar the spotlight scenes use, so Scene 7 is narrated like
        every other beat instead of being the one stretch with no dialogue. */}
    <DemoNarrator line={caption} onSkip={onSkip} />
    <div
      style={{
        // Sits clear of the narrator bar at the bottom of the viewport.
        position: 'fixed', top: 76, right: 20, bottom: 150, width: 420, maxWidth: 'calc(100vw - 40px)',
        background: 'var(--white)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-elevated)',
        border: '1px solid var(--border-strong)', zIndex: 9997,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--gradient-ai)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#fff',
            animation: 'badge-pulse 2.4s ease infinite',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff' }}>
            Strike AI — Agent activity, live
          </span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: '#fff' }}>{caption}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {phase === 'plan' ? (
          planFacts ? <DemoPlanCard facts={planFacts} /> : <TypingDots />
        ) : phase === 'thread' || phase === 'done' ? (
          <>
            {planFacts && <DemoPlanCard facts={planFacts} />}
            {taskId ? <TaskThreadView taskId={taskId} onBack={() => {}} /> : <TypingDots />}
          </>
        ) : phase === 'error' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
            <div style={{ color: 'var(--gray)', fontSize: 13.5 }}>{caption}</div>
          </div>
        ) : (
          <TypingDots />
        )}
      </div>

      {financingSummary && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: '#EDFAF4', fontSize: 12.5, color: 'var(--color-green)', fontWeight: 600 }}>
          Financing requested: {financingSummary}
        </div>
      )}

    </div>
    </>
  )
}
