'use client'
import { useState, useEffect } from 'react'

const PRIORITY_STYLES: Record<string, { border: string; bg: string; dot: string; label: string }> = {
  high: {
    border: 'rgba(220,38,38,0.3)',
    bg: 'rgba(220,38,38,0.03)',
    dot: '#DC2626',
    label: 'HIGH',
  },
  medium: {
    border: 'rgba(217,119,6,0.3)',
    bg: 'rgba(217,119,6,0.03)',
    dot: '#D97706',
    label: 'MED',
  },
  low: {
    border: 'var(--border)',
    bg: 'var(--white)',
    dot: 'var(--gray)',
    label: 'LOW',
  },
}

export function RecommendationsPanel({ bankId: _bankId, maxItems }: { bankId: string; maxItems?: number }) {
  const [recs, setRecs] = useState<any[]>([])
  const [counts, setCounts] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch('/api/recommendations')
      .then(r => r.json())
      .then(d => {
        setRecs(d.recommendations ?? [])
        setCounts(d.counts ?? {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleGenerate() {
    setGenerating(true)
    await fetch('/api/recommendations/generate', { method: 'POST' })
    const res = await fetch('/api/recommendations')
    const data = await res.json()
    setRecs(data.recommendations ?? [])
    setCounts(data.counts ?? {})
    setGenerating(false)
  }

  async function handleDismiss(id: string) {
    await fetch(`/api/recommendations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    })
    setRecs(prev => prev.filter(r => r.id !== id))
    setCounts((prev: any) => ({
      ...prev,
      total: Math.max(0, (prev.total ?? 1) - 1),
    }))
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--white)',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: counts.high > 0 ? '#DC2626' : 'var(--gray)',
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
          }}>
            Actions Required{counts.total > 0 && ` · ${counts.total}`}
          </span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Analyzing...' : '↻ Refresh'}
        </button>
      </div>

      {loading ? (
        <div style={{
          padding: '20px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--gray)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          Loading...
        </div>
      ) : recs.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}>
            No actions required
          </div>
        </div>
      ) : (
        (maxItems ? recs.slice(0, maxItems) : recs).map(rec => {
          const style = PRIORITY_STYLES[rec.priority] ?? PRIORITY_STYLES.low
          return (
            <div key={rec.id} style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              borderLeft: `3px solid ${style.dot}`,
              background: style.bg,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 6,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: style.dot,
                    }}>{style.label}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--gray)',
                    }}>{rec.category}</span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--ink)',
                    marginBottom: 4,
                  }}>{rec.title}</div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: 'var(--gray)',
                    lineHeight: 1.5,
                  }}>{rec.body}</div>
                  {rec.estimated_impact && (
                    <div style={{
                      marginTop: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--blue)',
                    }}>
                      → {rec.estimated_impact}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDismiss(rec.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--gray)',
                    fontSize: 14,
                    padding: '0 0 0 8px',
                    flexShrink: 0,
                  }}
                >×</button>
              </div>
              {rec.action_label && rec.action_url && (
                <a
                  href={rec.action_url}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--blue)',
                    textDecoration: 'none',
                    marginTop: 8,
                  }}
                >
                  {rec.action_label} →
                </a>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
