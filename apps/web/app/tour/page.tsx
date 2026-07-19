'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TOUR_SCENES } from './tour-data'
import TourSidebar from './TourSidebar'
import TourGuide from './TourGuide'
import TitleScene from './scenes/TitleScene'
import DashboardScene from './scenes/DashboardScene'
import ErpScene from './scenes/ErpScene'
import GateScene from './scenes/GateScene'
import NegotiationSplitScene from './scenes/NegotiationSplitScene'
import RoomTranscriptScene from './scenes/RoomTranscriptScene'
import FinancingScene from './scenes/FinancingScene'
import ChatScene from './scenes/ChatScene'
import CapstoneScene from './scenes/CapstoneScene'

// Public, unauthenticated, fully static walkthrough — no API calls, no
// Supabase client, no auth. Deliberately outside (portal)/(onboarding) so
// middleware.ts's login-redirect allowlist never touches it. Content lives
// entirely in tour-data.ts; this file only owns scene navigation/chrome.
// TourSidebar is a visual clone of the real sidebar (not the real component
// — its links point at auth-gated routes, which would bounce an anonymous
// visitor to /login mid-tour), reusing the same portal-agnostic CSS classes
// from app/globals.css so it reads as a genuine screen, not a slideshow.

function TourInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramScene = parseInt(searchParams.get('scene') ?? '0', 10)
  const initialIndex = Number.isFinite(paramScene) && paramScene >= 0 && paramScene < TOUR_SCENES.length ? paramScene : 0
  const [index, setIndex] = useState(initialIndex)
  const [negotiationDone, setNegotiationDone] = useState(false)

  useEffect(() => {
    router.replace(`/tour?scene=${index}`, { scroll: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const scene = TOUR_SCENES[index]!
  const isFirst = index === 0
  const isLast = index === TOUR_SCENES.length - 1
  const isChromeless = scene.kind === 'title' || scene.kind === 'capstone'
  const waitingOnNegotiation = scene.kind === 'negotiation' && !negotiationDone

  function next() {
    setIndex((i) => Math.min(i + 1, TOUR_SCENES.length - 1))
  }
  function back() {
    setIndex((i) => Math.max(i - 1, 0))
  }
  function goToSceneId(sceneId: string) {
    const i = TOUR_SCENES.findIndex((s) => s.id === sceneId)
    if (i >= 0) setIndex(i)
  }

  const sceneBody = (
    <>
      {scene.kind === 'title' && <TitleScene scene={scene} onNext={next} />}
      {scene.kind === 'dashboard' && <DashboardScene scene={scene} />}
      {scene.kind === 'erp' && <ErpScene scene={scene} />}
      {scene.kind === 'gate' && <GateScene scene={scene} onNext={next} />}
      {scene.kind === 'negotiation' && (
        <NegotiationSplitScene scene={scene} onProgress={({ done }) => setNegotiationDone(done)} />
      )}
      {scene.kind === 'room' && <RoomTranscriptScene scene={scene} />}
      {scene.kind === 'financing' && <FinancingScene scene={scene} />}
      {scene.kind === 'chat' && <ChatScene scene={scene} />}
      {scene.kind === 'capstone' && <CapstoneScene scene={scene} />}
    </>
  )

  if (isChromeless) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--offwhite, #F7F7F5)' }}>
        {sceneBody}
        <TourGuide guide={scene.guide} sceneKey={scene.id} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <style>{'@media (max-width: 760px) { .app-shell { grid-template-columns: 1fr !important; } .app-shell > aside.sidebar { display: none; } }'}</style>
      <TourSidebar activeSceneId={scene.id} onNavigate={goToSceneId} />
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div style={{ flex: 1, padding: '32px 24px 100px' }}>{sceneBody}</div>

        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--white)',
            borderTop: '1px solid var(--border)',
            padding: '14px 24px',
          }}
        >
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={back}
              disabled={isFirst}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: isFirst ? 'var(--border-strong)' : 'var(--ink)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: '9px 18px',
                cursor: isFirst ? 'default' : 'pointer',
              }}
            >
              Back
            </button>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>
              {waitingOnNegotiation ? 'Watching negotiation live…' : `${index + 1} / ${TOUR_SCENES.length}`}
            </span>
            <button
              onClick={next}
              disabled={isLast || waitingOnNegotiation}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: isLast || waitingOnNegotiation ? 'var(--border-strong)' : 'var(--blue)',
                border: 'none',
                borderRadius: 999,
                padding: '9px 20px',
                cursor: isLast || waitingOnNegotiation ? 'default' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <TourGuide guide={scene.guide} sceneKey={scene.id} />
    </div>
  )
}

export default function TourPage() {
  return (
    <Suspense fallback={null}>
      <TourInner />
    </Suspense>
  )
}
