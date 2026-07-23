'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { Skeleton, SkeletonText, SkeletonCard, CountUp } from '@/components/motion'
import { PassportScoreRing } from '@/components/passport-score-ring'
import {
  PassportSections,
  type PassportOrg,
  type PassportPerformance,
  type PassportReview,
  type PassportDoc,
} from '@/components/passport-sections'

// ── Expert Analysis types ─────────────────────────────────────────────────────

interface ComponentScore {
  score: number
  reasoning: string
  flags?: string[]
  document_findings?: string[]
  missing_docs?: string[]
  key_metrics?: Record<string, string | null>
}

interface ExpertAnalysis {
  scores: {
    kyb_compliance: ComponentScore
    financial_health: ComponentScore & { key_metrics: Record<string, string | null> }
    trade_reliability: ComponentScore
    network_reputation: ComponentScore
  }
  total_score: number
  risk_tier: 'green' | 'amber' | 'red'
  executive_summary: string
  key_strengths: string[]
  risk_flags: string[]
  improvement_actions: string[]
  document_quality: 'complete' | 'partial' | 'missing_critical'
  analyst_confidence: 'high' | 'medium' | 'low'
  analyst_notes: string
  documents_analyzed: string[]
}

type OwnOrg = PassportOrg & {
  network_visible: boolean
  doing_business_as: string | null
  passport_narrative: string | null
  passport_expert_analysis: string | null
}

interface PassportResponse {
  organization: OwnOrg
  is_own: boolean
  peer_reviews: PassportReview[]
  avg_rating: number | null
  review_count: number
  supplier_performance: PassportPerformance | null
  recent_deals: number
  bank_view_count_30d: number
  org_view_count_30d: number
  network_passport_score_median: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null): string {
  const parts = (name || '?').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function OrgAvatar({ name, logoUrl }: { name: string | null; logoUrl?: string | null }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name ?? 'Organization logo'}
        style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 8, objectFit: 'contain', background: 'var(--white)', border: '1px solid var(--border)' }}
      />
    )
  }
  return (
    <div style={{ width: 52, height: 52, flexShrink: 0, background: 'var(--gold-dim)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-0.02em' }}>
      {initials(name)}
    </div>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  const isBuyer = type === 'anchor'
  return (
    <span className="badge" style={{ background: isBuyer ? 'var(--color-accent-light)' : 'var(--color-green-bg)', color: isBuyer ? 'var(--blue)' : 'var(--color-green)', borderColor: isBuyer ? 'var(--blue)' : 'var(--color-green)' }}>
      {isBuyer ? 'BUYER' : 'SUPPLIER'}
    </span>
  )
}

// ── Score Breakdown ───────────────────────────────────────────────────────────

const DIMS: { key: keyof ExpertAnalysis['scores']; label: string }[] = [
  { key: 'kyb_compliance',    label: 'KYB & Compliance' },
  { key: 'financial_health',  label: 'Financial Health' },
  { key: 'trade_reliability', label: 'Trade Reliability' },
  { key: 'network_reputation',label: 'Network Reputation' },
]

function dimColor(score: number): string {
  const p = score / 25
  if (p >= 0.75) return 'var(--color-green, #10B981)'
  if (p >= 0.45) return 'var(--color-amber, #F59E0B)'
  return 'var(--color-red, #EF4444)'
}

function tierColor(tier: string) {
  if (tier === 'green') return { color: 'var(--color-green)', bg: 'var(--color-green-bg, #EDFAF4)' }
  if (tier === 'amber') return { color: 'var(--color-amber)', bg: 'var(--color-amber-bg, #FEF3C7)' }
  return { color: 'var(--color-red)', bg: 'var(--color-red-bg, #FEE2E2)' }
}

function confLabel(c: string) {
  if (c === 'high')   return { label: 'High Confidence',   color: 'var(--color-green)' }
  if (c === 'medium') return { label: 'Medium Confidence', color: 'var(--color-amber)' }
  return                     { label: 'Low Confidence',    color: 'var(--color-red)' }
}

function ScoreBreakdownCard({ analysis, onRerun, rerunning }: { analysis: ExpertAnalysis; onRerun?: () => void; rerunning?: boolean }) {
  const [openDim, setOpenDim] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<'strengths' | 'actions' | null>('strengths')
  const tc = tierColor(analysis.risk_tier)
  const cc = confLabel(analysis.analyst_confidence)

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 18px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(20,40,204,0.025) 0%, rgba(124,58,237,0.025) 100%)',
      }}>
        <div style={{ width: 5, height: 5, background: 'var(--blue)', animation: 'badge-pulse 2.4s infinite', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--blue)' }}>
          Strike AI · Expert Score Breakdown
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: tc.bg, color: tc.color }}>
          {analysis.risk_tier.charAt(0).toUpperCase() + analysis.risk_tier.slice(1)} Tier
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: cc.color }}>{cc.label}</span>
        {onRerun && (
          <button
            type="button"
            onClick={onRerun}
            disabled={rerunning}
            style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', cursor: rerunning ? 'not-allowed' : 'pointer', opacity: rerunning ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {rerunning ? 'Analyzing…' : 'Update Score'}
          </button>
        )}
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── Score + summary row ── */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* Big score */}
          <div style={{ textAlign: 'center', minWidth: 80, flexShrink: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 700, lineHeight: 1,
              color: analysis.total_score >= 70 ? 'var(--color-green)' : analysis.total_score >= 45 ? 'var(--color-amber)' : 'var(--color-red)',
            }}>
              <CountUp value={analysis.total_score} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>out of 100</div>
            {analysis.documents_analyzed.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--gray-soft)', padding: '3px 8px', borderRadius: 999, background: 'var(--offwhite)', border: '1px solid var(--border)', display: 'inline-block' }}>
                {analysis.documents_analyzed.length} doc{analysis.documents_analyzed.length !== 1 ? 's' : ''} read
              </div>
            )}
          </div>
          {/* Executive summary */}
          <div style={{ flex: 1 }}>
            {/* Total bar */}
            <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{
                height: '100%', width: `${analysis.total_score}%`,
                background: analysis.total_score >= 70 ? 'var(--color-green)' : analysis.total_score >= 45 ? 'var(--color-amber)' : 'var(--color-red)',
                borderRadius: 999, transition: 'width 0.7s ease',
              }} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
              {analysis.executive_summary}
            </p>
          </div>
        </div>

        {/* ── 4 dimension bars ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
          {DIMS.map(({ key, label }) => {
            const dim = analysis.scores[key]
            const color = dimColor(dim.score)
            const isOpen = openDim === key
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => setOpenDim(isOpen ? null : key)}
                  style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>{dim.score}/25</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(dim.score / 25) * 100}%`, background: color, borderRadius: 999, transition: 'width 0.6s ease' }} />
                  </div>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.55, margin: 0 }}>{dim.reasoning}</p>
                    {dim.document_findings && dim.document_findings.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {dim.document_findings.map((f, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <div style={{ width: 3, height: 3, background: color, borderRadius: '50%', flexShrink: 0, marginTop: 5 }} />
                            <span style={{ fontSize: 11.5, color: 'var(--ink)', lineHeight: 1.5 }}>{f}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {dim.missing_docs && dim.missing_docs.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-amber)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Missing</span>
                        {dim.missing_docs.map((d, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <div style={{ width: 3, height: 3, background: 'var(--color-amber)', borderRadius: '50%', flexShrink: 0, marginTop: 5 }} />
                            <span style={{ fontSize: 11.5, color: 'var(--ink)', lineHeight: 1.5 }}>{d}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {dim.key_metrics && Object.keys(dim.key_metrics).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {Object.entries(dim.key_metrics).filter(([, v]) => v !== null).map(([k, v]) => (
                          <div key={k} style={{ fontSize: 11, padding: '3px 7px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 6 }}>
                            <span style={{ color: 'var(--gray)' }}>{k.replace(/_/g, ' ')}: </span>
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Collapsible sections ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Strengths */}
          {analysis.key_strengths.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpenSection(openSection === 'strengths' ? null : 'strengths')}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-green)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-green)' }}>Key Strengths</span>
                <span style={{ fontSize: 11, color: 'var(--gray)', background: 'var(--color-green-bg)', padding: '2px 8px', borderRadius: 999 }}>
                  {analysis.key_strengths.length}
                </span>
                <span style={{ fontSize: 10, color: 'var(--gray)' }}>{openSection === 'strengths' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'strengths' && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)' }}>
                  {analysis.key_strengths.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: i === 0 ? 10 : 0 }}>
                      <div style={{ width: 4, height: 4, background: 'var(--color-green)', borderRadius: '50%', flexShrink: 0, marginTop: 5 }} />
                      <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Improvement actions */}
          {analysis.improvement_actions.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpenSection(openSection === 'actions' ? null : 'actions')}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--blue)' }}>How to Improve</span>
                <span style={{ fontSize: 11, color: 'var(--blue)', background: 'var(--color-accent-light, #EEF0FF)', padding: '2px 8px', borderRadius: 999 }}>
                  {analysis.improvement_actions.length}
                </span>
                <span style={{ fontSize: 10, color: 'var(--gray)' }}>{openSection === 'actions' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'actions' && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)' }}>
                  {analysis.improvement_actions.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: i === 0 ? 10 : 0 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--blue)', minWidth: 18, flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Analyst notes */}
        {analysis.analyst_notes && (
          <div style={{ fontSize: 11.5, color: 'var(--gray)', fontStyle: 'italic', lineHeight: 1.5, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
            Analyst note: {analysis.analyst_notes}
          </div>
        )}
      </div>
    </div>
  )
}

// ── No-analysis placeholder ───────────────────────────────────────────────────

function ScoreBreakdownPlaceholder({ onRunAnalysis, loading }: { onRunAnalysis: () => void; loading: boolean }) {
  const steps = ['Reading uploaded documents…', 'Cross-referencing financials…', 'Scoring compliance posture…', 'Finalizing expert analysis…']
  const [step, setStep] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!loading) return
    ref.current = setInterval(() => setStep(s => (s + 1) % steps.length), 1800)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '32px 24px' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="var(--blue)" strokeWidth="1.6" />
            <path d="M16 16l-3.2-3.2" stroke="var(--blue)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No Expert Analysis Yet
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, margin: 0, maxWidth: 380 }}>
            Upload your KYB documents in the section below, then run the Expert AI Analysis. Claude will read every document and score your business across 4 dimensions.
          </p>
        </div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', opacity: step % 3 === i ? 1 : 0.3, transition: 'opacity 0.3s' }} />
              ))}
            </div>
            <span style={{ fontSize: 13, color: 'var(--blue)' }}>{steps[step]}</span>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onRunAnalysis}>
            Update Passport Score →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Ghost / Review banners ────────────────────────────────────────────────────

function ActivationPrompt({ onActivate }: { onActivate: () => void }) {
  return (
    <div className="card">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16, padding: '48px 24px' }}>
        <PassportScoreRing score={null} size="lg" showLabel pendingLabel="Passport Inactive" />
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
          Activate your Strike Passport
        </h2>
        <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, maxWidth: 460, margin: 0 }}>
          Your Passport is your AI-verified business identity on Strike. Complete verification to get your PassportScore, become visible to counterparties, and start transacting.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 420, marginTop: 4 }}>
          {['Get a verified PassportScore', 'Become discoverable on Strike Place', 'Submit financing requests and manage deals'].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 5, height: 5, background: 'var(--blue)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onActivate} style={{ marginTop: 8 }}>
          Activate Passport →
        </button>
      </div>
    </div>
  )
}

function UnderReviewBanner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--color-amber-bg)', borderLeft: '3px solid var(--color-amber)' }}>
      <div style={{ width: 6, height: 6, background: 'var(--color-amber)', flexShrink: 0, animation: 'badge-pulse 2.4s infinite' }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-amber)' }}>Under Review</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>
          Your Passport has been submitted and is being verified — usually within 1–2 business days.
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyPassportPage() {
  const user = useUser()
  const router = useRouter()
  const orgId = user?.org_id ?? null

  const [data, setData] = useState<PassportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [docs, setDocs] = useState<PassportDoc[]>([])
  const [certs, setCerts] = useState<PassportDoc[]>([])
  const [uploadingDocs, setUploadingDocs] = useState(false)
  const [uploadingCerts, setUploadingCerts] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [detectedType, setDetectedType] = useState<{
    fileName: string
    kind: 'document' | 'certification'
    detected_type: string
    confidence: string
  } | null>(null)

  const [runningAiReview, setRunningAiReview] = useState(false)
  const [aiReviewMsg, setAiReviewMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/passport/${orgId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to load passport')
        return
      }
      setData(await res.json() as PassportResponse)
    } catch {
      setError('Failed to load passport')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  const loadDocs = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/passport/${orgId}/documents`)
      if (!res.ok) return
      const json = await res.json()
      setDocs(json.documents ?? [])
      setCerts(json.certifications ?? [])
    } catch {}
  }, [orgId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadDocs() }, [loadDocs])

  async function uploadPassportFile(file: File, kind: 'document' | 'certification') {
    if (!orgId) return
    const setUploading = kind === 'document' ? setUploadingDocs : setUploadingCerts
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch(`/api/passport/${orgId}/documents`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => null) as { detected_type?: string | null; detection_confidence?: string | null } | null
      if (json?.detected_type) {
        setDetectedType({ fileName: file.name, kind, detected_type: json.detected_type, confidence: json.detection_confidence ?? 'medium' })
      }
      await loadDocs()
    } finally {
      setUploading(false)
    }
  }

  async function deletePassportDoc(docId: string) {
    if (!confirm('Remove this document?')) return
    setDeletingDocId(docId)
    try {
      await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
      await loadDocs()
    } finally {
      setDeletingDocId(null)
    }
  }

  async function runAiReview() {
    if (!orgId) return
    setRunningAiReview(true)
    setAiReviewMsg(null)
    try {
      const res = await fetch('/api/kyb/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAiReviewMsg((body as { error?: string }).error ?? 'Review failed')
        return
      }
      setAiReviewMsg('Analysis complete — refreshing…')
      await load()
      setAiReviewMsg(null)
    } catch {
      setAiReviewMsg('Request failed')
    } finally {
      setRunningAiReview(false)
    }
  }

  const org = data?.organization ?? null
  const dba = org?.doing_business_as && org.doing_business_as !== org.legal_name ? org.doing_business_as : null

  const expertAnalysis: ExpertAnalysis | null = (() => {
    if (!org?.passport_expert_analysis) return null
    try { return JSON.parse(org.passport_expert_analysis) as ExpertAnalysis }
    catch { return null }
  })()

  const kyb = org?.kyb_status ?? null
  const isGhost = kyb === 'not_started'
  const isUnderReview = kyb === 'submitted' || kyb === 'under_review' || kyb === 'more_info_requested' || kyb === 'in_progress'

  const aiContext = org ? JSON.stringify({
    page: 'my_passport',
    org_name: org.legal_name,
    passport_score: org.passport_score ?? null,
    kyb_status: kyb,
    is_ghost: isGhost,
    is_under_review: isUnderReview,
    risk_tier: org.risk_tier ?? null,
    performance_tier: org.performance_tier ?? null,
    network_median_score: data?.network_passport_score_median ?? null,
    score_vs_median: (org.passport_score != null && data?.network_passport_score_median != null)
      ? (org.passport_score >= data.network_passport_score_median ? 'above_median' : 'below_median')
      : null,
    expert_analysis: expertAnalysis ? {
      total_score: expertAnalysis.total_score,
      kyb_compliance: expertAnalysis.scores.kyb_compliance?.score ?? null,
      financial_health: expertAnalysis.scores.financial_health?.score ?? null,
      trade_reliability: expertAnalysis.scores.trade_reliability?.score ?? null,
      network_reputation: expertAnalysis.scores.network_reputation?.score ?? null,
    } : null,
    documents_uploaded: docs.length,
    certifications_uploaded: certs.length,
    what_to_do: isGhost
      ? 'Submit KYB documents and activate passport to appear on the network'
      : !expertAnalysis
        ? 'Update Passport Score to get a detailed breakdown'
        : expertAnalysis.total_score < 70
          ? 'Improve score by uploading more documents, getting peer reviews, and completing KYB'
          : 'Score is healthy — focus on completing trades and getting peer reviews',
  }) : null

  return (
    <>
      <Topbar crumbs={[{ label: 'Strike' }, { label: 'My Passport' }]} actions={<NotifBell />} />
      <div className="page"
        data-page-name="My Passport"
        data-ai-context={aiContext ?? undefined}
      >
        <div className="page-header">
          <h1>My Passport</h1>
          <div className="subtitle">Your AI-verified business risk identity on Strike.</div>
        </div>

        {!orgId ? (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>
              Your account isn&apos;t linked to an organization.
            </div>
          </div>
        ) : loading ? (
          <div className="split-60">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Skeleton width={52} height={52} circle />
                  <div style={{ flex: 1 }}>
                    <SkeletonText lines={2} widths={['55%', '30%']} />
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 28, paddingBottom: 24 }}>
                  <Skeleton width={120} height={120} circle />
                  <SkeletonText lines={1} widths={['40%']} />
                </div>
              </div>
              <SkeletonCard height={140} />
              <SkeletonCard height={180} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SkeletonCard height={110} />
              <SkeletonCard height={90} />
            </div>
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 20, color: 'var(--color-red)' }}>{error}</div>
        ) : (data && org && isGhost) ? (
          <ActivationPrompt onActivate={() => router.push('/onboarding')} />
        ) : (data && org) ? (
          <div className="split-60">
            {/* LEFT — main passport content */}
            <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isUnderReview && <UnderReviewBanner />}

              {/* Header card */}
              <div className="card">
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <OrgAvatar name={org.legal_name} logoUrl={org.logo_url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                        {org.legal_name ?? 'Your organization'}
                      </span>
                      <TypeBadge type={org.type} />
                    </div>
                    {dba && <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>doing business as {dba}</div>}
                  </div>
                </div>
              </div>

              {/* Score breakdown — only shown when analysis exists */}
              {expertAnalysis && (
                <ScoreBreakdownCard analysis={expertAnalysis} onRerun={runAiReview} rerunning={runningAiReview} />
              )}

              <PassportSections
                org={org}
                performance={data.supplier_performance}
                reviews={data.peer_reviews}
                avgRating={data.avg_rating}
                showEin
                documents={docs}
                certifications={certs}
                isOwnPassport
                uploadingDocs={uploadingDocs}
                uploadingCerts={uploadingCerts}
                deletingDocId={deletingDocId}
                onUploadDocument={file => uploadPassportFile(file, 'document')}
                onUploadCertification={file => uploadPassportFile(file, 'certification')}
                onDeleteDocument={deletePassportDoc}
              />
            </div>

            {/* RIGHT — slim sticky panel */}
            <div className="reveal-stagger" style={{ position: 'sticky', top: 62, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Run / Re-run AI Analysis button */}
              <div className="card">
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)' }}>
                    Expert AI Analysis
                  </div>
                  {aiReviewMsg && (
                    <div style={{ fontSize: 12, color: 'var(--color-green)', lineHeight: 1.4 }}>{aiReviewMsg}</div>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={runAiReview}
                    disabled={runningAiReview}
                    style={{ width: '100%', opacity: runningAiReview ? 0.7 : 1 }}
                  >
                    {runningAiReview ? 'Analyzing…' : expertAnalysis ? 'Update Passport Score' : 'Update Passport Score →'}
                  </button>
                  <p style={{ fontSize: 11.5, color: 'var(--gray)', lineHeight: 1.5, margin: 0 }}>
                    Claude reads your uploaded documents and scores your business across 4 dimensions.
                  </p>
                </div>
              </div>

              {/* View counts */}
              <div className="card">
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                      <CountUp value={data.bank_view_count_30d} />
                    </span>{' '}
                    bank{data.bank_view_count_30d === 1 ? '' : 's'} viewed your Passport this month
                  </div>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                      <CountUp value={data.org_view_count_30d} />
                    </span>{' '}
                    organization{data.org_view_count_30d === 1 ? '' : 's'} viewed your Passport this month
                  </div>
                </div>
              </div>

              {/* Network comparison */}
              {data.network_passport_score_median !== null && (
                <div className="card">
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)' }}>
                      Network Median
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>
                        <CountUp value={data.network_passport_score_median} />
                      </span>
                      {org.passport_score !== null && (
                        <span style={{
                          fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                          background: org.passport_score >= data.network_passport_score_median ? 'var(--color-green-bg)' : 'var(--color-amber-bg)',
                          color: org.passport_score >= data.network_passport_score_median ? 'var(--color-green)' : 'var(--color-amber)',
                        }}>
                          {org.passport_score >= data.network_passport_score_median ? `+${org.passport_score - Math.round(data.network_passport_score_median)} above` : `${Math.round(data.network_passport_score_median) - org.passport_score} below`}
                        </span>
                      )}
                    </div>
                    <div style={{ height: 5, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                      {org.passport_score !== null && (
                        <div style={{ height: '100%', width: `${org.passport_score}%`, background: 'var(--blue)', borderRadius: 999 }} />
                      )}
                      {/* median marker */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${data.network_passport_score_median}%`, width: 2, background: 'var(--gray-soft)', transform: 'translateX(-50%)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--gray)' }}>
                      <span>Your score: {org.passport_score ?? '—'}</span>
                      <span>Median: {Math.round(data.network_passport_score_median)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {detectedType && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={() => setDetectedType(null)}
        >
          <div
            style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 28, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-elevated)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Document identified</h2>
              <button onClick={() => setDetectedType(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--gray)' }}>×</button>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 4 }}>
              {detectedType.fileName}
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
              background: 'var(--blue-light)', borderRadius: 'var(--radius-input)', marginTop: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--blue)', marginBottom: 3 }}>
                  Strike AI detected
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                  {detectedType.detected_type}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
                background: detectedType.confidence === 'high' ? 'var(--color-green-bg)' : 'var(--offwhite)',
                color: detectedType.confidence === 'high' ? 'var(--color-green)' : 'var(--gray)',
                textTransform: 'capitalize',
              }}>
                {detectedType.confidence} confidence
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 14, lineHeight: 1.5 }}>
              Filed under {detectedType.kind === 'certification' ? 'Certifications' : 'Documents'} on your Passport profile.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 16 }}
              onClick={() => setDetectedType(null)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
