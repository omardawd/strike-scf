'use client'

interface RiskFlag {
  code: string
  label: string
  detail?: string
  severity: 'high' | 'medium' | 'low'
}

interface RiskBadgeProps {
  score?: number
  tier?: 'green' | 'amber' | 'red'
  flags?: RiskFlag[]
  size?: 'sm' | 'md'
  showScore?: boolean
}

const TIER_COLORS = {
  green: { bg: 'rgba(5,150,105,0.08)', border: 'rgba(5,150,105,0.3)', text: '#059669', dot: '#059669' },
  amber: { bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.3)',  text: '#D97706', dot: '#D97706' },
  red:   { bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.2)',  text: '#DC2626', dot: '#DC2626' },
}

export function RiskBadge({ score, tier, flags, size = 'md', showScore = false }: RiskBadgeProps) {
  if (!tier) return null

  const colors = TIER_COLORS[tier as keyof typeof TIER_COLORS]
  if (!colors) return null

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'sm' ? '3px 8px' : '5px 10px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'sm' ? 10 : 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: colors.text,
      }}>
        <div style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: colors.dot,
          flexShrink: 0,
        }} />
        {tier.toUpperCase()}
        {showScore && score !== undefined && ` · ${score}`}
      </div>

      {flags?.slice(0, 2).map(f => (
        <div
          key={f.code}
          style={{
            padding: '3px 8px',
            background: f.severity === 'high' ? 'rgba(220,38,38,0.06)' : 'var(--offwhite)',
            border: `1px solid ${f.severity === 'high' ? 'rgba(220,38,38,0.2)' : 'var(--border)'}`,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: f.severity === 'high' ? '#DC2626' : 'var(--gray)',
          }}
          title={f.detail}
        >
          ⚠ {f.label}
        </div>
      ))}

      {flags && flags.length > 2 && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--gray)',
          letterSpacing: '0.08em',
        }}>
          +{flags.length - 2}
        </div>
      )}
    </div>
  )
}
