import { useEffect, useRef, useState } from 'react'
import type { NegotiationRound, TourScene } from '../tour-data'

const ROUND_INTERVAL_MS = 2400

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

export default function NegotiationSplitScene({ scene }: { scene: Extract<TourScene, { kind: 'negotiation' }> }) {
  const [visibleCount, setVisibleCount] = useState(scene.rounds.length > 0 ? 1 : 0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setVisibleCount(scene.rounds.length > 0 ? 1 : 0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setVisibleCount((c) => {
        if (c >= scene.rounds.length) {
          if (timerRef.current) clearInterval(timerRef.current)
          return c
        }
        return c + 1
      })
    }, ROUND_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [scene.rounds])

  const nextRound = scene.rounds[visibleCount]
  const buyerTyping = !!nextRound && scene.buyerName === nextRound.byOrgName
  const supplierTyping = !!nextRound && scene.supplierName === nextRound.byOrgName

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--gray)', marginBottom: 4 }}>
        {scene.listingTitle}
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
