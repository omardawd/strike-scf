'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { usePortal } from '@/lib/portal-context'
import type { FinancingRequest, FinancingRequestOffer, FinancingType } from '@strike-scf/types'

interface OrgPassport {
  id: string
  legal_name: string
  passport_score: number | null
  risk_tier: string | null
  trade_count_total: number
  avg_payment_days: number | null
  dispute_rate_network: number | null
}

interface DealContext {
  id: string
  agreed_price: number
  agreed_currency: string
  goods_description: string | null
  agreed_delivery_date: string | null
  agreed_incoterms: string | null
  total_value: number | null
  buyer_org_id: string
  supplier_org_id: string
}

interface OfferWithBank extends FinancingRequestOffer {
  bank?: { id: string; display_name: string; legal_name: string } | null
}

interface DetailData {
  request:          FinancingRequest
  deal:             DealContext | null
  buyer_passport:   OrgPassport | null
  supplier_passport: OrgPassport | null
  offers:           OfferWithBank[]
  my_offer?:        FinancingRequestOffer | null
  all_offers_count: number
}

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open:             'badge badge-active',
    offers_received:  'badge badge-offer',
    accepted:         'badge badge-funded',
    funded:           'badge badge-funded',
    expired:          'badge badge-rejected',
    cancelled:        'badge badge-rejected',
  }
  return map[status] ?? 'badge badge-draft'
}

function PassportMiniCard({ passport, label }: { passport: OrgPassport | null; label: string }) {
  if (!passport) return null
  const score = passport.passport_score
  const color = score == null ? 'var(--gray)' : score >= 70 ? 'var(--color-green)' : score >= 45 ? 'var(--color-amber)' : 'var(--color-red)'
  return (
    <div className="passport-mini" style={{ flex: 1 }}>
      <div className="passport-mini-ring">
        <div className="passport-mini-ring-track" />
        <span className="passport-mini-score" style={{ color }}>{score ?? '—'}</span>
      </div>
      <div className="passport-mini-info">
        <div className="passport-mini-org">
          <span className="passport-mini-org-name">{passport.legal_name}</span>
          <span className="passport-mini-type">{label}</span>
        </div>
        <div className="passport-mini-stats">
          {passport.trade_count_total > 0 && (
            <div className="passport-mini-stat">
              <span className="passport-mini-stat-label">Trades</span>
              <span className="passport-mini-stat-value">{passport.trade_count_total}</span>
            </div>
          )}
          {passport.avg_payment_days != null && (
            <>
              <div className="passport-mini-sep" />
              <div className="passport-mini-stat">
                <span className="passport-mini-stat-label">Avg Pay</span>
                <span className="passport-mini-stat-value">{passport.avg_payment_days}d</span>
              </div>
            </>
          )}
          {passport.dispute_rate_network != null && (
            <>
              <div className="passport-mini-sep" />
              <div className="passport-mini-stat">
                <span className="passport-mini-stat-label">Disputes</span>
                <span className="passport-mini-stat-value">{(passport.dispute_rate_network * 100).toFixed(1)}%</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const FINANCING_TYPES: FinancingType[] = ['reverse_factoring', 'invoice_factoring', 'po_financing', 'dynamic_discounting']

function BankOfferForm({
  request,
  existingOffer,
  onSubmit,
}: {
  request: FinancingRequest
  existingOffer: FinancingRequestOffer | null
  onSubmit: (offer: FinancingRequestOffer) => void
}) {
  const [editing, setEditing]   = useState(!existingOffer)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const [rateApr,    setRateApr]    = useState(existingOffer?.offered_rate_apr.toString()   ?? '')
  const [amount,     setAmount]     = useState(existingOffer?.offered_amount.toString()     ?? request.amount_requested.toString())
  const [tenor,      setTenor]      = useState(existingOffer?.offered_tenor_days.toString() ?? (request.preferred_tenor_days ?? 90).toString())
  const [structure,  setStructure]  = useState<FinancingType>(existingOffer?.structure_type ?? (request.financing_type ?? 'invoice_factoring'))
  const [conditions, setConditions] = useState(existingOffer?.conditions ?? '')
  const [notes,      setNotes]      = useState(existingOffer?.notes ?? '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/marketplace/financing/${request.id}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id:         request.id,
          offered_rate_apr:   parseFloat(rateApr),
          offered_amount:     parseFloat(amount),
          offered_tenor_days: parseInt(tenor),
          structure_type:     structure,
          conditions:         conditions || undefined,
          notes:              notes || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Submission failed'); return }
      onSubmit(json.offer)
      setEditing(false)
    } finally {
      setLoading(false)
    }
  }

  if (!editing && existingOffer) {
    return (
      <div className="card">
        <div className="card-head">
          Your Offer
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Offer</button>
        </div>
        <div className="kv-list">
          <div className="kv-row">
            <span className="k">Rate APR</span>
            <span className="v" style={{ color: 'var(--color-green)', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>
              {existingOffer.offered_rate_apr}%
            </span>
          </div>
          <div className="kv-row">
            <span className="k">Amount</span>
            <span className="v">{fmt(existingOffer.offered_amount, request.currency)}</span>
          </div>
          <div className="kv-row">
            <span className="k">Tenor</span>
            <span className="v">{existingOffer.offered_tenor_days}d</span>
          </div>
          <div className="kv-row">
            <span className="k">Structure</span>
            <span className="v plain">{existingOffer.structure_type.replace(/_/g, ' ')}</span>
          </div>
          {existingOffer.conditions && (
            <div className="kv-row">
              <span className="k">Conditions</span>
              <span className="v plain" style={{ fontSize: 12 }}>{existingOffer.conditions}</span>
            </div>
          )}
          {existingOffer.ai_score != null && (
            <div className="kv-row">
              <span className="k">AI Score</span>
              <span className="v">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', maxWidth: 80 }}>
                    <div style={{ width: `${existingOffer.ai_score}%`, height: '100%', background: 'var(--color-green)' }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{existingOffer.ai_score}/100</span>
                </div>
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-head">{existingOffer ? 'Edit Your Offer' : 'Submit an Offer'}</div>
      <form onSubmit={handleSubmit}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-row-2">
            <div className="form-field">
              <label className="field-label">Rate APR (%)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                required
                value={rateApr}
                onChange={e => setRateApr(e.target.value)}
                placeholder="e.g. 4.50"
              />
            </div>
            <div className="form-field">
              <label className="field-label">Offered Amount ({request.currency})</label>
              <input
                className="input"
                type="number"
                min="0"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-field">
              <label className="field-label">Tenor (days)</label>
              <input
                className="input"
                type="number"
                min="1"
                required
                value={tenor}
                onChange={e => setTenor(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="field-label">Structure Type</label>
              <select
                className="input form-select"
                value={structure}
                onChange={e => setStructure(e.target.value as FinancingType)}
                required
              >
                {FINANCING_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label className="field-label">Conditions</label>
            <textarea
              className="input"
              rows={2}
              value={conditions}
              onChange={e => setConditions(e.target.value)}
              placeholder="Any specific conditions attached to this offer…"
            />
          </div>

          <div className="form-field">
            <label className="field-label">Notes</label>
            <textarea
              className="input"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes or additional context…"
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-blue" disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Submitting…' : existingOffer ? 'Update Offer' : 'Submit Offer'}
            </button>
            {existingOffer && (
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

function OrgOffersList({
  offers,
  request,
  onAccept,
  accepting,
}: {
  offers:   OfferWithBank[]
  request:  FinancingRequest
  onAccept: (offerId: string) => void
  accepting: string | null
}) {
  const sorted = [...offers].sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0))
  const topOfferId = sorted[0]?.id

  if (offers.length === 0) {
    return (
      <div className="mp-empty-state">
        <div className="mp-empty-title">No offers yet</div>
        <div className="mp-empty-sub">Banks will submit offers once they review your request.</div>
      </div>
    )
  }

  return (
    <div className="mp-listing-feed">
      {sorted.map(offer => {
        const isTop      = offer.id === topOfferId && offers.length > 1
        const isAccepted = offer.status === 'accepted'
        const canAccept  = offer.status === 'pending' && request.status !== 'accepted'

        return (
          <div
            key={offer.id}
            className="mp-offer-card"
            style={isAccepted ? { borderColor: 'var(--color-green)', borderWidth: 2 } : undefined}
          >
            {isTop && (
              <div style={{
                background: 'var(--teal-dim)',
                borderBottom: '1px solid var(--teal)',
                padding: '6px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  ✦ Strike AI Recommends
                </span>
                {offer.ai_score_reasoning && (
                  <span style={{ fontSize: 11.5, color: 'var(--teal)', fontStyle: 'italic' }}>
                    — {offer.ai_score_reasoning}
                  </span>
                )}
              </div>
            )}

            <div className="mp-offer-card-head">
              <div className="mp-offer-price-block">
                <span className="mp-offer-price-label">Rate APR</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    className="mp-offer-price"
                    style={{ fontFamily: 'var(--font-display)', color: isAccepted ? 'var(--color-green)' : 'var(--ink)' }}
                  >
                    {offer.offered_rate_apr}%
                  </span>
                </div>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                  {offer.bank?.display_name ?? 'Bank'}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mp-offer-term-pill">{fmt(offer.offered_amount, request.currency)}</span>
                  <span className="mp-offer-term-pill">{offer.offered_tenor_days}d tenor</span>
                  <span className="mp-offer-term-pill">{offer.structure_type.replace(/_/g, ' ')}</span>
                </div>
              </div>

              <div className="mp-offer-card-status">
                <span className={
                  offer.status === 'accepted' ? 'badge badge-funded' :
                  offer.status === 'rejected' ? 'badge badge-rejected' :
                  'badge badge-pending'
                }>{offer.status}</span>
              </div>
            </div>

            {offer.conditions && (
              <div style={{ padding: '0 20px 10px', fontSize: 12.5, color: 'var(--gray)', lineHeight: 1.5 }}>
                {offer.conditions}
              </div>
            )}

            {offer.ai_score != null && (
              <div style={{ padding: '0 20px 12px' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gray)', marginBottom: 4 }}>
                  AI Score
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)' }}>
                    <div style={{
                      width: `${offer.ai_score}%`,
                      height: '100%',
                      background: offer.ai_score >= 70 ? 'var(--color-green)' : offer.ai_score >= 45 ? 'var(--color-amber)' : 'var(--color-red)',
                      transition: 'width 300ms ease',
                    }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 40, textAlign: 'right' }}>
                    {offer.ai_score}/100
                  </span>
                </div>
              </div>
            )}

            <div className="mp-offer-card-footer">
              <span style={{ fontSize: 11, color: 'var(--gray-soft)', fontFamily: 'var(--font-mono)' }}>
                {new Date(offer.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <div className="mp-offer-actions">
                {canAccept && (
                  <button
                    className="btn btn-blue btn-sm"
                    disabled={accepting !== null}
                    onClick={() => onAccept(offer.id)}
                  >
                    {accepting === offer.id ? 'Accepting…' : 'Accept This Offer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function FinancingDetailPage() {
  const params   = useParams()
  const router   = useRouter()
  const portal   = usePortal()
  const id       = params?.id as string
  const isBank   = portal === 'bank'

  const [data,      setData]      = useState<DetailData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/marketplace/financing/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load'); setLoading(false) })
  }, [id])

  useEffect(() => { load() }, [load])

  async function acceptOffer(offerId: string) {
    setAccepting(offerId)
    try {
      const res = await fetch(`/api/marketplace/financing/${id}/accept`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer_id: offerId }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Failed to accept offer'); return }
      load()
    } finally {
      setAccepting(null)
    }
  }

  function handleOfferSubmit(offer: FinancingRequestOffer) {
    setData(prev => {
      if (!prev) return prev
      const exists = prev.offers.find(o => o.id === offer.id)
      return {
        ...prev,
        my_offer: offer,
        offers: exists
          ? prev.offers.map(o => o.id === offer.id ? { ...o, ...offer } : o)
          : [...prev.offers, offer],
      }
    })
  }

  if (loading) {
    return (
      <>
        <Topbar crumbs={[
          { label: 'Financing', onClick: () => router.push('/marketplace/financing') },
          { label: 'Loading…' },
        ]} />
        <div className="page" style={{ maxWidth: 1280 }}>
          <div className="split-panel">
            <div className="split-panel-main">
              {[0, 1].map(i => <div key={i} className="card" style={{ height: 180, animation: 'skeleton-pulse 1.8s ease infinite' }} />)}
            </div>
            <div className="split-panel-aside">
              <div className="card" style={{ height: 240, animation: 'skeleton-pulse 1.8s ease infinite' }} />
            </div>
          </div>
        </div>
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <Topbar crumbs={[
          { label: 'Financing', onClick: () => router.push('/marketplace/financing') },
          { label: 'Error' },
        ]} />
        <div className="page"><div className="alert alert-error">{error ?? 'Not found'}</div></div>
      </>
    )
  }

  const { request, deal, buyer_passport, supplier_passport, offers, all_offers_count } = data
  const myOffer   = isBank ? (data.my_offer ?? null) : null
  const days      = daysUntil(request.expires_at)
  const currency  = request.currency ?? 'USD'

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Financing', onClick: () => router.push('/marketplace/financing') },
          { label: `Request #${id.slice(0, 8).toUpperCase()}` },
        ]}
      />

      <div className="page" style={{ maxWidth: 1280 }}>
        {/* Request header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-id-title">
            <span className="id-text">{fmt(request.amount_requested, currency)}</span>
            <span className={statusBadge(request.status)}>{request.status.replace(/_/g, ' ')}</span>
            {request.financing_type && (
              <span className="badge badge-draft">{request.financing_type.replace(/_/g, ' ')}</span>
            )}
          </div>
          <p className="subtitle" style={{ marginTop: 4 }}>
            Structure: {request.structure_type}
            {request.preferred_tenor_days && ` · ${request.preferred_tenor_days}d preferred tenor`}
            {request.preferred_rate_max && ` · Max rate ${request.preferred_rate_max}%`}
          </p>
        </div>

        <div className="split-panel">
          {/* ── Main panel ── */}
          <div className="split-panel-main">

            {/* Deal context */}
            {deal && (
              <div className="card">
                <div className="card-head">Deal Context</div>
                <div className="kv-list">
                  <div className="kv-row">
                    <span className="k">Goods</span>
                    <span className="v plain">{deal.goods_description ?? '—'}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Deal Value</span>
                    <span className="v" style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
                      {fmt(deal.total_value ?? deal.agreed_price, deal.agreed_currency)}
                    </span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Delivery Date</span>
                    <span className="v">{fmtDate(deal.agreed_delivery_date)}</span>
                  </div>
                  {deal.agreed_incoterms && (
                    <div className="kv-row">
                      <span className="k">Incoterms</span>
                      <span className="v">{deal.agreed_incoterms}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI context block */}
            {(request.ai_market_context || request.ai_risk_assessment) && (
              <div style={{
                borderLeft: '3px solid var(--teal)',
                background: 'var(--teal-dim)',
                padding: '16px 20px',
                display: 'flex',
                gap: 12,
              }}>
                <div style={{ fontSize: 16, color: 'var(--teal)', flexShrink: 0, marginTop: 2 }}>✦</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal)' }}>
                    Strike AI · Market Intelligence
                  </span>
                  {request.ai_market_context && (
                    <p style={{ fontSize: 13.5, color: 'var(--teal)', lineHeight: 1.6, margin: 0 }}>
                      {request.ai_market_context}
                    </p>
                  )}
                  {request.ai_risk_assessment && (
                    <p style={{ fontSize: 13, color: 'var(--teal)', lineHeight: 1.55, margin: '4px 0 0', opacity: 0.9 }}>
                      {request.ai_risk_assessment}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Org: competing offers */}
            {!isBank && (
              <div className="card">
                <div className="card-head">
                  Competing Offers
                  <span style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, color: 'var(--gray)' }}>
                    {all_offers_count} total
                  </span>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  <OrgOffersList
                    offers={offers}
                    request={request}
                    onAccept={acceptOffer}
                    accepting={accepting}
                  />
                </div>
              </div>
            )}

            {/* Bank: full deal context + offer form */}
            {isBank && (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <PassportMiniCard passport={buyer_passport}    label="Buyer" />
                  <PassportMiniCard passport={supplier_passport} label="Supplier" />
                </div>

                <BankOfferForm
                  request={request}
                  existingOffer={myOffer}
                  onSubmit={handleOfferSubmit}
                />
              </>
            )}
          </div>

          {/* ── Aside ── */}
          <div className="split-panel-aside">

            {/* Buyer passport */}
            {buyer_passport && (
              <div className="card">
                <div className="card-head">Buyer</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <PassportScoreRing score={buyer_passport.passport_score} size="sm" showLabel />
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', textAlign: 'center' }}>
                    {buyer_passport.legal_name}
                  </div>
                  <Link
                    href={`/passport/${buyer_passport.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    View Passport
                  </Link>
                </div>
              </div>
            )}

            {/* Supplier passport */}
            {supplier_passport && (
              <div className="card">
                <div className="card-head">Supplier</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <PassportScoreRing score={supplier_passport.passport_score} size="sm" showLabel />
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', textAlign: 'center' }}>
                    {supplier_passport.legal_name}
                  </div>
                  <Link
                    href={`/passport/${supplier_passport.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    View Passport
                  </Link>
                </div>
              </div>
            )}

            {/* Request stats */}
            <div className="card">
              <div className="card-head">Request Details</div>
              <div className="kv-list">
                <div className="kv-row">
                  <span className="k">Amount</span>
                  <span className="v">{fmt(request.amount_requested, currency)}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Preferred Tenor</span>
                  <span className="v">{request.preferred_tenor_days ? `${request.preferred_tenor_days}d` : '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Max Rate</span>
                  <span className="v">{request.preferred_rate_max ? `${request.preferred_rate_max}%` : '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Offers</span>
                  <span className="v">{all_offers_count}</span>
                </div>
                {days != null && (
                  <div className="kv-row">
                    <span className="k">Expires In</span>
                    <span className={`days-pill ${days > 7 ? 'days-green' : days > 2 ? 'days-amber' : 'days-red'}`}>
                      {days}d
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
