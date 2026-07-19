import { useEffect, useRef, useState } from 'react'
import type { NegotiationRound, TourScene } from '../tour-data'

const ROUND_INTERVAL_MS = 2600

function RoundRow({ round, prev, currency, highlight }: { round: NegotiationRound; prev: NegotiationRound | null; currency: string; highlight: boolean }) {
  const delta = prev ? round.price - prev.price : null
  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
        opacity: highlight ? 1 : 0.65,
        transition: 'opacity 300ms',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
          Round {round.round} — {round.isYou ? 'You' : round.byOrgName}
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          {round.price.toLocaleString()} {currency}
          {delta != null && (
            <span style={{ fontSize: 10.5, fontWeight: 600, marginLeft: 6, color: delta < 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
              {delta < 0 ? '▼' : '▲'} {Math.abs(delta).toLocaleString()}
            </span>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={pillStyle}>{round.incoterms}</span>
        <span style={pillStyle}>{round.paymentTerms}</span>
        {round.shippingCost != null && <span style={pillStyle}>Shipping: {round.shippingCost.toLocaleString()}</span>}
      </div>
      {highlight && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--gray)', marginTop: 6, lineHeight: 1.5 }}>
          {round.reasoning}
        </div>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 10.5,
  color: 'var(--gray)',
  background: 'var(--offwhite)',
  borderRadius: 999,
  padding: '2px 8px',
}

function Panel({
  label,
  rounds,
  visibleCount,
  currency,
  isTyping,
}: {
  label: string
  rounds: NegotiationRound[]
  visibleCount: number
  currency: string
  isTyping: boolean
}) {
  const visible = rounds.slice(0, visibleCount)
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--white)',
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-green)' }} />
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>
          {label}
        </span>
      </div>
      {visible.map((r, i) => (
        <RoundRow key={r.round} round={r} prev={i > 0 ? visible[i - 1]! : null} currency={currency} highlight={i === visible.length - 1} />
      ))}
      {isTyping && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--gray)', marginTop: 8, fontStyle: 'italic' }}>
          Thinking through the next counter…
        </div>
      )}
    </div>
  )
}

export default function NegotiationSplitScene({
  scene,
  onProgress,
}: {
  scene: Extract<TourScene, { kind: 'negotiation' }>
  onProgress: (info: { done: boolean }) => void
}) {
  const total = scene.rounds.length
  const [visibleCount, setVisibleCount] = useState(total > 0 ? 1 : 0)
  const [msLeft, setMsLeft] = useState(ROUND_INTERVAL_MS)
  const nextAtRef = useRef<number>(Date.now() + ROUND_INTERVAL_MS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setVisibleCount(total > 0 ? 1 : 0)
    nextAtRef.current = Date.now() + ROUND_INTERVAL_MS

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setVisibleCount((c) => {
        if (c >= total) {
          if (timerRef.current) clearInterval(timerRef.current)
          return c
        }
        nextAtRef.current = Date.now() + ROUND_INTERVAL_MS
        return c + 1
      })
    }, ROUND_INTERVAL_MS)

    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => {
      setMsLeft(Math.max(0, nextAtRef.current - Date.now()))
    }, 200)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.rounds])

  const done = visibleCount >= total
  useEffect(() => {
    onProgress({ done })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  function skipAhead() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    setVisibleCount(total)
  }

  const nextRound = scene.rounds[visibleCount]
  const buyerTyping = !!nextRound && scene.buyerName === nextRound.byOrgName
  const supplierTyping = !!nextRound && scene.supplierName === nextRound.byOrgName

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <style>{'@keyframes tourLivePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.75); } } .tour-live-dot { animation: tourLivePulse 1.1s ease-in-out infinite; }'}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--gray)' }}>{scene.listingTitle}</div>
        {!done ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="tour-live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-red)' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-red)' }}>
                Live
              </span>
            </span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>
              Round {visibleCount} of {total} · next in {Math.ceil(msLeft / 1000)}s
            </span>
            <button
              onClick={skipAhead}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--blue)',
                background: 'var(--blue-light)',
                border: 'none',
                borderRadius: 999,
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Skip ahead
            </button>
          </div>
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-green)',
              background: '#EDFAF4',
              borderRadius: 999,
              padding: '4px 10px',
            }}
          >
            Settled — Round {total}
          </span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray-soft, var(--gray))', marginBottom: 16 }}>
        Two agents, negotiating on their own — each side is a separate org, watching the same live thread.
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Panel label={`${scene.buyerName}'s Agent`} rounds={scene.rounds} visibleCount={visibleCount} currency={scene.currency} isTyping={buyerTyping} />
        <Panel label={`${scene.supplierName}'s Agent`} rounds={scene.rounds} visibleCount={visibleCount} currency={scene.currency} isTyping={supplierTyping} />
      </div>
    </div>
  )
}
