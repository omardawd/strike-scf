'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

function MarkdownContent({ text, clamp }: { text: string; clamp?: number }) {
  if (!text) return null

  const paragraphs = text.split(/\n{2,}/)
  const nodes: React.ReactNode[] = []

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!.trim()
    if (!para) continue

    const lines = para.split('\n')
    const isListBlock = lines.every(l => /^[-•*]\s/.test(l.trim()) || l.trim() === '')

    if (isListBlock) {
      nodes.push(
        <ul key={pi} style={{ margin: '5px 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lines.filter(l => l.trim()).map((l, li) => (
            <li key={li} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--blue)', fontSize: 10, marginTop: 3, flexShrink: 0 }}>▸</span>
              <span style={{ lineHeight: 1.5 }}>{renderInline(l.replace(/^[-•*]\s*/, ''))}</span>
            </li>
          ))}
        </ul>
      )
    } else if (/^\*?\*?recommended action:?\*?\*?/i.test(para)) {
      const actionText = para.replace(/^\*?\*?recommended action:?\*?\*?\s*/i, '')
      nodes.push(
        <div key={pi} style={{
          marginTop: 8, padding: '7px 10px',
          background: 'rgba(20,40,204,0.04)',
          borderLeft: '2px solid var(--blue)',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 700, color: 'var(--blue)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>
            Action
          </span>
          <span style={{ color: 'var(--ink)' }}>{renderInline(actionText)}</span>
        </div>
      )
    } else {
      nodes.push(
        <p key={pi} style={{ margin: '0 0 5px', lineHeight: 1.55 }}>
          {renderInline(para)}
        </p>
      )
    }
  }

  if (clamp && nodes.length > clamp) {
    return <>{nodes.slice(0, clamp)}</>
  }

  return <>{nodes}</>
}

// ── Cycling loading messages ──────────────────────────────────────────────────

const LOADING_STEPS = [
  'Reading context data…',
  'Analyzing key metrics…',
  'Cross-referencing indicators…',
  'Synthesizing insight…',
]

function LoadingShimmer({ variant }: { variant: 'banner' | 'compact' | 'floating' }) {
  const [step, setStep] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    ref.current = setInterval(() => {
      setStep(s => (s + 1) % LOADING_STEPS.length)
    }, 1800)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [])

  if (variant === 'banner') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: 'var(--color-accent-light)', borderLeft: '3px solid var(--blue)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>S</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', opacity: step % 3 === i ? 1 : 0.3, transition: 'opacity 0.3s' }} />)}
          </div>
          <span style={{ fontSize: 13, color: 'var(--blue)' }}>{LOADING_STEPS[step]}</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0' }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0,1,2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--blue)', opacity: step % 3 === i ? 1 : 0.3, transition: 'opacity 0.3s' }} />)}
      </div>
      <span style={{ fontSize: 12, color: 'var(--blue)' }}>{LOADING_STEPS[step]}</span>
    </div>
  )
}

// ── AIInsightCard ─────────────────────────────────────────────────────────────

interface InsightAction {
  label: string
  href?: string
  prompt?: string
}

interface InsightData {
  insight: string
  actions: InsightAction[]
}

interface AIInsightCardProps {
  context: Record<string, unknown>
  portal: string
  page: string
  variant?: 'banner' | 'compact' | 'floating'
}

function isInsightData(v: unknown): v is InsightData {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.insight === 'string'
}

export function AIInsightCard({ context, portal, page, variant = 'banner' }: AIInsightCardProps) {
  const router = useRouter()
  const [insight, setInsight] = useState<InsightData | null>(null)
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(variant !== 'floating')
  const [dismissed, setDismissed] = useState(false)

  const dismissKey = `strike-ai-insight-dismissed-${page}`

  useEffect(() => {
    if (variant === 'floating') {
      try {
        if (sessionStorage.getItem(dismissKey) === '1') {
          setDismissed(true)
          return
        }
      } catch {}
    }

    let active = true
    let cacheKey = `strike-ai-insight-${page}`
    try {
      cacheKey = `strike-ai-insight-${page}-${btoa(unescape(encodeURIComponent(JSON.stringify(context)))).slice(0, 32)}`
    } catch {}

    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as { data: unknown; expiry: number }
        if (Date.now() < parsed.expiry && isInsightData(parsed.data)) {
          setInsight(parsed.data)
          setLoading(false)
          return
        }
      }
    } catch {}

    fetch('/api/ai/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, portal, data: context }),
    })
      .then(r => r.json())
      .then((data: unknown) => {
        if (!active) return
        if (isInsightData(data)) {
          setInsight(data)
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data, expiry: Date.now() + 5 * 60 * 1000 }))
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [page, portal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (variant !== 'floating' || dismissed) return
    const t = setTimeout(() => setVisible(true), 1000)
    return () => clearTimeout(t)
  }, [variant, dismissed])

  function runAction(action: InsightAction) {
    if (action.href) router.push(action.href)
    else if (action.prompt) window.dispatchEvent(new CustomEvent('strike-ai-prompt', { detail: { prompt: action.prompt } }))
  }

  function dismissFloating() {
    setDismissed(true)
    try { sessionStorage.setItem(dismissKey, '1') } catch {}
  }

  if (dismissed) return null

  // ── BANNER ──
  if (variant === 'banner') {
    if (loading) return <LoadingShimmer variant="banner" />
    if (!insight) return null
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, width: '100%', background: 'var(--color-accent-light)', borderLeft: '3px solid var(--blue)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>S</div>
        <div style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55 }}>
          <MarkdownContent text={insight.insight} />
        </div>
        {insight.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 2 }}>
            {insight.actions.map((a, i) => (
              <button key={i} type="button" onClick={() => runAction(a)}
                style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── COMPACT ──
  if (variant === 'compact') {
    if (loading) return (
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
        <LoadingShimmer variant="compact" />
      </div>
    )
    if (!insight) return null
    return (
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
          <MarkdownContent text={insight.insight} clamp={2} />
        </div>
        <button
          type="button"
          onClick={() => {
            const promptAction = insight.actions.find(a => a.prompt)
            if (promptAction) runAction(promptAction)
            else window.dispatchEvent(new CustomEvent('strike-ai-prompt', { detail: { prompt: insight.insight } }))
          }}
          style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
        >
          Ask AI →
        </button>
      </div>
    )
  }

  // ── FLOATING ──
  if (loading || !insight) return null
  const firstAction = insight.actions[0]
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, width: 320, zIndex: 170, background: 'var(--white)', boxShadow: 'var(--shadow-elevated)', borderRadius: 16, padding: 16, transform: visible ? 'translateY(0)' : 'translateY(20px)', opacity: visible ? 1 : 0, transition: 'transform 0.3s ease, opacity 0.3s ease' }}>
      <button type="button" onClick={dismissFloating} aria-label="Dismiss"
        style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 18, lineHeight: 1, padding: 0 }}>
        ×
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11 }}>S</div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Strike AI</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, paddingRight: 8 }}>
        <MarkdownContent text={insight.insight} />
      </div>
      {firstAction && (
        <button type="button" onClick={() => runAction(firstAction)}
          style={{ marginTop: 12, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
          {firstAction.label}
        </button>
      )}
    </div>
  )
}
