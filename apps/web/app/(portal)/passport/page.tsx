'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { AIInsight } from '@/components/ai-insight'
import { PassportScoreRing } from '@/components/passport-score-ring'
import {
  PassportSections,
  type PassportOrg,
  type PassportPerformance,
  type PassportReview,
  type PassportDoc,
} from '@/components/passport-sections'

type OwnOrg = PassportOrg & {
  network_visible: boolean
  doing_business_as: string | null
  passport_narrative: string | null
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

function initials(name: string | null): string {
  const parts = (name || '?').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function OrgAvatar({ name }: { name: string | null }) {
  return (
    <div
      style={{
        width: 52,
        height: 52,
        flexShrink: 0,
        background: 'var(--gold-dim)',
        color: 'var(--gold)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 20,
        letterSpacing: '-0.02em',
      }}
    >
      {initials(name)}
    </div>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  const isBuyer = type === 'anchor'
  return (
    <span
      className="badge"
      style={{
        background: isBuyer ? 'var(--color-accent-light)' : 'var(--color-green-bg)',
        color: isBuyer ? 'var(--blue)' : 'var(--color-green)',
        borderColor: isBuyer ? 'var(--blue)' : 'var(--color-green)',
      }}
    >
      {isBuyer ? 'BUYER' : 'SUPPLIER'}
    </span>
  )
}

function NarrativePanel({ narrative }: { narrative: string | null }) {
  return (
    <div style={{ border: '1px solid var(--teal, rgba(0,180,160,0.4))', background: 'var(--teal-dim, rgba(0,180,160,0.04))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--teal, rgba(0,180,160,0.15))' }}>
        <div style={{ width: 5, height: 5, background: 'var(--teal, #0FB8A0)', animation: 'badge-pulse 2.4s infinite', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal, #0FB8A0)' }}>
          Strike AI · Passport Narrative
        </span>
      </div>
      {narrative ? (
        <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>
          {narrative}
        </div>
      ) : (
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--gray)', marginBottom: 10, lineHeight: 1.4 }}>
            Your AI-generated Passport narrative will appear here after KYB is verified. It will include:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[
              'Business overview and sector positioning',
              'Verified trade history and volume summary',
              'Payment reliability and performance record',
              'Risk profile and compliance standing',
              'Strike network credibility signal',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ width: 4, height: 4, background: 'var(--teal, #0FB8A0)', flexShrink: 0, marginTop: 5 }} />
                <span style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5 }}>{item}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--gray-soft)', marginTop: 12, lineHeight: 1.4 }}>
            Complete your KYB submission to unlock your Passport narrative.
          </p>
        </div>
      )}
    </div>
  )
}

// Ghost mode (kyb_status = 'not_started'): the Passport page is the onboarding
// entry point, so it shows an activation prompt — never a locked card.
function ActivationPrompt({ onActivate }: { onActivate: () => void }) {
  return (
    <div className="card">
      <div
        className="card-body"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 16,
          padding: '48px 24px',
        }}
      >
        <PassportScoreRing score={null} size="lg" showLabel pendingLabel="Passport Inactive" />
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Activate your Strike Passport
        </h2>
        <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, maxWidth: 460, margin: 0 }}>
          Your Passport is your AI-verified business identity on Strike. Complete verification to
          get your PassportScore, become visible to counterparties, and start transacting.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 420, marginTop: 4 }}>
          {[
            'Get a verified PassportScore',
            'Become discoverable on Strike Place',
            'Submit financing requests and manage deals',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }}>
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

// Submitted / pending: passport data is shown read-only beneath this banner.
function UnderReviewBanner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 18px',
        background: 'var(--color-amber-bg)',
        borderLeft: '3px solid var(--color-amber)',
      }}
    >
      <div style={{ width: 6, height: 6, background: 'var(--color-amber)', flexShrink: 0, animation: 'badge-pulse 2.4s infinite' }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-amber)' }}>Under Review</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>
          Your Passport has been submitted and is being verified — usually within 1–2 business days.
          The details below are read-only until verification completes.
        </div>
      </div>
    </div>
  )
}

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

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/passport/${orgId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to load passport')
        return
      }
      const json = (await res.json()) as PassportResponse
      setData(json)
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
    } catch {
      // non-fatal
    }
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
      await fetch(`/api/passport/${orgId}/documents`, { method: 'POST', body: fd })
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

  const org = data?.organization ?? null
  const dba =
    org?.doing_business_as && org.doing_business_as !== org.legal_name
      ? org.doing_business_as
      : null

  // Passport page states (TE.2):
  //  - ghost  (kyb_status = 'not_started') → activation prompt, never a locked card
  //  - review (submitted / under_review / more_info_requested / in_progress) →
  //            read-only passport beneath an "Under Review" banner
  //  - active (approved / anything else)   → full passport
  const kyb = org?.kyb_status ?? null
  const isGhost = kyb === 'not_started'
  const isUnderReview =
    kyb === 'submitted' ||
    kyb === 'under_review' ||
    kyb === 'more_info_requested' ||
    kyb === 'in_progress'

  return (
    <>
      <Topbar crumbs={[{ label: 'Strike' }, { label: 'My Passport' }]} actions={<NotifBell />} />
      <div className="page">
        <div className="page-header">
          <h1>My Passport</h1>
          <div className="subtitle">Your AI-verified business risk identity on Strike.</div>
        </div>

        {!orgId ? (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray)', fontSize: 14 }}>
              Your account isn&apos;t linked to an organization, so there&apos;s no Passport to show.
            </div>
          </div>
        ) : loading ? (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div>
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 20, color: 'var(--color-red)' }}>{error}</div>
        ) : (data && org && isGhost) ? (
          <ActivationPrompt onActivate={() => router.push('/onboarding')} />
        ) : (data && org) ? (
          <div className="split-60">
            {/* LEFT — passport content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isUnderReview && <UnderReviewBanner />}
              {/* (a) Header */}
              <div className="card">
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <OrgAvatar name={org.legal_name} />
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

            {/* RIGHT — sticky AI panel */}
            <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <NarrativePanel narrative={org.passport_narrative} />

              <AIInsight
                title="Passport Health"
                prompt="Assess this organization's Strike Passport health and give one concrete recommendation to raise its PassportScore or improve its network standing."
                context={{
                  passport_score: org.passport_score,
                  network_passport_score_median: data.network_passport_score_median,
                  risk_tier: org.risk_tier,
                  risk_flags: org.risk_flags,
                  kyb_status: org.kyb_status,
                  trade_count_total: org.trade_count_total,
                  trade_volume_total: org.trade_volume_total,
                  avg_payment_days: org.avg_payment_days,
                  on_time_payment_rate: data.supplier_performance?.on_time_payment_rate ?? null,
                  dispute_rate: data.supplier_performance?.dispute_rate ?? null,
                  review_count: data.review_count,
                  recent_deals_12mo: data.recent_deals,
                }}
                collapsed={false}
              />

              <div className="card">
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                      {data.bank_view_count_30d}
                    </span>{' '}
                    bank{data.bank_view_count_30d === 1 ? '' : 's'} viewed your Passport this month
                  </div>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                      {data.org_view_count_30d}
                    </span>{' '}
                    organization{data.org_view_count_30d === 1 ? '' : 's'} viewed your Passport this month
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
