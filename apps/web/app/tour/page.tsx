'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TOUR_SCENES } from './tour-data'
import TitleScene from './scenes/TitleScene'
import DashboardScene from './scenes/DashboardScene'
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

function TourInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramScene = parseInt(searchParams.get('scene') ?? '0', 10)
  const initialIndex = Number.isFinite(paramScene) && paramScene >= 0 && paramScene < TOUR_SCENES.length ? paramScene : 0
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    router.replace(`/tour?scene=${index}`, { scroll: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const scene = TOUR_SCENES[index]!
  const isFirst = index === 0
  const isLast = index === TOUR_SCENES.length - 1
  const showChrome = scene.kind !== 'title' && scene.kind !== 'capstone'

  function next() {
    setIndex((i) => Math.min(i + 1, TOUR_SCENES.length - 1))
  }
  function back() {
    setIndex((i) => Math.max(i - 1, 0))
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--offwhite, #F7F7F5)', display: 'flex', flexDirection: 'column' }}>
      {showChrome && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'var(--white)',
            borderBottom: '1px solid var(--border)',
            padding: '14px 20px',
          }}
        >
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--ink)', flexShrink: 0 }}>
                Strike SCF
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)', flexShrink: 0 }}>·</span>
              <span
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12.5,
                  color: 'var(--gray)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {'sceneLabel' in scene ? scene.sceneLabel : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              {TOUR_SCENES.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setIndex(i)}
                  aria-label={`Go to scene ${i + 1}`}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    background: i === index ? 'var(--blue)' : 'var(--border-strong)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, padding: showChrome ? '40px 20px 100px' : '20px' }}>
        {scene.kind === 'title' && <TitleScene scene={scene} onNext={next} />}
        {scene.kind === 'dashboard' && <DashboardScene scene={scene} />}
        {scene.kind === 'gate' && <GateScene scene={scene} onNext={next} />}
        {scene.kind === 'negotiation' && <NegotiationSplitScene scene={scene} />}
        {scene.kind === 'room' && <RoomTranscriptScene scene={scene} />}
        {scene.kind === 'financing' && <FinancingScene scene={scene} />}
        {scene.kind === 'chat' && <ChatScene scene={scene} />}
        {scene.kind === 'capstone' && <CapstoneScene scene={scene} />}
      </div>

      {showChrome && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--white)',
            borderTop: '1px solid var(--border)',
            padding: '14px 20px',
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
              {index + 1} / {TOUR_SCENES.length}
            </span>
            <button
              onClick={next}
              disabled={isLast}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: isLast ? 'var(--border-strong)' : 'var(--blue)',
                border: 'none',
                borderRadius: 999,
                padding: '9px 20px',
                cursor: isLast ? 'default' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
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
