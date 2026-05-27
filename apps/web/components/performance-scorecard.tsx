'use client'
import React, { useState, useEffect } from 'react'

const TIER = {
  preferred: {
    label: 'Preferred Supplier',
    color: '#059669',
    bg: 'rgba(5,150,105,0.06)',
    border: 'rgba(5,150,105,0.25)',
    desc: 'Eligible for priority financing, higher advance rates, and faster decisions.',
  },
  standard: {
    label: 'Standard',
    color: 'var(--gray)',
    bg: 'var(--offwhite)',
    border: 'var(--border)',
    desc: 'Build your track record to unlock Preferred status and better financing terms.',
  },
  under_review: {
    label: 'Under Review',
    color: '#DC2626',
    bg: 'rgba(220,38,38,0.04)',
    border: 'rgba(220,38,38,0.2)',
    desc: 'Performance requires attention. Resolve disputes and improve payment timing to restore Standard status.',
  },
}

interface PerformanceScorecardProps {
  orgId: string
  showRefresh?: boolean
}

export function PerformanceScorecard({ orgId, showRefresh }: PerformanceScorecardProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    fetch(`/api/performance/${orgId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [orgId])

  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--white)',
    }}>
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
        }}>Performance</span>
        {showRefresh && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={async () => {
              setLoading(true)
              const res = await fetch(`/api/performance/${orgId}`)
              if (res.ok) setData(await res.json())
              setLoading(false)
            }}
          >
            ↻ Refresh
          </button>
        )}
      </div>

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--gray)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '12px 0',
          }}>Calculating...</div>
        ) : !data ? (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--gray)',
            letterSpacing: '0.1em',
          }}>No performance data yet</div>
        ) : (
          <>
            {(() => {
              const tier = TIER[data.performance_tier as keyof typeof TIER] ?? TIER.standard
              return (
                <div style={{
                  padding: '12px 16px',
                  background: tier.bg,
                  border: `1px solid ${tier.border}`,
                  marginBottom: 16,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                  }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: tier.color,
                    }} />
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: tier.color,
                      fontWeight: 500,
                    }}>{tier.label}</span>
                    {data.performance_score !== null && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: tier.color,
                        marginLeft: 'auto',
                      }}>
                        {data.performance_score}/100
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: 'var(--gray)',
                    lineHeight: 1.5,
                  }}>{tier.desc}</div>
                </div>
              )
            })()}

            <div style={{
              display: 'grid',
              gap: '1px',
              background: 'var(--border)',
            }}>
              {([
                ['On-time rate', data.metrics.on_time_payment_rate !== null ? `${data.metrics.on_time_payment_rate}%` : '—'],
                ['Dispute rate', data.metrics.dispute_rate !== null ? `${data.metrics.dispute_rate}%` : '—'],
                ['Financing utilization', data.metrics.financing_utilization_rate !== null ? `${data.metrics.financing_utilization_rate}%` : '—'],
                ['Avg advance rate', data.metrics.avg_advance_rate !== null ? `${data.metrics.avg_advance_rate}%` : '—'],
                ['Total transactions', data.metrics.total_transactions],
                ['Total financed', data.metrics.total_financed > 0 ? `$${(data.metrics.total_financed / 1000).toFixed(0)}K` : '—'],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label} style={{
                  background: 'var(--white)',
                  padding: '9px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--gray)',
                  }}>{label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--ink)',
                  }}>{value}</span>
                </div>
              ))}
            </div>

            {data.performance_tier === 'preferred' && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(5,150,105,0.04)',
                border: '1px solid rgba(5,150,105,0.15)',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#059669',
                  marginBottom: 8,
                }}>Preferred benefits active</div>
                {[
                  '✓ Priority financing decisions (24hr)',
                  '✓ Higher advance rate eligibility',
                  '✓ Reduced collateral requirements',
                  '✓ Preferred visibility to funding partners',
                ].map(b => (
                  <div key={b} style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: '#059669',
                    marginBottom: 3,
                  }}>{b}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
