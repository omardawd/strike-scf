'use client'
import React, { useState, useEffect } from 'react'

interface AIInsightProps {
  prompt: string
  context: object
  title?: string
  collapsed?: boolean
}

export function AIInsight({ prompt, context, title, collapsed }: AIInsightProps) {
  const [insight, setInsight] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(!collapsed)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (expanded && !fetched && !insight) {
      fetchInsight()
    }
  }, [expanded])

  async function fetchInsight() {
    setLoading(true)
    setFetched(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          system: `You are an AI analyst for Strike SCF, a supply chain finance platform. Provide brief, actionable insights. Be concise — max 3 sentences. Focus on risk, opportunity, or recommended action. Use financial terminology appropriately.`,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`,
          }],
        }),
      })
      const data = await res.json()
      setInsight(data.content?.[0]?.text ?? '')
    } catch {
      setInsight('Unable to generate insight.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      border: '1px solid rgba(0,82,255,0.22)',
      background: 'rgba(0,82,255,0.02)',
      marginBottom: 12,
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 5, height: 5,
          borderRadius: '50%',
          background: 'var(--blue)',
          animation: 'badge-pulse 2.4s infinite',
          flexShrink: 0,
        }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          flex: 1,
        }}>
          {title ?? 'AI Insight'}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--blue)',
        }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div style={{
          padding: '0 14px 12px',
          borderTop: '1px solid rgba(0,82,255,0.1)',
        }}>
          {loading ? (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--blue)',
              letterSpacing: '0.1em',
              padding: '8px 0',
            }}>
              Analyzing...
            </div>
          ) : (
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: 'var(--ink)',
              lineHeight: 1.6,
              paddingTop: 10,
            }}>
              {insight}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
