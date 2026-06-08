'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import type { MarketplaceListing, MarketplaceOffer } from '@strike-scf/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  // Date-only strings (YYYY-MM-DD) are UTC midnight by spec; use local noon to avoid off-by-one
  const dt = d.includes('T') ? new Date(d) : new Date(`${d}T12:00:00`)
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const STATUS_CLASS: Record<string, string> = {
  active: 'badge-active', draft: 'badge-draft', matched: 'badge-funded',
  closed: 'badge-draft', expired: 'badge-draft', cancelled: 'badge-rejected',
}

const OFFER_STATUS_CLASS: Record<string, string> = {
  pending: 'badge-pending', accepted: 'badge-funded', countered: 'badge-offer',
  rejected: 'badge-rejected', withdrawn: 'badge-draft', expired: 'badge-draft',
}

const INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP']
const PAYMENT_TERMS = ['Net 30','Net 60','Net 90','LC at sight','30% advance + 70% BL','50/50','CAD','Open Account']

// ── Offer form ────────────────────────────────────────────────────────────────

interface OfferFormState {
  offered_price: string
  offered_quantity: string
  proposed_delivery_date: string
  proposed_incoterms: string
  proposed_payment_terms: string
  notes: string
}

function OfferForm({
  listing,
  onSubmit,
  submitting,
  error,
}: {
  listing: MarketplaceListing
  onSubmit: (f: OfferFormState) => void
  submitting: boolean
  error: string | null
}) {
  const [form, setForm] = useState<OfferFormState>({
    offered_price: listing.target_price?.toString() ?? '',
    offered_quantity: listing.quantity?.toString() ?? '',
    proposed_delivery_date: listing.delivery_deadline ?? '',
    proposed_incoterms: listing.incoterms ?? '',
    proposed_payment_terms: listing.payment_terms ?? '',
    notes: '',
  })

  function set(k: keyof OfferFormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">Submit Your Offer</div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-row-2">
          <div className="form-field">
            <label className="field-label">Offered Price ({listing.currency})</label>
            <input
              type="number" className="input" placeholder="0.00"
              value={form.offered_price}
              onChange={e => set('offered_price', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Quantity {listing.unit ? `(${listing.unit})` : ''}</label>
            <input
              type="number" className="input" placeholder={listing.quantity?.toString() ?? ''}
              value={form.offered_quantity}
              onChange={e => set('offered_quantity', e.target.value)}
            />
          </div>
        </div>

        <div className="form-row-2">
          <div className="form-field">
            <label className="field-label">Proposed Delivery Date</label>
            <input
              type="date" className="input"
              value={form.proposed_delivery_date}
              onChange={e => set('proposed_delivery_date', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Incoterms</label>
            <select
              className="input form-select"
              value={form.proposed_incoterms}
              onChange={e => set('proposed_incoterms', e.target.value)}
            >
              <option value="">Select Incoterms</option>
              {INCOTERMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="field-label">Payment Terms</label>
          <select
            className="input form-select"
            value={form.proposed_payment_terms}
            onChange={e => set('proposed_payment_terms', e.target.value)}
          >
            <option value="">Select Payment Terms</option>
            {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label className="field-label">Notes (optional)</label>
          <textarea
            className="input" rows={3}
            placeholder="Add any context, conditions, or details..."
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        {error && <p className="field-error">{error}</p>}

        <button
          className="btn btn-blue"
          disabled={submitting || !form.offered_price}
          onClick={() => onSubmit(form)}
        >
          {submitting ? 'Submitting…' : 'Submit Offer'}
        </button>
      </div>
    </div>
  )
}

// ── Counter form (inline, below the offer card) ──────────────────────────────

function CounterForm({
  offer,
  listing,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  offer: MarketplaceOffer
  listing: MarketplaceListing
  onSubmit: (f: OfferFormState) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}) {
  const [form, setForm] = useState<OfferFormState>({
    offered_price: offer.offered_price?.toString() ?? '',
    offered_quantity: offer.offered_quantity?.toString() ?? '',
    proposed_delivery_date: offer.proposed_delivery_date ?? '',
    proposed_incoterms: offer.proposed_incoterms ?? '',
    proposed_payment_terms: offer.proposed_payment_terms ?? '',
    notes: '',
  })

  function set(k: keyof OfferFormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  return (
    <div style={{ margin: '0 20px 16px', background: 'var(--offwhite)', border: '1px solid var(--border)', padding: 16 }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 12 }}>
        Counter Offer — Round {(offer.current_round ?? 1) + 1}
      </p>
      <div className="form-row-2" style={{ marginBottom: 10 }}>
        <div className="form-field">
          <label className="field-label">Counter Price ({listing.currency})</label>
          <input type="number" className="input" value={form.offered_price} onChange={e => set('offered_price', e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label">Quantity</label>
          <input type="number" className="input" value={form.offered_quantity} onChange={e => set('offered_quantity', e.target.value)} />
        </div>
      </div>
      <div className="form-row-2" style={{ marginBottom: 10 }}>
        <div className="form-field">
          <label className="field-label">Delivery Date</label>
          <input type="date" className="input" value={form.proposed_delivery_date} onChange={e => set('proposed_delivery_date', e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label">Incoterms</label>
          <select className="input form-select" value={form.proposed_incoterms} onChange={e => set('proposed_incoterms', e.target.value)}>
            <option value="">Select</option>
            {INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="form-field" style={{ marginBottom: 10 }}>
        <label className="field-label">Payment Terms</label>
        <select className="input form-select" value={form.proposed_payment_terms} onChange={e => set('proposed_payment_terms', e.target.value)}>
          <option value="">Select</option>
          {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-field" style={{ marginBottom: 12 }}>
        <label className="field-label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
      {error && <p className="field-error" style={{ marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-blue btn-sm" disabled={submitting || !form.offered_price} onClick={() => onSubmit(form)}>
          {submitting ? 'Sending…' : 'Send Counter'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Offer Card ────────────────────────────────────────────────────────────────

function OfferCard({
  item,
  listing,
  isListingOwner,
  isMyOffer,
  onAccept,
  onReject,
  onWithdraw,
  onCounterStart,
  counteringOfferId,
  onCounterSubmit,
  onCounterCancel,
  actionSubmitting,
  actionError,
}: {
  item: { offer: MarketplaceOffer; offeror_org: Record<string, unknown> | null; ai_analysis: string | null; ai_recommendation: string | null }
  listing: MarketplaceListing
  isListingOwner: boolean
  isMyOffer: boolean
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onWithdraw: (id: string) => void
  onCounterStart: (id: string) => void
  counteringOfferId: string | null
  onCounterSubmit: (id: string, f: OfferFormState) => void
  onCounterCancel: () => void
  actionSubmitting: boolean
  actionError: string | null
}) {
  const router = useRouter()
  const { offer, offeror_org, ai_analysis, ai_recommendation } = item
  const isInactive = ['withdrawn', 'rejected', 'expired'].includes(offer.status)
  const showActions = (isListingOwner || isMyOffer) && ['pending', 'countered'].includes(offer.status)
  const isCounting = counteringOfferId === offer.id
  const roomId = (offer.metadata?.room_id as string | undefined) ?? null

  // Turn-based counter logic: whoever received the last counter gets to respond.
  const rounds = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const isListingOwnerTurn = !lastRound || (lastRound as any).by_org_id === offer.from_org_id
  const isOfferorTurn = lastRound != null && (lastRound as any).by_org_id !== offer.from_org_id

  return (
    <div className="mp-offer-card" style={isInactive ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
      <div className="mp-offer-card-status">
        <span className={`badge ${OFFER_STATUS_CLASS[offer.status] ?? 'badge-draft'}`}>{offer.status}</span>
      </div>

      <div className="mp-offer-card-head">
        <div className="mp-offer-price-block">
          <span className="mp-offer-price-label">Offer Price</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mp-offer-price">{offer.offered_price?.toLocaleString() ?? '—'}</span>
            <span className="mp-offer-price-currency">{listing.currency}</span>
          </div>
          {offer.current_round > 1 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gray)', letterSpacing: '0.08em' }}>
              Round {offer.current_round}
            </span>
          )}
        </div>

        {offeror_org && (
          <div className="passport-mini" style={{ flex: 1, marginLeft: 'auto' }}>
            <div className="passport-mini-ring">
              <div className="passport-mini-ring-track" />
              <div className="passport-mini-ring-fill" />
              <span className="passport-mini-score">{(offeror_org.passport_score as number | null) ?? '—'}</span>
            </div>
            <div className="passport-mini-info">
              <div className="passport-mini-org">
                <button
                  className="passport-mini-org-name"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--gray-soft)', textUnderlineOffset: 2 }}
                  onClick={() => router.push(`/passport/${offeror_org.id as string}`)}
                >
                  {(offeror_org.doing_business_as as string | null) || (offeror_org.legal_name as string | null) || 'Unknown'}
                </button>
                <span className="passport-mini-type">{offeror_org.type as string}</span>
              </div>
              <div className="passport-mini-stats">
                <div className="passport-mini-stat">
                  <span className="passport-mini-stat-label">Trades</span>
                  <span className="passport-mini-stat-value">{(offeror_org.trade_count_total as number | null) ?? '—'}</span>
                </div>
                <div className="passport-mini-sep" />
                <div className="passport-mini-stat">
                  <span className="passport-mini-stat-label">Avg Pay</span>
                  <span className="passport-mini-stat-value">
                    {(offeror_org.avg_payment_days as number | null) != null ? `${offeror_org.avg_payment_days}d` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Trade terms pills */}
      <div className="mp-offer-terms-row">
        {offer.offered_quantity && <span className="mp-offer-term-pill">Qty: {offer.offered_quantity} {listing.unit ?? ''}</span>}
        {offer.proposed_incoterms && <span className="mp-offer-term-pill">{offer.proposed_incoterms}</span>}
        {offer.proposed_payment_terms && <span className="mp-offer-term-pill">{offer.proposed_payment_terms}</span>}
        {offer.proposed_delivery_date && <span className="mp-offer-term-pill">Delivery: {fmtDate(offer.proposed_delivery_date)}</span>}
      </div>

      {/* AI analysis strip */}
      {(ai_analysis || ai_recommendation) && (
        <div className="mp-offer-ai-strip">
          <div className="mp-offer-ai-label">Strike AI</div>
          <div className="mp-offer-ai-text">
            {ai_analysis} {ai_recommendation}
          </div>
        </div>
      )}

      {offer.notes && (
        <div style={{ padding: '0 20px 12px', fontSize: 13, color: 'var(--color-ink-2)', fontStyle: 'italic' }}>
          &ldquo;{offer.notes}&rdquo;
        </div>
      )}

      <div className="mp-offer-card-footer">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
          {timeAgo(offer.created_at)}
        </span>

        {roomId && (
          <button
            className="btn btn-sm btn-ghost"
            style={{ pointerEvents: 'auto' }}
            onClick={() => router.push(`/rooms/${roomId}`)}
          >
            Open Strike Room
          </button>
        )}

        {offer.status === 'accepted' && offer.deal_id && (
          <button
            className="btn btn-sm btn-blue"
            style={{ pointerEvents: 'auto' }}
            onClick={() => router.push(`/deals/${offer.deal_id}`)}
          >
            View Deal →
          </button>
        )}

        {showActions && (
          <div className="mp-offer-actions">
            {isListingOwner && offer.status === 'pending' && (
              <>
                <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>
                  Counter
                </button>
                <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onReject(offer.id)}>
                  Reject
                </button>
                <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>
                  Accept
                </button>
              </>
            )}
            {isListingOwner && offer.status === 'countered' && (
              <>
                {isListingOwnerTurn && (
                  <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>
                    Counter
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onReject(offer.id)}>
                  Reject
                </button>
                <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>
                  Accept Counter
                </button>
              </>
            )}
            {isMyOffer && offer.status === 'pending' && (
              <button className="btn btn-sm btn-danger" disabled={actionSubmitting} onClick={() => onWithdraw(offer.id)}>
                Withdraw
              </button>
            )}
            {isMyOffer && offer.status === 'countered' && (
              <>
                {isOfferorTurn && (
                  <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>
                    Counter
                  </button>
                )}
                <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>
                  Accept Counter
                </button>
                <button className="btn btn-sm btn-danger" disabled={actionSubmitting} onClick={() => onWithdraw(offer.id)}>
                  Withdraw
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {isCounting && (
        <CounterForm
          offer={offer}
          listing={listing}
          onSubmit={f => onCounterSubmit(offer.id, f)}
          onCancel={onCounterCancel}
          submitting={actionSubmitting}
          error={actionError}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface ListingDetailData {
  listing: MarketplaceListing
  poster_org: Record<string, unknown> | null
  offers: Array<{
    offer: MarketplaceOffer
    offeror_org: Record<string, unknown> | null
    ai_analysis: string | null
    ai_recommendation: string | null
  }>
  offer_count: number | null
  viewer_org_id: string | null
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const user = useUser()

  const [data, setData] = useState<ListingDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [offerSubmitting, setOfferSubmitting] = useState(false)
  const [offerError, setOfferError] = useState<string | null>(null)

  const [actionSubmitting, setActionSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [counteringOfferId, setCounteringOfferId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/marketplace/listings/${id}`)
      if (!res.ok) throw new Error('Failed to load listing')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Error loading listing')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime: re-fetch when offers change on this listing
  const realtimeRef = useRef<ReturnType<typeof createClient> | null>(null)
  useEffect(() => {
    const supabase = createClient()
    realtimeRef.current = supabase
    const channel = supabase
      .channel(`listing-offers:${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'marketplace_offers',
        filter: `listing_id=eq.${id}`,
      }, () => { fetchData() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, fetchData])

  async function handleSubmitOffer(form: OfferFormState) {
    if (!data) return
    setOfferSubmitting(true)
    setOfferError(null)
    try {
      const res = await fetch('/api/marketplace/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: id,
          offered_price: parseFloat(form.offered_price),
          offered_quantity: form.offered_quantity ? parseFloat(form.offered_quantity) : undefined,
          proposed_delivery_date: form.proposed_delivery_date || undefined,
          proposed_incoterms: form.proposed_incoterms || undefined,
          proposed_payment_terms: form.proposed_payment_terms || undefined,
          notes: form.notes || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to submit offer')
      await fetchData()
    } catch (e) {
      setOfferError(e instanceof Error ? e.message : 'Error submitting offer')
    } finally {
      setOfferSubmitting(false)
    }
  }

  async function handleAction(offerId: string, action: string, extra?: Partial<OfferFormState>) {
    setActionSubmitting(true)
    setActionError(null)
    try {
      const body: Record<string, unknown> = { action }
      if (extra?.offered_price) body.offered_price = parseFloat(extra.offered_price)
      if (extra?.offered_quantity) body.offered_quantity = parseFloat(extra.offered_quantity)
      if (extra?.proposed_delivery_date) body.proposed_delivery_date = extra.proposed_delivery_date
      if (extra?.proposed_incoterms) body.proposed_incoterms = extra.proposed_incoterms
      if (extra?.proposed_payment_terms) body.proposed_payment_terms = extra.proposed_payment_terms
      if (extra?.notes) body.notes = extra.notes

      const res = await fetch(`/api/marketplace/offers/${offerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Action failed')

      setCounteringOfferId(null)

      // If accepted, navigate to deal or room
      if (action === 'accept' && json.deal) {
        if (json.deal.room_id) {
          router.push(`/rooms/${json.deal.room_id}`)
          return
        }
        router.push(`/deals/${json.deal.id}`)
        return
      }

      await fetchData()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error performing action')
    } finally {
      setActionSubmitting(false)
    }
  }

  if (loading) {
    return (
      <>
        <Topbar crumbs={[
          { label: 'Strike Place', onClick: () => router.push('/marketplace') },
          { label: 'Listing' },
        ]} />
        <div className="page">
          <div className="mp-skeleton-card" style={{ height: 320 }} />
        </div>
      </>
    )
  }

  if (fetchError || !data) {
    return (
      <>
        <Topbar crumbs={[{ label: 'Strike Place', onClick: () => router.push('/marketplace') }, { label: 'Listing' }]} />
        <div className="page">
          <div className="mp-empty-state">
            <p className="mp-empty-title">Listing not found</p>
            <p className="mp-empty-sub">{fetchError ?? 'Unable to load this listing.'}</p>
          </div>
        </div>
      </>
    )
  }

  const { listing, poster_org, offers, offer_count, viewer_org_id } = data
  const isListingOwner = viewer_org_id === listing.org_id

  const deliveryPast = listing.delivery_deadline != null
    && listing.status === 'active'
    && new Date(listing.delivery_deadline) < new Date()
  const myOffer = offers.find(o => o.offer.from_org_id === viewer_org_id)
  const hasActiveOffer = !!myOffer && !['withdrawn', 'rejected', 'expired'].includes(myOffer.offer.status)
  const canSubmitOffer = !isListingOwner && !hasActiveOffer && listing.status === 'active' && !!viewer_org_id

  const typeBadgeClass = listing.listing_type === 'po_request' ? 'listing-type-po' : 'listing-type-product'
  const typeLabel = listing.listing_type === 'po_request' ? 'PO Request' : 'Product / Service'

  const priceBenchmark = listing.ai_price_benchmark

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Strike Place', onClick: () => router.push('/marketplace') },
          { label: listing.title },
        ]}
        actions={
          <div className="topbar-right">
            {isListingOwner && (
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>Your listing</span>
            )}
          </div>
        }
      />

      <div className="page mp-page">
        <div className="split-panel">

          {/* ── Main panel ── */}
          <div className="split-panel-main">

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`listing-type-badge ${typeBadgeClass}`}>{typeLabel}</span>
              {listing.category && (
                <span className="listing-category-tag">{listing.category}</span>
              )}
              <span className={`badge ${STATUS_CLASS[listing.status] ?? 'badge-draft'}`}>{listing.status}</span>
            </div>

            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', marginTop: 10 }}>
              {listing.title}
            </h1>

            {/* Trade terms card */}
            <div className="card">
              <div className="card-head">Trade Terms</div>
              <div style={{ padding: '8px 0' }}>
                <div className="kv-row">
                  <span className="k">Target Price</span>
                  <span className="v" style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {listing.target_price != null
                      ? listing.target_price.toLocaleString()
                      : '—'}&nbsp;
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--gray)', letterSpacing: '0.08em' }}>
                      {listing.currency}{listing.unit ? ` / ${listing.unit}` : ''}
                    </span>
                  </span>
                </div>
                {listing.quantity != null && (
                  <div className="kv-row">
                    <span className="k">Quantity</span>
                    <span className="v">{listing.quantity} {listing.unit ?? ''}</span>
                  </div>
                )}
                {listing.incoterms && (
                  <div className="kv-row">
                    <span className="k">Incoterms</span>
                    <span className="v">{listing.incoterms}</span>
                  </div>
                )}
                {listing.delivery_location && (
                  <div className="kv-row">
                    <span className="k">Delivery Location</span>
                    <span className="v plain">{listing.delivery_location}</span>
                  </div>
                )}
                {listing.delivery_deadline && (
                  <div className="kv-row">
                    <span className="k">Deadline</span>
                    <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {fmtDate(listing.delivery_deadline)}
                      {deliveryPast && (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--color-amber)',
                          background: 'rgba(217,119,6,0.08)',
                          border: '1px solid rgba(217,119,6,0.25)',
                          padding: '1px 6px',
                        }}>
                          Delivery date has passed
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {listing.payment_terms && (
                  <div className="kv-row">
                    <span className="k">Payment Terms</span>
                    <span className="v plain">{listing.payment_terms}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            {listing.description && (
              <div className="card">
                <div className="card-head">Description</div>
                <div className="card-body" style={{ fontSize: 14, color: 'var(--color-ink-2)', lineHeight: 1.65 }}>
                  {listing.description}
                </div>
              </div>
            )}

            {/* AI Summary */}
            {listing.ai_summary && (
              <div style={{ borderLeft: '3px solid var(--teal)', background: 'var(--teal-dim)', padding: '12px 16px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 4 }}>
                  Strike AI Summary
                </div>
                <div style={{ fontSize: 13, color: 'var(--teal)', lineHeight: 1.6, fontStyle: 'italic' }}>
                  {listing.ai_summary}
                </div>
              </div>
            )}

            {/* Offers section — listing owner sees all; others see only their own */}
            {isListingOwner ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                    Offers Received
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>
                    {offer_count ?? offers.length}
                  </span>
                </div>

                {offers.length === 0 && (
                  <div className="mp-empty-state">
                    <p className="mp-empty-title">No offers yet</p>
                    <p className="mp-empty-sub">Offers from network participants will appear here.</p>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {offers.map(item => (
                    <OfferCard
                      key={item.offer.id}
                      item={item}
                      listing={listing}
                      isListingOwner={isListingOwner}
                      isMyOffer={item.offer.from_org_id === viewer_org_id}
                      onAccept={id => handleAction(id, 'accept')}
                      onReject={id => handleAction(id, 'reject')}
                      onWithdraw={id => handleAction(id, 'withdraw')}
                      onCounterStart={id => {
                        setCounteringOfferId(prev => prev === id ? null : id)
                        setActionError(null)
                      }}
                      counteringOfferId={counteringOfferId}
                      onCounterSubmit={(offerId, form) => handleAction(offerId, 'counter', form)}
                      onCounterCancel={() => setCounteringOfferId(null)}
                      actionSubmitting={actionSubmitting}
                      actionError={actionError}
                    />
                  ))}
                </div>
              </div>
            ) : offers.length > 0 ? (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 12 }}>
                  Your Offer
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {offers.map(item => (
                    <OfferCard
                      key={item.offer.id}
                      item={item}
                      listing={listing}
                      isListingOwner={false}
                      isMyOffer={true}
                      onAccept={id => handleAction(id, 'accept')}
                      onReject={id => handleAction(id, 'reject')}
                      onWithdraw={id => handleAction(id, 'withdraw')}
                      onCounterStart={id => {
                        setCounteringOfferId(prev => prev === id ? null : id)
                        setActionError(null)
                      }}
                      counteringOfferId={counteringOfferId}
                      onCounterSubmit={(offerId, form) => handleAction(offerId, 'counter', form)}
                      onCounterCancel={() => setCounteringOfferId(null)}
                      actionSubmitting={actionSubmitting}
                      actionError={actionError}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Submit offer form — only if viewer can offer */}
            {canSubmitOffer && (
              <OfferForm
                listing={listing}
                onSubmit={handleSubmitOffer}
                submitting={offerSubmitting}
                error={offerError}
              />
            )}

            {/* If already has offer that's withdrawn/rejected, allow resubmit */}
            {!isListingOwner && hasActiveOffer === false && myOffer && listing.status === 'active' && canSubmitOffer === false && (
              <div className="alert alert-info" style={{ marginTop: 12 }}>
                <span className="alert-body" style={{ fontSize: 13 }}>
                  Your previous offer was {myOffer.offer.status}. You can submit a new one.
                </span>
              </div>
            )}
          </div>

          {/* ── Aside panel (sticky right) ── */}
          <aside className="split-panel-aside">

            {/* Poster passport */}
            {poster_org && (
              <div className="card">
                <div className="card-head">Listing Posted By</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 24px 16px' }}>
                  <PassportScoreRing
                    score={poster_org.passport_score as number | null}
                    size="md"
                    showLabel
                  />
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
                      {(poster_org.doing_business_as as string | null) || (poster_org.legal_name as string | null) || 'Unknown'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 2 }}>
                      {poster_org.type as string}
                    </div>
                  </div>
                </div>
                <div style={{ padding: '0 0 8px' }}>
                  <div className="kv-row">
                    <span className="k">Trades</span>
                    <span className="v">{(poster_org.trade_count_total as number | null) ?? '—'}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Volume</span>
                    <span className="v">{fmtPrice(poster_org.trade_volume_total as number | null)}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Avg Payment</span>
                    <span className="v">
                      {(poster_org.avg_payment_days as number | null) != null ? `${poster_org.avg_payment_days as number}d` : '—'}
                    </span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Dispute Rate</span>
                    <span className="v">
                      {(poster_org.dispute_rate_network as number | null) != null
                        ? `${((poster_org.dispute_rate_network as number) * 100).toFixed(1)}%`
                        : '—'}
                    </span>
                  </div>
                  {(poster_org.country_of_origin as string | null) && (
                    <div className="kv-row">
                      <span className="k">Country</span>
                      <span className="v plain">{poster_org.country_of_origin as string}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* About this listing */}
            <div className="card">
              <div className="card-head">About This Listing</div>
              <div style={{ padding: '0 0 8px' }}>
                <div className="kv-row">
                  <span className="k">Posted</span>
                  <span className="v">{fmtDate(listing.created_at)}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Views</span>
                  <span className="v">{listing.view_count ?? 0}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Offers</span>
                  <span className="v">{listing.offer_count ?? 0}</span>
                </div>
                {listing.expires_at && (
                  <div className="kv-row">
                    <span className="k">Expires</span>
                    <span className="v">{fmtDate(listing.expires_at)}</span>
                  </div>
                )}
              </div>
            </div>

          </aside>
        </div>
      </div>
    </>
  )
}
