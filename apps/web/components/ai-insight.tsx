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
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feature: 'insight',
          system: `You are Strike AI, an analytical assistant for Strike SCF. You provide brief, data-driven insights.

CRITICAL RULES:
1. Base ALL analysis on the context data provided. Never invent numbers, names, or facts.
2. Be concise — maximum 3 sentences.
3. End with one specific recommended action.
4. Use exact figures from the context data.
5. If context data is empty or null, say "Insufficient data for analysis."

Format: [Assessment]. [Supporting data point]. [Recommended action].`,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`,
          }],
          max_tokens: 256,
        }),
      })
      if (res.status === 429) {
        setInsight('Daily AI limit reached. Resets at midnight UTC.')
        setLoading(false)
        return
      }
      const data = await res.json()
      setInsight(data.content?.[0]?.text ?? '')
    } catch {
      setInsight('Unable to generate insight.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      border: '1px solid rgba(20,40,204,0.22)',
      background: 'rgba(20,40,204,0.02)',
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden',
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
          borderTop: '1px solid rgba(20,40,204,0.1)',
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
