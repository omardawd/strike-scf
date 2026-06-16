'use client'
import React from 'react'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { fmtMoney } from '@/components/portal-shell'

// ── Shared shapes (kept local — see note in CLAUDE.md about the types pkg) ──
export interface PassportOrg {
  id: string
  type: string | null
  legal_name: string | null
  doing_business_as: string | null
  business_type: string | null
  state_of_incorporation: string | null
  country_of_incorporation: string | null
  industry_naics: string | null
  website: string | null
  description: string | null
  years_in_operation: number | null
  annual_revenue_range: string | null
  employee_count_range: string | null
  country_of_origin: string | null
  sourcing_countries: string[] | null
  product_categories: string[] | null
  kyb_status: string | null
  risk_tier: string | null
  risk_flags: string[] | null
  performance_tier: string | null
  passport_score: number | null
  passport_score_updated_at: string | null
  trade_count_total: number | null
  trade_volume_total: number | null
  avg_payment_days: number | null
  dispute_rate_network: number | null
  ein_masked?: string | null
}

export interface PassportPerformance {
  on_time_payment_rate: number | null
  dispute_rate: number | null
  avg_advance_rate: number | null
  total_deals: number | null
  total_deal_volume: number | null
  performance_tier: string | null
}

export interface PassportReview {
  id: string
  rating: number | null
  category_scores: Record<string, number> | null
  comment: string | null
  created_at: string
  reviewer_name: string
}

export interface PassportDoc {
  id: string
  name: string
  mime_type: string | null
  document_kind: string
  created_at: string
  url: string | null
}

// ── Small formatting helpers ────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Rates may arrive as 0–1 fractions or 0–100 percentages; normalise to %.
function asPct(rate: number | null | undefined, digits = 0): string {
  if (rate == null || !Number.isFinite(Number(rate))) return '—'
  const n = Number(rate)
  const pct = n <= 1 ? n * 100 : n
  return `${pct.toFixed(digits)}%`
}

function pctValue(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(Number(rate))) return 0
  const n = Number(rate)
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n))
}

function countryFlag(code: string): string {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return '🌐'
  const A = 0x1f1e6
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65))
}

function tierTone(tier: string | null): { bg: string; fg: string } {
  switch (tier) {
    case 'green':
    case 'preferred':
      return { bg: 'var(--color-green-bg)', fg: 'var(--color-green)' }
    case 'red':
    case 'under_review':
      return { bg: 'var(--color-red-bg)', fg: 'var(--color-red)' }
    case 'amber':
    case 'standard':
    default:
      return { bg: 'var(--color-amber-bg)', fg: 'var(--color-amber)' }
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12,
        background: 'var(--offwhite)',
        border: '1px solid var(--border)',
        color: 'var(--ink)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.round(value)
  return (
    <span style={{ color: '#C9A84C', fontSize: size, letterSpacing: 1, lineHeight: 1 }} aria-label={`${value} out of 5`}>
      {'★'.repeat(Math.max(0, Math.min(5, full)))}
      <span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(Math.max(0, 5 - full))}</span>
    </span>
  )
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="kv-row">
      <span className="k">{k}</span>
      <span className="v plain" style={{ textAlign: 'right' }}>{children}</span>
    </div>
  )
}

function DocRow({ doc, isOwn, onDelete, deleting }: { doc: PassportDoc; isOwn: boolean; onDelete?: (id: string) => void; deleting?: boolean }) {
  return (
    <div className="doc-row">
      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
      <span className="doc-name">{doc.name}</span>
      <span className="doc-date">{fmtDate(doc.created_at)}</span>
      {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a> : <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>}
      {isOwn && onDelete && (
        <button onClick={() => onDelete(doc.id)} disabled={deleting} style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Remove</button>
      )}
    </div>
  )
}

function PassportDocsCard({
  title,
  hint,
  docs,
  isOwn,
  uploading,
  onUpload,
  onDelete,
  deletingId,
}: {
  title: string
  hint: string
  docs: PassportDoc[]
  isOwn: boolean
  uploading?: boolean
  onUpload?: (file: File) => void
  onDelete?: (id: string) => void
  deletingId?: string | null
}) {
  return (
    <div className="card">
      <div className="card-head">
        {title}
        {isOwn && onUpload && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label htmlFor={`passport-doc-upload-${title}`} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11 }}>
              {uploading ? 'Uploading…' : '+ Upload'}
            </label>
            <input
              id={`passport-doc-upload-${title}`}
              type="file"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) onUpload(file)
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>
      {docs.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>{hint}</div>
      ) : (
        docs.map(doc => <DocRow key={doc.id} doc={doc} isOwn={isOwn} onDelete={onDelete} deleting={deletingId === doc.id} />)
      )}
    </div>
  )
}

// ── The shared passport body (sections b–h) ─────────────────────────────────
export function PassportSections({
  org,
  performance,
  reviews,
  avgRating,
  showEin = false,
  documents = [],
  certifications = [],
  isOwnPassport = false,
  uploadingDocs = false,
  uploadingCerts = false,
  deletingDocId = null,
  onUploadDocument,
  onUploadCertification,
  onDeleteDocument,
}: {
  org: PassportOrg
  performance: PassportPerformance | null
  reviews: PassportReview[]
  avgRating: number | null
  showEin?: boolean
  documents?: PassportDoc[]
  certifications?: PassportDoc[]
  isOwnPassport?: boolean
  uploadingDocs?: boolean
  uploadingCerts?: boolean
  deletingDocId?: string | null
  onUploadDocument?: (file: File) => void
  onUploadCertification?: (file: File) => void
  onDeleteDocument?: (id: string) => void
}) {
  const flags = org.risk_flags ?? []
  const sourcing = org.sourcing_countries ?? []
  const categories = org.product_categories ?? []
  const perfTier = performance?.performance_tier ?? org.performance_tier ?? null

  return (
    <>
      {/* (b) PassportScore */}
      <div className="card">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 28, paddingBottom: 24 }}>
          <PassportScoreRing score={org.passport_score} size="lg" showLabel />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)', letterSpacing: '0.08em' }}>
            Updated {fmtDate(org.passport_score_updated_at)}
          </div>
          {flags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {flags.map((f, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    background: 'var(--color-amber-bg)',
                    color: 'var(--color-amber)',
                    border: '1px solid var(--color-amber)',
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* (c) Stat tiles — hairline-divider grid */}
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Trades</div>
          <div className="kpi-value">{org.trade_count_total ?? 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Volume</div>
          <div className="kpi-value">{fmtMoney(org.trade_volume_total)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Payment Days</div>
          <div className="kpi-value">{org.avg_payment_days ?? '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">On-Time Rate</div>
          <div className="kpi-value">{asPct(performance?.on_time_payment_rate)}</div>
        </div>
      </div>

      {/* (d) Business Identity */}
      <div className="card">
        <div className="card-head"><h3 className="t-card-head">Business Identity</h3></div>
        <div className="kv-rows">
          <KV k="Legal name">{org.legal_name ?? '—'}</KV>
          {showEin && org.ein_masked && (
            <div className="kv-row">
              <span className="k">EIN</span>
              <span className="v mono" style={{ textAlign: 'right' }}>{org.ein_masked}</span>
            </div>
          )}
          <KV k="Business type">{org.business_type ?? '—'}</KV>
          <KV k="Incorporated">
            {[org.state_of_incorporation, org.country_of_incorporation].filter(Boolean).join(', ') || '—'}
          </KV>
          <KV k="Years operating">{org.years_in_operation ?? '—'}</KV>
          <KV k="Industry">{org.industry_naics ?? '—'}</KV>
          <KV k="Website">
            {org.website ? (
              <a href={org.website.startsWith('http') ? org.website : `https://${org.website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>
                {org.website.replace(/^https?:\/\//, '')}
              </a>
            ) : '—'}
          </KV>
        </div>
        {org.description && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
            {org.description}
          </div>
        )}
      </div>

      {/* (e) Trade Profile */}
      <div className="card">
        <div className="card-head"><h3 className="t-card-head">Trade Profile</h3></div>
        <div className="kv-rows">
          <KV k="Country of origin">
            {org.country_of_origin ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {countryFlag(org.country_of_origin)} {org.country_of_origin}
              </span>
            ) : '—'}
          </KV>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="fs-label" style={{ marginBottom: 8 }}>Sourcing countries</div>
            {sourcing.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sourcing.map((c, i) => <Chip key={i}>{countryFlag(c)} {c}</Chip>)}
              </div>
            ) : <span style={{ fontSize: 13, color: 'var(--gray)' }}>Not specified</span>}
          </div>
          <div>
            <div className="fs-label" style={{ marginBottom: 8 }}>Product categories</div>
            {categories.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categories.map((c, i) => (
                  <span key={i} style={{ padding: '4px 10px', fontSize: 12, background: 'var(--color-accent-light)', color: 'var(--blue)', whiteSpace: 'nowrap' }}>{c}</span>
                ))}
              </div>
            ) : <span style={{ fontSize: 13, color: 'var(--gray)' }}>Not specified</span>}
          </div>
        </div>
      </div>

      {/* Documents & Certifications — quality/ISO/compliance docs, distinct from onboarding/KYB documents */}
      <PassportDocsCard
        title="Documents"
        hint="Quality, compliance, and trade documents appear here."
        docs={documents}
        isOwn={isOwnPassport}
        uploading={uploadingDocs}
        onUpload={onUploadDocument}
        onDelete={onDeleteDocument}
        deletingId={deletingDocId}
      />
      <PassportDocsCard
        title="Certifications"
        hint="ISO certificates and other quality credentials appear here."
        docs={certifications}
        isOwn={isOwnPassport}
        uploading={uploadingCerts}
        onUpload={onUploadCertification}
        onDelete={onDeleteDocument}
        deletingId={deletingDocId}
      />

      {/* (f) Financial Snapshot */}
      <div className="card">
        <div className="card-head"><h3 className="t-card-head">Financial Snapshot</h3></div>
        <div className="kv-rows">
          <KV k="Revenue range">{org.annual_revenue_range ?? '—'}</KV>
          <KV k="Employee count">{org.employee_count_range ?? '—'}</KV>
          <div className="kv-row">
            <span className="k">KYB status</span>
            <span className="v" style={{ textAlign: 'right' }}>
              <KybBadge status={org.kyb_status} />
            </span>
          </div>
        </div>
      </div>

      {/* (g) Peer Reviews */}
      <div className="card">
        <div className="card-head">
          <h3 className="t-card-head">Peer Reviews</h3>
          {reviews.length > 0 && avgRating != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Stars value={avgRating} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--gray)' }}>
                {avgRating.toFixed(1)} · {reviews.length}
              </span>
            </span>
          )}
        </div>
        {reviews.length === 0 ? (
          <div style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
            Reviews from counterparties appear here after completed deals
          </div>
        ) : (
          <div>
            {reviews.map(r => (
              <div key={r.id} style={{ padding: '14px 24px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.reviewer_name}</span>
                  <Stars value={Number(r.rating ?? 0)} size={13} />
                </div>
                {r.comment && (
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, marginTop: 6 }}>{r.comment}</div>
                )}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--gray)', marginTop: 6 }}>
                  {fmtDate(r.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* (h) Platform Behavior */}
      <div className="card">
        <div className="card-head">
          <h3 className="t-card-head">Platform Behavior</h3>
          {perfTier && (
            <span className="badge" style={{ ...tierBadgeColors(perfTier) }}>
              {String(perfTier).replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>On-time payment rate</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{asPct(performance?.on_time_payment_rate, 1)}</span>
            </div>
            <div className="util-bar">
              <div className="util-bar-fill util-green" style={{ width: `${pctValue(performance?.on_time_payment_rate)}%` }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="fs-label">Dispute rate</div>
              <div className="fs-value">{asPct(performance?.dispute_rate ?? org.dispute_rate_network, 1)}</div>
            </div>
            <div>
              <div className="fs-label">Avg payment days</div>
              <div className="fs-value">{org.avg_payment_days ?? '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function tierBadgeColors(tier: string): React.CSSProperties {
  const { bg, fg } = tierTone(tier)
  return { background: bg, color: fg, borderColor: fg }
}

function KybBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    approved: 'badge-active',
    under_review: 'badge-signing',
    submitted: 'badge-pending',
    more_info_requested: 'badge-offer',
    rejected: 'badge-rejected',
    ai_reviewing: 'badge-pending',
    in_progress: 'badge-pending',
  }
  const cls = map[status ?? ''] ?? 'badge-draft'
  const label = (status ?? 'unknown').replace(/_/g, ' ')
  return <span className={`badge ${cls}`} style={{ textTransform: 'capitalize' }}>{label}</span>
}
