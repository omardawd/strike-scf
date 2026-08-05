'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEMO_SCENES, type NavStep } from './demo-script'
import { TextScene } from './TextScene'
import { SpotlightOverlay } from './SpotlightOverlay'
import { DemoNarrator } from './DemoNarrator'
import { DemoAgentActivityFeed } from './DemoAgentActivityFeed'
import { DemoCursor, type DemoCursorHandle } from './DemoCursor'
import { DemoFormBridgeProvider, useDemoFormBridge } from './DemoFormBridge'
import { waitForTarget, waitForRoute, sleep } from './demo-utils'
import { stopSpeaking } from './demo-speech'

type RunnerStatus = 'checking' | 'idle' | 'resetting' | 'running' | 'done'

// Holds off mounting the dimming/highlight box for `delayMs` after the
// target is otherwise ready — used on the very first reveal (passport-score)
// so the real page gets a beat to just be seen, plainly, before the tour
// starts pointing at anything on it.
function DelayedSpotlight({ targetSelector, delayMs }: { targetSelector: string; delayMs: number }) {
  const [ready, setReady] = useState(delayMs <= 0)
  useEffect(() => {
    if (delayMs <= 0) return
    setReady(false)
    const t = setTimeout(() => setReady(true), delayMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSelector, delayMs])
  if (!ready) return null
  return <SpotlightOverlay targetSelector={targetSelector} />
}

function DemoRunner() {
  const router = useRouter()
  const bridge = useDemoFormBridge()
  const cursorRef = useRef<DemoCursorHandle>(null)

  const [status, setStatus] = useState<RunnerStatus>('checking')
  const [beatIndex, setBeatIndex] = useState(0)
  // The beat actually being displayed — only advances once its click-path
  // navigation and target are confirmed ready, so the previous beat stays put
  // (no blank flash) while a slow navigation is still in progress.
  const [displayedIndex, setDisplayedIndex] = useState<number | null>(null)
  const reducedMotionRef = useRef(false)
  const beatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Resolves the current beat's "wait for a click" gate — only the audio-gate
  // scene uses this (`requireClick`), so the hold timer never starts until
  // the viewer has actually clicked (which also arms audio playback later).
  const clickResolverRef = useRef<(() => void) | null>(null)

  // Drives the visible cursor through a beat's real click path — sidebar link,
  // list item, tab button — the same sequence a viewer would have to click.
  // Never a route jump: each step waits for its own target to actually mount
  // (the previous step's click may still be navigating) before moving to it.
  const performNavSteps = useCallback(async (steps: NavStep[], cancelledRef: { current: boolean }) => {
    for (const step of steps) {
      await waitForTarget(step.target, 8000)
      if (cancelledRef.current) return
      const el = document.querySelector<HTMLElement>(`[data-demo-target="${step.target}"]`)
      if (!el) continue
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      await sleep(240)
      if (cancelledRef.current) return
      await cursorRef.current?.moveToElement(el)
      if (cancelledRef.current) return
      await cursorRef.current?.press()
      if (cancelledRef.current) return
      el.click()
      await sleep(320)
    }
  }, [])

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/demo/state')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setStatus(d?.intro_played_at ? 'idle' : 'running') })
      .catch(() => { if (!cancelled) setStatus('idle') })
    return () => { cancelled = true }
  }, [])

  const finish = useCallback(() => {
    if (beatTimerRef.current) clearTimeout(beatTimerRef.current)
    clickResolverRef.current = null
    stopSpeaking()
    setStatus('done')
    fetch('/api/demo/state', { method: 'POST' }).catch(() => {})
    // The closing beat ends wherever the last spotlight left the viewer (or
    // wherever "Skip demo" was clicked) — send them back to Home rather than
    // stranding them on a settings/ERP tab or mid-scene page.
    router.push('/home')
  }, [router])

  // The live agent-demo beat drives its own multi-step pacing (a real,
  // variable-length negotiation) rather than a fixed hold timer — it calls
  // this itself once its whole sequence (propose → revise → GATE 1 →
  // negotiate → GATE 2 → finance) actually completes.
  const advance = useCallback(() => setBeatIndex(i => i + 1), [])

  // Reset the sandbox (wipes anything a prior viewing generated on top of the
  // seeded data) before replaying, so a second prospect never sees the first
  // prospect's leftover financing request / offers / negotiation.
  const start = useCallback(() => {
    setStatus('resetting')
    setDisplayedIndex(null)
    fetch('/api/demo/reset', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        // The tour opens on Home, exactly like a real login would. The
        // 'passport-score' beat pushes to /passport itself, timed right
        // before its own reveal (see `directRoute` below) — not here — so
        // that page's real mount + entrance animation is still fresh/visible
        // when the veil lifts, instead of having already finished minutes
        // earlier during the audio-gate/welcome hold.
        router.push('/home')
        setBeatIndex(0)
        setStatus('running')
      })
  }, [router])

  useEffect(() => {
    if (status !== 'running') return
    const beat = DEMO_SCENES[beatIndex]
    if (!beat) { finish(); return }
    let cancelled = false

    const cancelledRef = { current: false }

    ;(async () => {
      // 0. The one beat that "loads in" rather than being clicked to (see
      //    fadeReveal below) navigates itself, timed so the destination
      //    page's own mount/entrance animation is still playing when the
      //    veil lifts a moment later, instead of long since finished.
      if (beat.directRoute) {
        router.push(beat.directRoute)
        await waitForRoute(beat.directRoute, 8000)
        if (cancelled) return
      }

      // 1. Drive the visible cursor through this beat's real click path, if
      //    it has one — the same clicks a viewer would make to get here
      //    (sidebar link, list item, tab button), never a direct route jump.
      //    The previous beat's content stays on screen the whole time.
      if (beat.navSteps && beat.navSteps.length > 0) {
        // Clear whatever the previous beat was showing — a spotlight box
        // left over from the last beat would otherwise sit there, dimmed and
        // irrelevant, while the cursor visibly moves on to click something
        // else entirely. The cursor itself is the thing to watch during a
        // navSteps sequence, not a stale highlight.
        setDisplayedIndex(null)
        await sleep(60)
        if (cancelled) return
        await performNavSteps(beat.navSteps, cancelledRef)
        if (cancelled) return
        cursorRef.current?.hide()
      }

      // 2. Don't reveal this beat until the page has actually rendered what
      //    it points at — the previous beat stays on screen in the meantime.
      //    Text/mockup scenes have no real-page target, so just yield a tick.
      if ((beat.kind === 'spotlight' || beat.kind === 'agent-demo') && beat.target) {
        await waitForTarget(beat.target, 8000)
        // One extra frame so the freshly-mounted target has been laid out and
        // measures a real, non-zero rect before the spotlight reads it.
        await sleep(120)
      } else {
        await sleep(50)
      }
      if (cancelled) return

      setDisplayedIndex(beatIndex)

      // 3. Now that the beat is actually showing, run its side effects.
      if (beat.formFill && bridge) {
        const form = bridge.getFinancingForm()
        form?.setShowForm(true)
        window.setTimeout(() => {
          if (cancelled) return
          form?.setType(beat.formFill!.type)
          form?.setAmount(beat.formFill!.amount)
          form?.setRateMax(beat.formFill!.rateMax)
        }, 600)
      }

      if (beat.submitForm && bridge) {
        window.setTimeout(() => {
          if (!cancelled) bridge.getFinancingForm()?.submit()
        }, Math.max(beat.holdMs - 600, 300))
      }

      // 4. requireClick beats (only the audio gate) don't start their hold
      //    countdown until the viewer clicks.
      if (beat.requireClick) {
        await new Promise<void>(resolve => { clickResolverRef.current = resolve })
        if (cancelled) return
      }

      // agent-demo drives its own advance (see `advance` above) instead of a
      // fixed hold timer — its actual duration depends on a real negotiation.
      if (beat.kind === 'agent-demo') return

      const hold = reducedMotionRef.current ? Math.min(beat.holdMs, 900) : beat.holdMs
      beatTimerRef.current = setTimeout(() => {
        if (!cancelled) setBeatIndex(i => i + 1)
      }, hold)
    })()

    return () => {
      cancelled = true
      cancelledRef.current = true
      clickResolverRef.current = null
      cursorRef.current?.hide()
      if (beatTimerRef.current) clearTimeout(beatTimerRef.current)
    }
    // Re-running on every dependency (router/bridge identity, etc.) would
    // restart the current beat's side effects — only advance on an actual
    // beat-index/status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, beatIndex])

  useEffect(() => {
    if (status === 'running' && beatIndex >= DEMO_SCENES.length) finish()
  }, [status, beatIndex, finish])

  if (status === 'checking' || status === 'done') return null

  if (status === 'idle' || status === 'resetting') {
    return (
      <button
        type="button"
        onClick={start}
        disabled={status === 'resetting'}
        style={{
          position: 'fixed', left: 16, bottom: 16, zIndex: 9998,
          background: 'var(--white)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-button)', padding: '8px 16px',
          fontSize: 12.5, fontWeight: 600, color: 'var(--ink)',
          cursor: status === 'resetting' ? 'default' : 'pointer',
          opacity: status === 'resetting' ? 0.6 : 1,
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {status === 'resetting' ? 'Resetting…' : '▶ Replay demo'}
      </button>
    )
  }

  // Rendered above every scene layer (spotlight 9996, text 9997, narrator
  // 10000) at all times — it's the visible proof that navigation between
  // beats happens via real clicks, not a route jump, so it needs to be on
  // screen during the click-path itself, not just once a beat is "revealed".
  const cursor = <DemoCursor ref={cursorRef} />

  const beat = displayedIndex !== null ? DEMO_SCENES[displayedIndex] : null
  if (!beat) return cursor

  if (beat.kind === 'text') {
    return (
      <>
        <TextScene
          title={beat.title}
          // Every text beat keeps a visible spoken line: its own `subtitle` when
          // it has one, otherwise the narration itself (the audio-gate scene has
          // no headline, so its narration IS the copy).
          subtitle={beat.subtitle ?? (beat.title ? undefined : beat.narration)}
          narration={beat.narration}
          logoInTitle={beat.logoInTitle}
          dark={beat.dark}
          aiGradient={beat.aiGradient}
          iconSet={beat.iconSet}
          requireClick={beat.requireClick}
          onReady={() => clickResolverRef.current?.()}
          onSkip={finish}
        />
        {cursor}
      </>
    )
  }

  if (beat.kind === 'agent-demo') {
    return <><DemoAgentActivityFeed onDone={advance} onSkip={finish} />{cursor}</>
  }

  // fadeReveal beats (just 'passport-score', the very first reveal) "load
  // in" rather than being clicked to — a brief white veil, already sitting
  // over the real page and spotlight underneath, fades out instead of the
  // cursor driving a click. See the module doc comment in demo-script.ts.
  const veil = beat.fadeReveal && (
    <>
      <style>{`
        @keyframes demo-fade-veil { from { opacity: 1 } to { opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { .demo-fade-veil { animation-duration: 1ms !important; } }
      `}</style>
      <div
        aria-hidden="true"
        className="demo-fade-veil"
        style={{
          position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--white)',
          pointerEvents: 'none', animation: 'demo-fade-veil 900ms ease both',
        }}
      />
    </>
  )

  return (
    <>
      {beat.target && !beat.noHighlight && (
        <DelayedSpotlight targetSelector={beat.target} delayMs={beat.spotlightDelayMs ?? 0} />
      )}
      <DemoNarrator line={beat.narration} onSkip={finish} />
      {veil}
      {cursor}
    </>
  )
}

// Mounted for demo@demo.com only (see app/(portal)/layout.tsx). Wraps the
// real portal children in the form-fill bridge and overlays scene content on
// top of them — the children themselves are never replaced or mocked, only
// navigated and (for the financing beat) filled via DemoFormBridge.
export function DemoConductor({ children }: { children: React.ReactNode }) {
  return (
    <DemoFormBridgeProvider>
      {children}
      <DemoRunner />
    </DemoFormBridgeProvider>
  )
}
