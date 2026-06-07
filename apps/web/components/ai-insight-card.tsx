'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

  // Floating dismiss persists per session
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

    // Cache key: hash of page + JSON.stringify(context)
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
            sessionStorage.setItem(cacheKey, JSON.stringify({
              data,
              expiry: Date.now() + 5 * 60 * 1000, // 5 min TTL
            }))
          } catch {}
        }
      })
      .catch(() => {}) // silent fail — no broken UI
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [page, portal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Floating slide-in after 1000ms
  useEffect(() => {
    if (variant !== 'floating' || dismissed) return
    const t = setTimeout(() => setVisible(true), 1000)
    return () => clearTimeout(t)
  }, [variant, dismissed])

  function runAction(action: InsightAction) {
    if (action.href) {
      router.push(action.href)
    } else if (action.prompt) {
      window.dispatchEvent(new CustomEvent('strike-ai-prompt', { detail: { prompt: action.prompt } }))
    }
  }

  function dismissFloating() {
    setDismissed(true)
    try { sessionStorage.setItem(dismissKey, '1') } catch {}
  }

  const shimmer = (
    <>
      <style>{`@keyframes strike-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{
        height: variant === 'banner' ? 48 : variant === 'compact' ? 56 : 80,
        borderRadius: variant === 'banner' ? 8 : variant === 'compact' ? 12 : 16,
        background: 'linear-gradient(90deg, var(--border) 25%, var(--offwhite) 50%, var(--border) 75%)',
        backgroundSize: '200% 100%',
        animation: 'strike-shimmer 1.5s infinite',
      }} />
    </>
  )

  if (dismissed) return null

  // ── BANNER ──
  if (variant === 'banner') {
    if (loading) return shimmer
    if (!insight) return null
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        background: 'var(--color-accent-light)',
        borderLeft: '3px solid var(--blue)',
        borderRadius: 8,
        padding: '14px 18px',
      }}>
        <div style={{
          width: 28, height: 28, flexShrink: 0, borderRadius: '50%',
          background: 'var(--blue)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
        }}>S</div>
        <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', lineHeight: 1.45 }}>
          {insight.insight}
        </div>
        {insight.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {insight.actions.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => runAction(a)}
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  border: '1px solid var(--blue)', background: 'transparent',
                  color: 'var(--blue)', fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                }}
              >
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
    if (loading) return shimmer
    if (!insight) return null
    return (
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
      }}>
        <div style={{
          fontSize: 13, color: 'var(--ink)', lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {insight.insight}
        </div>
        <button
          type="button"
          onClick={() => {
            const promptAction = insight.actions.find(a => a.prompt)
            if (promptAction) runAction(promptAction)
            else window.dispatchEvent(new CustomEvent('strike-ai-prompt', { detail: { prompt: insight.insight } }))
          }}
          style={{
            marginTop: 8, background: 'none', border: 'none', padding: 0,
            color: 'var(--blue)', fontSize: 12, cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
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
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 320, zIndex: 170,
      background: 'var(--white)', boxShadow: 'var(--shadow-elevated)',
      borderRadius: 16, padding: 16,
      transform: visible ? 'translateY(0)' : 'translateY(20px)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.3s ease, opacity 0.3s ease',
    }}>
      <button
        type="button"
        onClick={dismissFloating}
        aria-label="Dismiss"
        style={{
          position: 'absolute', top: 10, right: 12,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--gray)', fontSize: 18, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', background: 'var(--blue)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11,
        }}>S</div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Strike AI</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, paddingRight: 8 }}>
        {insight.insight}
      </div>
      {firstAction && (
        <button
          type="button"
          onClick={() => runAction(firstAction)}
          style={{
            marginTop: 12, padding: '6px 12px', borderRadius: 999,
            border: '1px solid var(--blue)', background: 'transparent',
            color: 'var(--blue)', fontSize: 12, cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          {firstAction.label}
        </button>
      )}
    </div>
  )
}
