'use client'
import React, { useState, useEffect, useRef } from 'react'

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

function MarkdownContent({ text }: { text: string }) {
  if (!text) return null

  const paragraphs = text.split(/\n{2,}/)
  const nodes: React.ReactNode[] = []

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!.trim()
    if (!para) continue

    const lines = para.split('\n')
    const isListBlock = lines.every(l => /^[-•*]\s/.test(l.trim()) || l.trim() === '')

    // Heading lines: # ## ###
    const headingMatch = para.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const text = headingMatch[2]!
      const size = level === 1 ? 14.5 : level === 2 ? 13.5 : 13
      nodes.push(
        <div key={pi} style={{ fontSize: size, fontWeight: 700, color: 'var(--ink)', marginTop: pi > 0 ? 10 : 0, marginBottom: 2, lineHeight: 1.4 }}>
          {renderInline(text)}
        </div>
      )
      continue
    }

    if (isListBlock) {
      nodes.push(
        <ul key={pi} style={{ margin: '6px 0 6px 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lines.filter(l => l.trim()).map((l, li) => (
            <li key={li} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--blue)', fontSize: 10, marginTop: 3, flexShrink: 0 }}>▸</span>
              <span style={{ lineHeight: 1.55 }}>{renderInline(l.replace(/^[-•*]\s*/, ''))}</span>
            </li>
          ))}
        </ul>
      )
    } else {
      // Check for "Recommended action:" pattern — make it stand out
      if (/^\*?\*?recommended action:?\*?\*?/i.test(para)) {
        const actionText = para.replace(/^\*?\*?recommended action:?\*?\*?\s*/i, '')
        nodes.push(
          <div key={pi} style={{
            marginTop: 8, padding: '8px 12px',
            background: 'rgba(20,40,204,0.04)',
            border: '1px solid rgba(20,40,204,0.15)',
            borderLeft: '3px solid var(--blue)',
            fontSize: 12.5,
            lineHeight: 1.55,
          }}>
            <span style={{ fontWeight: 700, color: 'var(--blue)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
              Recommended Action
            </span>
            <span style={{ color: 'var(--ink)' }}>{renderInline(actionText)}</span>
          </div>
        )
      } else {
        nodes.push(
          <p key={pi} style={{ margin: '0 0 6px', lineHeight: 1.6 }}>
            {renderInline(para)}
          </p>
        )
      }
    }
  }

  return <>{nodes}</>
}

// ── Cycling loading messages ──────────────────────────────────────────────────

const LOADING_STEPS = [
  'Reading context data…',
  'Analyzing key metrics…',
  'Cross-referencing indicators…',
  'Synthesizing insight…',
  'Finalizing response…',
]

function LoadingState() {
  const [step, setStep] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    ref.current = setInterval(() => {
      setStep(s => (s + 1) % LOADING_STEPS.length)
    }, 1600)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--blue)',
              opacity: 0.3 + (step % 3 === i ? 0.7 : 0),
              transition: 'opacity 0.3s ease',
            }}
          />
        ))}
      </div>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 12,
        color: 'var(--blue)', letterSpacing: '0.01em',
        transition: 'opacity 0.3s ease',
      }}>
        {LOADING_STEPS[step]}
      </span>
    </div>
  )
}

// ── AIInsight ─────────────────────────────────────────────────────────────────

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
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchInsight() {
    setLoading(true)
    setFetched(true)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'insight',
          system: `You are Strike AI, an expert analytical assistant for Strike SCF. Provide clear, data-driven insights.

RULES:
1. Base ALL analysis on the context data provided. Never invent numbers or facts.
2. Keep it concise — 2–4 sentences, then one specific recommended action.
3. Use exact figures from the context data.
4. If data is empty or null, say what's missing and why it matters.
5. Structure your response with a clear insight, then a "Recommended action:" on a new line.
6. Use **bold** for key numbers or critical findings.`,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`,
          }],
          max_tokens: 320,
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
      border: '1px solid rgba(20,40,204,0.2)',
      background: 'rgba(20,40,204,0.02)',
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--blue)', animation: 'badge-pulse 2.4s infinite', flexShrink: 0,
        }} />
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--blue)', flex: 1,
        }}>
          Strike AI · {title ?? 'Insight'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--blue)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(20,40,204,0.1)' }}>
          {loading ? (
            <LoadingState />
          ) : (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', paddingTop: 10 }}>
              <MarkdownContent text={insight} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
