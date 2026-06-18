'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar, NotifBell } from '@/components/portal-shell'
import {
  PassportSections,
  type PassportOrg,
  type PassportPerformance,
  type PassportReview,
  type PassportDoc,
} from '@/components/passport-sections'

type PublicOrg = PassportOrg & {
  doing_business_as: string | null
}

interface PassportResponse {
  organization: PublicOrg
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

interface NarrativeResponse {
  narrative: string | null
  narrative_updated_at: string | null
  assessment: string | null
  medians: {
    passport_score: number | null
    avg_payment_days: number | null
    dispute_rate_network: number | null
    trade_count_total: number | null
    peer_count: number
  }
  is_own: boolean
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
        color: '#C9A84C',
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

function AiAssessmentPanel({
  narrative,
  assessment,
  loading,
}: {
  narrative: string | null
  assessment: string | null
  loading: boolean
}) {
  return (
    <div style={{ border: '1px solid rgba(20,40,204,0.22)', background: 'rgba(20,40,204,0.02)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid rgba(20,40,204,0.1)',
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            background: 'var(--blue)',
            animation: 'badge-pulse 2.4s infinite',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--blue)',
          }}
        >
          Strike AI · Assessment
        </span>
      </div>
      {loading ? (
        <div
          style={{
            padding: '12px 14px',
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--blue)',
            letterSpacing: '0.04em',
          }}
        >
          Analyzing…
        </div>
      ) : (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {narrative && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>{narrative}</div>
          )}
          {assessment && narrative && (
            <div style={{ height: 1, background: 'rgba(20,40,204,0.1)' }} />
          )}
          {assessment && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>{assessment}</div>
          )}
          {!narrative && !assessment && (
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>
              Passport narrative will be generated upon KYB verification.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewedToast({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        right: 32,
        zIndex: 100,
        background: 'var(--color-green)',
        color: '#fff',
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 8l3.5 3.5L13 4"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Review submitted — thank you
    </div>
  )
}

export default function PublicPassportPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useUser()
  const orgId = params.org_id as string

  const [showReviewedToast, setShowReviewedToast] = useState(
    searchParams.get('reviewed') === 'true'
  )
  const [data, setData] = useState<PassportResponse | null>(null)
  const [narrativeData, setNarrativeData] = useState<NarrativeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<PassportDoc[]>([])
  const [certs, setCerts] = useState<PassportDoc[]>([])

  const load = useCallback(async () => {
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

      // If this is the user's own org, redirect to the canonical own-view page.
      if (json.is_own) {
        router.replace('/passport')
        return
      }
    } catch {
      setError('Failed to load passport')
    } finally {
      setLoading(false)
    }
  }, [orgId, router])

  const loadNarrative = useCallback(async () => {
    setNarrativeLoading(true)
    try {
      const res = await fetch(`/api/passport/${orgId}/narrative`)
      if (res.ok) {
        setNarrativeData((await res.json()) as NarrativeResponse)
      }
    } catch {
      /* non-fatal */
    } finally {
      setNarrativeLoading(false)
    }
  }, [orgId])

  const logView = useCallback(async () => {
    try {
      await fetch(`/api/passport/${orgId}/view`, { method: 'POST' })
    } catch {
      /* non-fatal */
    }
  }, [orgId])

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/passport/${orgId}/documents`)
      if (!res.ok) return
      const json = await res.json()
      setDocs(json.documents ?? [])
      setCerts(json.certifications ?? [])
    } catch {
      /* non-fatal */
    }
  }, [orgId])

  useEffect(() => {
    load()
    loadDocs()
  }, [load, loadDocs])

  useEffect(() => {
    if (data && !data.is_own) {
      loadNarrative()
      logView()
    }
  }, [data, loadNarrative, logView]) // eslint-disable-line react-hooks/exhaustive-deps

  const org = data?.organization ?? null
  const dba =
    org?.doing_business_as && org.doing_business_as !== org.legal_name
      ? org.doing_business_as
      : null

  // Suppress own-org data while the redirect fires.
  if (data?.is_own) return null

  return (
    <>
      {showReviewedToast && (
        <ReviewedToast onDismiss={() => setShowReviewedToast(false)} />
      )}
      <Topbar
        crumbs={[
          { label: 'Strike' },
          { label: 'Passports', onClick: () => router.push('/passport') },
          { label: org?.legal_name ?? '…' },
        ]}
        actions={<NotifBell />}
      />
      <div className="page" data-page-name="Passport" data-ai-context={JSON.stringify({ org_name: org?.legal_name ?? null, org_type: org?.type ?? null, org_id: orgId, review_count: data?.review_count ?? null, avg_rating: data?.avg_rating ?? null, recent_deals: data?.recent_deals ?? null, bank_views_30d: data?.bank_view_count_30d ?? null })}>
        {loading ? (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div>
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ color: 'var(--color-red)', fontSize: 14 }}>{error}</div>
          </div>
        ) : (data && org) ? (
          <div className="split-60">
            {/* LEFT — passport content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Header */}
              <div className="card">
                <div
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--gray)',
                  }}
                >
                  This organization&apos;s Strike Passport
                </div>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <OrgAvatar name={org.legal_name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 24,
                          fontWeight: 600,
                          letterSpacing: '-0.02em',
                          color: 'var(--ink)',
                        }}
                      >
                        {org.legal_name ?? 'Unknown organization'}
                      </span>
                      <TypeBadge type={org.type} />
                    </div>
                    {dba && (
                      <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
                        doing business as {dba}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <PassportSections
                org={org}
                performance={data.supplier_performance}
                reviews={data.peer_reviews}
                avgRating={data.avg_rating}
                showEin={false}
                documents={docs}
                certifications={certs}
              />
            </div>

            {/* RIGHT — sticky AI assessment panel */}
            <div
              style={{
                position: 'sticky',
                top: 62,
                alignSelf: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <AiAssessmentPanel
                narrative={narrativeData?.narrative ?? null}
                assessment={narrativeData?.assessment ?? null}
                loading={narrativeLoading}
              />

              <div className="card">
                <div
                  className="card-body"
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--ink)',
                      }}
                    >
                      {data.bank_view_count_30d}
                    </span>{' '}
                    bank{data.bank_view_count_30d === 1 ? '' : 's'} viewed this Passport this month
                  </div>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--ink)',
                      }}
                    >
                      {data.org_view_count_30d}
                    </span>{' '}
                    organization
                    {data.org_view_count_30d === 1 ? '' : 's'} viewed this Passport this month
                  </div>
                  {narrativeData?.medians?.peer_count != null &&
                    narrativeData.medians.peer_count > 0 && (
                      <>
                        <div style={{ height: 1, background: 'var(--border)' }} />
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: 'var(--gray)',
                            fontFamily: 'var(--font-body)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          Network median PassportScore™:{' '}
                          <strong style={{ color: 'var(--ink)' }}>
                            {narrativeData.medians.passport_score != null
                              ? Math.round(narrativeData.medians.passport_score)
                              : '—'}
                          </strong>{' '}
                          across {narrativeData.medians.peer_count} verified{' '}
                          {org.type === 'anchor' ? 'buyer' : 'supplier'}s
                        </div>
                      </>
                    )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
