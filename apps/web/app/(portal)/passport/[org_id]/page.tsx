'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { Skeleton, SkeletonText, SkeletonCard, CountUp } from '@/components/motion'
import {
  PassportSections,
  type PassportOrg,
  type PassportPerformance,
  type PassportReview,
  type PassportDoc,
} from '@/components/passport-sections'
import { useT } from '@/lib/i18n/locale-context'

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
  catalog: CatalogListing[]
}

interface CatalogListing {
  id: string
  title: string
  listing_type: string
  category: string | null
  target_price: number | null
  currency: string
  unit: string | null
  cover_image_url: string | null
  delivery_deadline: string | null
  created_at: string
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

function OrgCatalog({ listings, orgName }: { listings: CatalogListing[]; orgName: string | null }) {
  const t = useT()
  const router = useRouter()
  if (listings.length === 0) return null

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-head">
        {t('passportPublic.productsListingsFrom', { org: orgName ?? t('passportPublic.thisOrganization') })}
        <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--gray)', fontSize: 12 }}>
          {t('passport.activeCount', { count: String(listings.length) })}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 14,
          padding: 16,
        }}
      >
        {listings.map((item) => (
          <div
            key={item.id}
            className="card card-interactive"
            style={{ overflow: 'hidden', cursor: 'pointer' }}
            onClick={() => router.push(`/marketplace/listings/${item.id}`)}
          >
            {item.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.cover_image_url} alt={item.title} className="listing-card-image" />
            ) : (
              <div className="listing-card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-soft)' }}>
                <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6" />
                </svg>
              </div>
            )}
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gray)', marginBottom: 4 }}>
                {item.category ?? (item.listing_type === 'po_request' ? t('passport.poRequest') : t('passport.productService'))}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6, lineHeight: 1.3 }}>
                {item.title}
              </div>
              {item.target_price != null && (
                <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                  {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(item.target_price)} {item.currency}
                  {item.unit && <span> / {item.unit}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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
  const t = useT()
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
      {isBuyer ? t('passport.buyer') : t('passport.supplier')}
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
  const t = useT()
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
          {t('passportPublic.strikeAiAssessment')}
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
          {t('passport.analyzing')}
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
              {t('passportPublic.narrativePending')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewedToast({ onDismiss }: { onDismiss: () => void }) {
  const t = useT()
  useEffect(() => {
    const timeout = setTimeout(onDismiss, 4500)
    return () => clearTimeout(timeout)
  }, [onDismiss])
  return (
    <div
      style={{
        position: 'fixed',
        top: 24,
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
      {t('passportPublic.reviewSubmitted')}
    </div>
  )
}

export default function PublicPassportPage() {
  const t = useT()
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
        setError((body as { error?: string }).error ?? t('passport.loadFailed'))
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
      setError(t('passport.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [orgId, router, t])

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
          { label: t('passport.strike') },
          { label: t('passportPublic.passports'), onClick: () => router.push('/passport') },
          { label: org?.legal_name ?? '…' },
        ]}
        actions={<NotifBell />}
      />
      <div className="page" data-page-name="Passport" data-ai-context={JSON.stringify({ org_name: org?.legal_name ?? null, org_type: org?.type ?? null, org_id: orgId, review_count: data?.review_count ?? null, avg_rating: data?.avg_rating ?? null, recent_deals: data?.recent_deals ?? null, bank_views_30d: data?.bank_view_count_30d ?? null })}>
        {loading ? (
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
              <SkeletonCard height={130} />
              <SkeletonCard height={90} />
            </div>
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ color: 'var(--color-red)', fontSize: 14 }}>{error}</div>
          </div>
        ) : (data && org) ? (
          <div className="split-60">
            {/* LEFT — passport content */}
            <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  {t('passportPublic.orgsStrikePassport')}
                </div>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <OrgAvatar name={org.legal_name} logoUrl={org.logo_url} />
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
                        {org.legal_name ?? t('passportPublic.unknownOrganization')}
                      </span>
                      <TypeBadge type={org.type} />
                    </div>
                    {dba && (
                      <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
                        {t('passport.doingBusinessAs')} {dba}
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

              <OrgCatalog listings={data.catalog} orgName={dba || org.legal_name} />
            </div>

            {/* RIGHT — sticky AI assessment panel */}
            <div
              className="reveal-stagger"
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
                      <CountUp value={data.bank_view_count_30d} />
                    </span>{' '}
                    {t('passportPublic.bankViewedThisSuffix', { plural: data.bank_view_count_30d === 1 ? '' : 's' })}
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
                      <CountUp value={data.org_view_count_30d} />
                    </span>{' '}
                    {t('passportPublic.orgViewedThisSuffix', { plural: data.org_view_count_30d === 1 ? '' : 's' })}
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
                          {t('passportPublic.networkMedianScore')}{' '}
                          <strong style={{ color: 'var(--ink)' }}>
                            {narrativeData.medians.passport_score != null
                              ? <CountUp value={narrativeData.medians.passport_score} />
                              : '—'}
                          </strong>{' '}
                          {t('passportPublic.acrossVerified', {
                            count: narrativeData.medians.peer_count,
                            type: org.type === 'anchor' ? t('passportPublic.buyers') : t('passportPublic.suppliers'),
                          })}
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
