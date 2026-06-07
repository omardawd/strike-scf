'use client'
import React from 'react'

type RingSize = 'sm' | 'md' | 'lg'

const DIM:    Record<RingSize, number> = { sm: 48, md: 80, lg: 120 }
const STROKE: Record<RingSize, number> = { sm: 4,  md: 6,  lg: 8 }
const NUM:    Record<RingSize, number> = { sm: 15, md: 24, lg: 38 }
const LABEL:  Record<RingSize, number> = { sm: 8,  md: 9,  lg: 10 }

// PassportScore colour bands — same thresholds the platform uses for the
// green / amber / red display tier.
function ringColor(score: number): string {
  if (score >= 70) return '#059669' // green
  if (score >= 45) return '#D97706' // amber
  return '#DC2626'                  // red
}

// The arc spans ~270° of the circle, leaving a 90° gap centred at the bottom.
// Using pathLength=100 lets us express everything in simple "out of 100" units.
const ARC = 75

export function PassportScoreRing({
  score,
  size = 'md',
  showLabel = false,
}: {
  score: number | null | undefined
  size?: RingSize
  showLabel?: boolean
}) {
  const dim    = DIM[size]
  const stroke = STROKE[size]
  const center = dim / 2
  const r      = center - stroke / 2 - 1

  const hasScore = typeof score === 'number' && Number.isFinite(score)
  const clamped  = hasScore ? Math.max(0, Math.min(100, score as number)) : 0
  const fillLen  = (ARC * clamped) / 100
  const color    = ringColor(clamped)
  const isLg     = size === 'lg'

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: isLg ? 8 : 4 }}>
      <div style={{ position: 'relative', width: dim, height: dim }}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ display: 'block' }} aria-hidden="true">
          {/* Background track — adapts to light/dark via --border */}
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${ARC} 100`}
            transform={`rotate(135 ${center} ${center})`}
          />
          {/* Score fill — grows clockwise from bottom-left toward bottom-right */}
          {hasScore && clamped > 0 && (
            <circle
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${fillLen} 100`}
              transform={`rotate(135 ${center} ${center})`}
              style={{ transition: 'stroke-dasharray 600ms ease' }}
            />
          )}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: NUM[size],
              lineHeight: 1,
              letterSpacing: '-0.02em',
              // Gold on the large variant only; ink elsewhere so it stays
              // legible on the small/medium chips in both themes.
              color: isLg ? '#C9A84C' : 'var(--ink)',
            }}
          >
            {hasScore ? Math.round(clamped) : '—'}
          </span>
        </div>
      </div>
      {showLabel && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: LABEL[size],
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          PassportScore™
        </span>
      )}
    </div>
  )
}
