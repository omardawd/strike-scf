'use client'
// Shared AI-assisted document editor (RFx drafting/evaluation, invoice drafting/evaluation).
// Used by:
//   - Strike Place "Draft RFx Now" / "Draft Invoice" (marketplace/listings/new)
//   - Deal contract submission "Draft & Refine with AI" (ActionPanel/FinancingManagementCard)
// Opens straight into an empty document — the AI only drafts on request, and
// the user can just as well start typing or upload their own document. Every
// path (generate / upload / type) converges on the same score/highlight/edit/
// finalize loop. Finalize returns a `document_id` compatible with the existing
// contract_document_id flow — it never sends/submits anything itself, the
// caller's own preview/send gate does.
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'

export interface RfxContext {
  title?: string
  description?: string
  category?: string
  currency?: string
  incoterms?: string
  delivery_location?: string
  delivery_deadline?: string
  payment_terms?: string
  line_items?: Array<{ name: string; description?: string; quantity?: number; unit?: string; unit_price?: number; currency?: string }>
  buyer_name?: string
  supplier_name?: string
  goods_description?: string
}

interface RfxHighlight {
  quote: string
  section: string
  severity: 'info' | 'warning' | 'critical'
  issue: string
  suggestion: string
}

interface RfxScoreState {
  overall_score: number | null
  section_scores: Record<string, number> | null
  highlights: RfxHighlight[]
  price_assessment: { verdict: string | null; delta_from_platform_avg_pct: number | null; summary: string } | null
  ai_scored: boolean
}

const EMPTY_SCORE: RfxScoreState = { overall_score: null, section_scores: null, highlights: [], price_assessment: null, ai_scored: false }

const SEVERITY_COLOR: Record<string, string> = {
  info: 'var(--gray)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
}
const SEVERITY_BG: Record<string, string> = {
  info: 'rgba(107,114,128,0.14)',
  warning: 'rgba(245,158,11,0.22)',
  critical: 'rgba(239,68,68,0.20)',
}

const DOC_LABEL: Record<'rfx' | 'invoice', { name: string; placeholder: string; icon: string }> = {
  rfx: { name: 'RFx Draft', placeholder: 'Empty draft. Click "Generate with AI" to draft an RFx from your listing details, upload one you already have, or just start typing below.', icon: '📄' },
  invoice: { name: 'Invoice Draft', placeholder: 'Empty draft. Click "Generate with AI" to draft an invoice from your listing details, upload one you already have, or just start typing below.', icon: '🧾' },
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--gray)' }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 999, background: value >= 70 ? 'var(--color-green)' : value >= 40 ? 'var(--color-amber)' : 'var(--color-red)' }} />
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Best-effort locate `quote` inside `content` — exact match first, then a
 * whitespace-normalized match, then just the first few words. The AI's quote
 * is meant to be verbatim but isn't always byte-for-byte (markdown/whitespace
 * differences), so a plain indexOf alone silently misses too often. */
function findQuoteRange(content: string, quote: string): { start: number; end: number } | null {
  if (!quote) return null

  const exact = content.indexOf(quote)
  if (exact !== -1) return { start: exact, end: exact + quote.length }

  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
  const normalizedQuote = normalize(quote)
  const normalizedContent = normalize(content)
  const normIdx = normalizedContent.indexOf(normalizedQuote)
  if (normIdx !== -1) {
    // Map the normalized index back onto the real string by walking through
    // content, collapsing consecutive whitespace the same way normalize() did.
    let realStart = -1
    let normCount = 0
    let lastWasSpace = false
    for (let i = 0; i < content.length; i++) {
      const isSpace = /\s/.test(content.charAt(i))
      const counted = !(isSpace && lastWasSpace)
      if (counted) {
        if (normCount === normIdx) realStart = i
        if (normCount === normIdx + normalizedQuote.length) return { start: realStart, end: i }
        normCount++
      }
      lastWasSpace = isSpace
    }
    if (realStart !== -1) return { start: realStart, end: content.length }
  }

  const firstWords = quote.split(/\s+/).slice(0, 5).join(' ')
  if (firstWords.length >= 8) {
    const idx = content.indexOf(firstWords)
    if (idx !== -1) return { start: idx, end: idx + firstWords.length }
  }
  return null
}

export function RfxEditor({
  entityType,
  entityId,
  context,
  docType = 'rfx',
  onFinalize,
  onCancel,
}: {
  entityType: 'listing' | 'deal'
  entityId?: string
  context: RfxContext
  docType?: 'rfx' | 'invoice'
  // documentId is set once the draft has actually been attached (entityId was
  // known at finalize time). If entityId is still unknown (e.g. drafting an
  // RFx before its listing exists), documentId is omitted — the caller should
  // attach the draft itself later via POST /api/ai/rfx/{draftId}/attach once
  // the entity exists, then pass its own entity_id in that call's body.
  onFinalize: (draftId: string, content: string, documentId?: string) => void
  onCancel: () => void
}) {
  const [draftId, setDraftId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [score, setScore] = useState<RfxScoreState>(EMPTY_SCORE)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftIdRef = useRef<string | null>(null)
  draftIdRef.current = draftId

  const label = DOC_LABEL[docType]

  async function generate() {
    setError(null)
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/rfx/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, context, doc_type: docType }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Generation failed'); return }
      setDraftId(json.draft_id)
      setContent(json.content ?? '')
      setScore({ overall_score: json.overall_score, section_scores: json.section_scores, highlights: json.highlights ?? [], price_assessment: json.price_assessment, ai_scored: json.ai_scored })
    } catch {
      setError(`Failed to generate ${label.name.toLowerCase()}`)
    } finally {
      setGenerating(false)
    }
  }

  async function evaluateUpload(file: File) {
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('entity_type', entityType)
      fd.append('doc_type', docType)
      if (entityId) fd.append('entity_id', entityId)
      const res = await fetch('/api/ai/rfx/evaluate', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Evaluation failed'); return }
      setDraftId(json.draft_id)
      setContent(json.content ?? '')
      setScore({ overall_score: json.overall_score, section_scores: json.section_scores, highlights: json.highlights ?? [], price_assessment: json.price_assessment, ai_scored: json.ai_scored })
    } catch {
      setError('Failed to evaluate uploaded document')
    } finally {
      setUploading(false)
    }
  }

  const rescore = useCallback(async (nextContent: string) => {
    if (!nextContent.trim()) return
    setScoring(true)
    try {
      const res = await fetch('/api/ai/rfx/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftIdRef.current
          ? { draft_id: draftIdRef.current, content: nextContent, doc_type: docType }
          : { entity_type: entityType, entity_id: entityId, content: nextContent, doc_type: docType }),
      })
      const json = await res.json()
      if (res.ok) {
        if (!draftIdRef.current && json.draft_id) setDraftId(json.draft_id)
        setScore({ overall_score: json.overall_score, section_scores: json.section_scores, highlights: json.highlights ?? [], price_assessment: json.price_assessment, ai_scored: json.ai_scored })
      }
    } catch {
      // silent — re-score is best-effort; the last known score just stays stale
    } finally {
      setScoring(false)
    }
  }, [docType, entityType, entityId])

  function handleContentChange(next: string) {
    setContent(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => rescore(next), 1500)
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Numbered, matched highlights — computed once per content/highlight change,
  // shared between the backdrop's inline marks and the flagged-issues list so
  // the numbers on both sides always correspond to the same passage.
  const matchedHighlights = useMemo(() => {
    return score.highlights.map((h, i) => ({ ...h, refNum: i + 1, range: findQuoteRange(content, h.quote) }))
  }, [score.highlights, content])

  const backdropHtml = useMemo(() => {
    if (!content) return `<span class="rfx-placeholder">${escapeHtml(label.placeholder)}</span>`
    const ranges = matchedHighlights
      .filter(h => h.range)
      .sort((a, b) => a.range!.start - b.range!.start)

    let out = ''
    let cursor = 0
    for (const h of ranges) {
      const { start, end } = h.range!
      if (start < cursor) continue // skip overlaps
      out += escapeHtml(content.slice(cursor, start))
      out += `<mark class="rfx-mark" style="background:${SEVERITY_BG[h.severity]};border-bottom:2px solid ${SEVERITY_COLOR[h.severity]}" title="${escapeHtml(h.issue)}">${escapeHtml(content.slice(start, end))}<sup class="rfx-ref" style="color:${SEVERITY_COLOR[h.severity]}">${h.refNum}</sup></mark>`
      cursor = end
    }
    out += escapeHtml(content.slice(cursor))
    return out + '\n'
  }, [content, matchedHighlights, label.placeholder])

  function syncScroll() {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  function jumpToHighlight(quote: string) {
    const ta = textareaRef.current
    if (!ta) return
    const range = findQuoteRange(content, quote)
    if (!range) return
    ta.focus()
    ta.setSelectionRange(range.start, range.end)
    const lineHeight = 21
    const lineNumber = content.slice(0, range.start).split('\n').length
    ta.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight)
    syncScroll()
  }

  async function finalize() {
    if (!draftId) return
    // No entity to attach to yet (e.g. drafting before the listing is
    // created) — hand the draft back as-is; the caller attaches it later.
    if (!entityId) {
      onFinalize(draftId, content)
      return
    }
    setFinalizing(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai/rfx/${draftId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: entityId }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to finalize'); return }
      onFinalize(draftId, content, json.document_id)
    } catch {
      setError('Failed to finalize')
    } finally {
      setFinalizing(false)
    }
  }

  function reset() {
    setDraftId(null)
    setContent('')
    setScore(EMPTY_SCORE)
    setError(null)
  }

  const busy = generating || uploading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14, alignItems: 'start' }}>
        {/* Document editor */}
        <div style={{ borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', background: 'var(--white)' }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--offwhite)' }}>
            <span style={{ fontSize: 15 }}>{label.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
              {content && content !== '' ? (context.title ? `${context.title} — ${label.name}` : label.name) : label.name}
            </span>
            {scoring && <span style={{ fontSize: 11, color: 'var(--gray)' }}>Re-scoring…</span>}
            <button
              type="button"
              className="btn btn-blue btn-sm"
              disabled={busy}
              onClick={generate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <span>✦</span>{generating ? 'Drafting…' : content ? 'Regenerate with AI' : 'Generate with AI'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" />
              </svg>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) evaluateUpload(file)
                e.target.value = ''
              }}
            />
          </div>

          {/* Page — overlay-highlighted text on top of an editable, visually-transparent textarea */}
          <div style={{ position: 'relative', minHeight: 420, maxHeight: 520, background: 'var(--white)' }}>
            <div
              ref={backdropRef}
              aria-hidden
              className="rfx-doc-backdrop"
              style={{
                position: 'absolute', inset: 0, margin: 0, padding: '24px 28px',
                fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.85, color: 'var(--ink)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto', pointerEvents: 'none',
              }}
              dangerouslySetInnerHTML={{ __html: backdropHtml }}
            />
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => handleContentChange(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              style={{
                position: 'absolute', inset: 0, margin: 0, padding: '24px 28px', resize: 'none',
                fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.85,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', width: '100%', height: '100%', boxSizing: 'border-box',
                background: 'transparent', border: 'none', outline: 'none', color: 'transparent', caretColor: 'var(--ink)',
              }}
            />
          </div>
        </div>

        {/* AI Review panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px', background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
              {score.overall_score ?? '—'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--gray)' }}>/ 100 overall</span>
          </div>

          {score.section_scores && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(score.section_scores).map(([key, value]) => (
                <ScoreBar key={key} label={key} value={value as number} />
              ))}
            </div>
          )}

          {score.price_assessment?.summary && (
            <div style={{ fontSize: 11, color: 'var(--gray)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Pricing benchmark</div>
              {score.price_assessment.summary}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              Flagged Issues {matchedHighlights.length > 0 && `(${matchedHighlights.length})`}
            </div>
            {matchedHighlights.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--gray)' }}>No issues flagged{content ? '' : ' yet'}.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {matchedHighlights.map((h) => (
                  <button
                    key={h.refNum}
                    type="button"
                    onClick={() => jumpToHighlight(h.quote)}
                    disabled={!h.range}
                    style={{
                      textAlign: 'left', background: 'var(--offwhite)', border: '1px solid var(--border)',
                      borderLeft: `3px solid ${SEVERITY_COLOR[h.severity]}`, borderRadius: 6, padding: '8px 10px',
                      cursor: h.range ? 'pointer' : 'default', display: 'flex', gap: 8,
                    }}
                  >
                    <span style={{
                      flexShrink: 0, width: 16, height: 16, borderRadius: '50%', background: SEVERITY_BG[h.severity],
                      color: SEVERITY_COLOR[h.severity], fontSize: 10, fontWeight: 700, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', marginTop: 1,
                    }}>
                      {h.refNum}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: SEVERITY_COLOR[h.severity], textTransform: 'uppercase', marginBottom: 2 }}>
                        {h.section}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink)', marginBottom: 2 }}>{h.issue}</span>
                      {h.suggestion && <span style={{ display: 'block', fontSize: 11, color: 'var(--gray)' }}>{h.suggestion}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={finalizing || !draftId} onClick={finalize}>
          {finalizing ? 'Finalizing…' : 'Finalize'}
        </button>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={finalizing || !content} onClick={reset}>
          Clear
        </button>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={finalizing} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
