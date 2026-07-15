'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { Topbar, NotifBell } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'

interface OrgMini {
  id: string
  legal_name: string | null
  doing_business_as: string | null
  type: string | null
  passport_score: number | null
  risk_tier: string | null
  country_of_origin: string | null
}

interface DealMini {
  id: string
  status: string
  buyer_org_id: string
  supplier_org_id: string
  agreed_price: number
  agreed_currency: string
  goods_description: string | null
  completed_at: string | null
}

type CategoryKey = 'payment_speed' | 'communication' | 'accuracy' | 'reliability'
const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'payment_speed',  label: 'Payment Speed' },
  { key: 'communication', label: 'Communication' },
  { key: 'accuracy',      label: 'Accuracy' },
  { key: 'reliability',   label: 'Reliability' },
]

function StarRow({
  value,
  onChange,
  label,
  size = 28,
}: {
  value: number
  onChange: (v: number) => void
  label?: string
  size?: number
}) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && (
        <span style={{ fontSize: 13, color: 'var(--ink)', width: 140, flexShrink: 0 }}>
          {label}
        </span>
      )}
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(star)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: size,
              lineHeight: 1,
              color: (hover || value) >= star ? '#C9A84C' : 'var(--border-strong)',
              padding: '0 2px',
              transition: 'color 0.1s',
            }}
          >
            ★
          </button>
        ))}
      </div>
      {value > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--gray)',
            marginLeft: 4,
          }}
        >
          {value}/5
        </span>
      )}
    </div>
  )
}

function PassportMini({ org }: { org: OrgMini }) {
  const isBuyer = org.type === 'anchor'
  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          background: 'var(--gold-dim)',
          color: '#C9A84C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 17,
          flexShrink: 0,
        }}
      >
        {((org.legal_name ?? '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            {org.legal_name ?? 'Unknown organization'}
          </span>
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
        </div>
        {org.doing_business_as && org.doing_business_as !== org.legal_name && (
          <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
            doing business as {org.doing_business_as}
          </div>
        )}
        {org.country_of_origin && (
          <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
            {org.country_of_origin}
          </div>
        )}
      </div>
      <PassportScoreRing score={org.passport_score} size="md" showLabel />
    </div>
  )
}

function fmtCurrency(v: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(v)
}

export default function ReviewFormPage() {
  const params  = useParams()
  const router  = useRouter()
  const user    = useUser()
  const reviewedOrgId = params.org_id as string

  const [reviewedOrg, setReviewedOrg]   = useState<OrgMini | null>(null)
  const [deal, setDeal]                 = useState<DealMini | null>(null)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [loadingPage, setLoadingPage]   = useState(true)

  // Form state
  const [rating,          setRating]          = useState(0)
  const [categoryScores,  setCategoryScores]  = useState<Record<CategoryKey, number>>({
    payment_speed: 0, communication: 0, accuracy: 0, reliability: 0,
  })
  const [comment,   setComment]   = useState('')
  const [isPublic,  setIsPublic]  = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadingPage(true)
    setLoadError(null)
    try {
      // Load passport mini for target org
      const passportRes = await fetch(`/api/passport/${reviewedOrgId}`)
      if (!passportRes.ok) {
        const b = await passportRes.json().catch(() => ({}))
        setLoadError((b as { error?: string }).error ?? 'Could not load organization')
        return
      }
      const passportData = await passportRes.json()
      const o = passportData.organization
      setReviewedOrg({
        id:              o.id,
        legal_name:      o.legal_name,
        doing_business_as: o.doing_business_as,
        type:            o.type,
        passport_score:  o.passport_score,
        risk_tier:       o.risk_tier,
        country_of_origin: o.country_of_origin,
      })

      // Find a completed deal between current org and target org
      const dealsRes = await fetch('/api/deals?status=completed')
      if (!dealsRes.ok) {
        setLoadError('Failed to load deals')
        return
      }
      const dealsData = await dealsRes.json()
      const matchingDeal = (dealsData.deals ?? []).find(
        (d: DealMini & { counterparty?: { id: string } }) =>
          d.counterparty?.id === reviewedOrgId
      )
      if (!matchingDeal) {
        setLoadError('No completed deal found with this organization. A review can only be submitted after a deal is completed.')
        return
      }
      setDeal(matchingDeal)
    } catch {
      setLoadError('Failed to load data')
    } finally {
      setLoadingPage(false)
    }
  }, [reviewedOrgId])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0) { setSubmitError('Please select an overall rating'); return }
    if (!deal) return

    setSubmitting(true)
    setSubmitError(null)

    const allCatsSet = Object.values(categoryScores).every((v) => v > 0)

    try {
      const res = await fetch('/api/passport/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewed_org_id: reviewedOrgId,
          deal_id: deal.id,
          rating,
          category_scores: allCatsSet ? categoryScores : null,
          comment: comment.trim() || undefined,
          is_public: isPublic,
        }),
      })

      if (res.status === 409) {
        setSubmitError('You have already submitted a review for this deal.')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSubmitError((body as { error?: string }).error ?? 'Submission failed')
        return
      }

      router.push(`/passport/${reviewedOrgId}?reviewed=true`)
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!user?.org_id) return null

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Strike' },
          { label: 'My Passport', onClick: () => router.push('/passport') },
          { label: 'Write Review' },
        ]}
        actions={<NotifBell />}
      />
      <div
        className="page"
        data-page-name="Write Passport Review"
        data-ai-context={JSON.stringify({
          reviewed_org_id: reviewedOrgId,
          reviewed_org_name: reviewedOrg?.legal_name ?? null,
          reviewed_org_passport_score: reviewedOrg?.passport_score ?? null,
          deal_id: deal?.id ?? null,
          load_error: loadError,
        })}
      >
        <div className="page-header">
          <h1 className="t-page-title">Write a Review</h1>
          <div className="subtitle">Share your experience trading with this organization.</div>
        </div>

        {loadingPage ? (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray)' }}>
              Loading…
            </div>
          </div>
        ) : loadError ? (
          <div className="card" style={{ padding: 24 }}>
            <div className="alert alert-warn">
              <div className="alert-body">{loadError}</div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => router.back()}
              >
                Go back
              </button>
            </div>
          </div>
        ) : reviewedOrg && deal ? (
          <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Target org passport mini */}
            <PassportMini org={reviewedOrg} />

            {/* Deal context */}
            <div className="card">
              <div className="card-head">Deal being reviewed</div>
              <div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--gray)',
                      marginBottom: 4,
                    }}
                  >
                    Value
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600 }}>
                    {fmtCurrency(deal.agreed_price, deal.agreed_currency)}
                  </div>
                </div>
                {deal.goods_description && (
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--gray)',
                        marginBottom: 4,
                      }}
                    >
                      Goods / Services
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {deal.goods_description}
                    </div>
                  </div>
                )}
                {deal.completed_at && (
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--gray)',
                        marginBottom: 4,
                      }}
                    >
                      Completed
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                      {new Date(deal.completed_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Review form */}
            <form onSubmit={handleSubmit}>
              <div className="card">
                <div className="card-head">Your review</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Overall star rating */}
                  <div>
                    <div className="field-label" style={{ marginBottom: 10 }}>Overall rating *</div>
                    <StarRow value={rating} onChange={setRating} size={32} />
                    {rating === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
                        Click a star to rate
                      </div>
                    )}
                  </div>

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  {/* Category scores */}
                  <div>
                    <div className="field-label" style={{ marginBottom: 12 }}>
                      Category ratings{' '}
                      <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(optional)</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {CATEGORIES.map(({ key, label }) => (
                        <StarRow
                          key={key}
                          label={label}
                          value={categoryScores[key]}
                          onChange={(v) =>
                            setCategoryScores((prev) => ({ ...prev, [key]: v }))
                          }
                          size={22}
                        />
                      ))}
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'var(--border)' }} />

                  {/* Comment */}
                  <div>
                    <label className="field-label" htmlFor="review-comment">
                      Comment{' '}
                      <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(optional)</span>
                    </label>
                    <textarea
                      id="review-comment"
                      className="input"
                      rows={4}
                      placeholder="Share your experience with this organization…"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={500}
                      style={{ marginTop: 6, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4, textAlign: 'right' }}>
                      {comment.length}/500
                    </div>
                  </div>

                  {/* Visibility toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPublic}
                      onClick={() => setIsPublic((v) => !v)}
                      style={{
                        width: 40,
                        height: 22,
                        padding: 2,
                        border: '1px solid var(--border-strong)',
                        background: isPublic ? 'var(--blue)' : 'var(--offwhite)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        justifyContent: isPublic ? 'flex-end' : 'flex-start',
                        transition: 'background .15s',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          background: isPublic ? '#fff' : 'var(--gray)',
                        }}
                      />
                    </button>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                        {isPublic ? 'Public review' : 'Private review'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 1 }}>
                        {isPublic
                          ? 'Your organization name will be visible alongside this review'
                          : 'Only the score will be visible; your identity will be hidden'}
                      </div>
                    </div>
                  </div>

                  {submitError && (
                    <div className="alert alert-error">
                      <div className="alert-body">{submitError}</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="submit"
                      className="btn btn-blue"
                      disabled={submitting || rating === 0}
                    >
                      {submitting ? 'Submitting…' : 'Submit review'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => router.back()}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </>
  )
}
