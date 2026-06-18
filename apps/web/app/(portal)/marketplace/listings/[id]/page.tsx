'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import type { MarketplaceListing, MarketplaceOffer } from '@strike-scf/types'
import { isShippingCostRequired } from '@/lib/deals/fees'

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

interface BankAccount {
  id: string
  nickname: string
  bank_name: string
  account_holder_name: string
  account_number: string
  is_primary: boolean
}

interface OfferItem {
  listing_item_id: string
  name: string
  description: string
  unit: string
  quantity: string
  unit_price: string
}

interface OfferFormState {
  offer_items: OfferItem[]
  proposed_delivery_date: string
  proposed_incoterms: string
  proposed_payment_terms: string
  shipping_cost: string
  notes: string
  bank_account_id?: string
}

function computeOfferTotal(items: OfferItem[]): number {
  return items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity)
    const price = parseFloat(item.unit_price)
    return sum + (isNaN(qty) || isNaN(price) ? 0 : qty * price)
  }, 0)
}

function initOfferItemsFromListing(listingLineItems: any[]): OfferItem[] {
  return listingLineItems.map(li => ({
    listing_item_id: li.id,
    name: li.name ?? '',
    description: li.description ?? '',
    unit: li.unit ?? 'MT',
    quantity: li.quantity != null ? String(li.quantity) : '',
    unit_price: '',
  }))
}

function ItemPricingTable({
  items,
  currency,
  onChange,
}: {
  items: OfferItem[]
  currency: string
  onChange: (items: OfferItem[]) => void
}) {
  const total = computeOfferTotal(items)
  const updateItem = (idx: number, field: 'quantity' | 'unit_price', val: string) => {
    const next = items.map((it, i) => i === idx ? { ...it, [field]: val } : it)
    onChange(next)
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px', gap: 6, padding: '6px 0', fontSize: 11, fontFamily: 'var(--font-body)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
        <span>Item</span><span>Qty</span><span>Unit</span><span>Price / Unit</span>
      </div>
      {items.map((item, idx) => (
        <div key={item.listing_item_id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{item.name}</div>
            {item.description && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{item.description}</div>}
          </div>
          <input
            type="number" className="input" min="0"
            style={{ fontSize: 13, padding: '5px 8px' }}
            placeholder="0"
            value={item.quantity}
            onChange={e => updateItem(idx, 'quantity', e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--gray)', padding: '5px 0' }}>{item.unit}</div>
          <input
            type="number" className="input" min="0" step="0.01"
            style={{ fontSize: 13, padding: '5px 8px' }}
            placeholder="0.00"
            value={item.unit_price}
            onChange={e => updateItem(idx, 'unit_price', e.target.value)}
          />
        </div>
      ))}
      {total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0 0', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, color: 'var(--gray)' }}>Total Offer</span>
          <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
            {total.toLocaleString()}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--gray)' }}>{currency}</span>
        </div>
      )}
    </div>
  )
}

function OfferForm({
  listing,
  listingLineItems,
  onSubmit,
  submitting,
  error,
  bankAccounts,
}: {
  listing: MarketplaceListing
  listingLineItems: any[]
  onSubmit: (f: OfferFormState) => void
  submitting: boolean
  error: string | null
  bankAccounts: BankAccount[]
}) {
  const isPORequest = listing.listing_type === 'po_request'
  const primaryAcct = bankAccounts.find(a => a.is_primary) ?? bankAccounts[0]
  const hasItems = listingLineItems.length > 0

  const [form, setForm] = useState<OfferFormState>({
    offer_items: initOfferItemsFromListing(listingLineItems),
    proposed_delivery_date: listing.delivery_deadline ?? '',
    proposed_incoterms: listing.incoterms ?? '',
    proposed_payment_terms: listing.payment_terms ?? '',
    shipping_cost: listing.shipping_cost != null ? String(listing.shipping_cost) : '',
    notes: '',
    bank_account_id: primaryAcct?.id ?? '',
  })

  // po_request: the offeror IS the supplier — they must specify shipping cost
  // when the proposed incoterm puts main carriage on the seller.
  const shippingCostRequired = isPORequest && isShippingCostRequired(form.proposed_incoterms)

  const total = computeOfferTotal(form.offer_items)
  const canSubmit = (!hasItems || total > 0) && (!isPORequest || !!form.bank_account_id) && (!shippingCostRequired || !!form.shipping_cost)

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">Submit Your Offer</div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Per-item pricing table */}
        {hasItems && (
          <div className="form-field">
            <label className="field-label">Your Pricing per Item</label>
            <ItemPricingTable
              items={form.offer_items}
              currency={listing.currency ?? 'USD'}
              onChange={items => setForm(prev => ({ ...prev, offer_items: items }))}
            />
          </div>
        )}

        <div className="form-row-2">
          <div className="form-field">
            <label className="field-label">Proposed Delivery Date</label>
            <input type="date" className="input" value={form.proposed_delivery_date}
              onChange={e => setForm(p => ({ ...p, proposed_delivery_date: e.target.value }))} />
          </div>
          <div className="form-field">
            <label className="field-label">Incoterms</label>
            <select className="input form-select" value={form.proposed_incoterms}
              onChange={e => setForm(p => ({ ...p, proposed_incoterms: e.target.value }))}>
              <option value="">Select Incoterms</option>
              {INCOTERMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {shippingCostRequired && (
          <div className="form-field">
            <label className="field-label">
              Shipping Cost ({listing.currency ?? 'USD'})
              <span style={{ color: 'var(--color-red)', marginLeft: 3 }}>*</span>
            </label>
            <input type="number" className="input" min="0" step="0.01" value={form.shipping_cost}
              onChange={e => setForm(p => ({ ...p, shipping_cost: e.target.value }))} placeholder="0.00" />
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
              Required for {form.proposed_incoterms} — you arrange and pay for shipping under this incoterm.
            </div>
          </div>
        )}

        <div className="form-field">
          <label className="field-label">Payment Terms</label>
          <select className="input form-select" value={form.proposed_payment_terms}
            onChange={e => setForm(p => ({ ...p, proposed_payment_terms: e.target.value }))}>
            <option value="">Select Payment Terms</option>
            {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        {isPORequest && (
          <div className="form-field">
            <label className="field-label">
              Payment Receiving Account
              <span style={{ color: 'var(--color-red)', marginLeft: 3 }}>*</span>
            </label>
            {bankAccounts.length === 0 ? (
              <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.25)', fontSize: 13, color: '#92400e' }}>
                You have no bank accounts set up.{' '}
                <a href="/settings#bank-accounts" target="_blank" style={{ color: 'var(--blue)', fontWeight: 600 }}>Add one in Settings</a>{' '}before submitting.
              </div>
            ) : (
              <select className="input form-select" value={form.bank_account_id}
                onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))}>
                <option value="">Select bank account to receive payment</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nickname || a.bank_name} — {a.account_holder_name} (...{a.account_number.slice(-4)})
                    {a.is_primary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
            )}
            <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>
              The buyer will pay to this account after delivery confirmation.
            </p>
          </div>
        )}

        <div className="form-field">
          <label className="field-label">Notes (optional)</label>
          <textarea className="input" rows={3} placeholder="Add any context, conditions, or details..."
            value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>

        {error && <p className="field-error">{error}</p>}

        <button className="btn btn-blue" disabled={submitting || !canSubmit} onClick={() => onSubmit(form)}>
          {submitting ? 'Submitting…' : `Submit Offer${total > 0 ? ` — ${total.toLocaleString()} ${listing.currency ?? ''}` : ''}`}
        </button>
      </div>
    </div>
  )
}

// ── Counter form (inline, below the offer card) ──────────────────────────────

function CounterForm({
  offer,
  listing,
  listingLineItems,
  showShippingCost,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  offer: MarketplaceOffer
  listing: MarketplaceListing
  listingLineItems: any[]
  showShippingCost: boolean
  onSubmit: (f: OfferFormState) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}) {
  const rounds = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds.length > 0 ? (rounds[rounds.length - 1] as any) : null
  const prevItems: any[] = lastRound?.offer_items ?? []

  // Build initial offer_items: use previous round's items if available, else listing items
  const initItems: OfferItem[] = listingLineItems.length > 0
    ? listingLineItems.map(li => {
        const prev = prevItems.find((p: any) => p.listing_item_id === li.id)
        return {
          listing_item_id: li.id,
          name: li.name ?? '',
          description: li.description ?? '',
          unit: li.unit ?? 'MT',
          quantity: prev?.quantity != null ? String(prev.quantity) : (li.quantity != null ? String(li.quantity) : ''),
          unit_price: prev?.unit_price != null ? String(prev.unit_price) : '',
        }
      })
    : []

  const [form, setForm] = useState<OfferFormState>({
    offer_items: initItems,
    proposed_delivery_date: offer.proposed_delivery_date ?? '',
    proposed_incoterms: offer.proposed_incoterms ?? '',
    proposed_payment_terms: offer.proposed_payment_terms ?? '',
    shipping_cost: offer.shipping_cost != null ? String(offer.shipping_cost) : '',
    notes: '',
  })

  const total = computeOfferTotal(form.offer_items)
  const hasItems = listingLineItems.length > 0
  const shippingCostRequired = showShippingCost && isShippingCostRequired(form.proposed_incoterms)
  const canSubmit = (!hasItems || total > 0) && (!shippingCostRequired || !!form.shipping_cost)

  return (
    <div style={{ margin: '0 20px 16px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 12 }}>
        Counter Offer — Round {(offer.current_round ?? 1) + 1}
      </p>

      {hasItems && (
        <div className="form-field" style={{ marginBottom: 10 }}>
          <label className="field-label">Your Counter Pricing</label>
          <ItemPricingTable
            items={form.offer_items}
            currency={listing.currency ?? 'USD'}
            onChange={items => setForm(p => ({ ...p, offer_items: items }))}
          />
        </div>
      )}

      <div className="form-row-2" style={{ marginBottom: 10 }}>
        <div className="form-field">
          <label className="field-label">Delivery Date</label>
          <input type="date" className="input" value={form.proposed_delivery_date}
            onChange={e => setForm(p => ({ ...p, proposed_delivery_date: e.target.value }))} />
        </div>
        <div className="form-field">
          <label className="field-label">Incoterms</label>
          <select className="input form-select" value={form.proposed_incoterms}
            onChange={e => setForm(p => ({ ...p, proposed_incoterms: e.target.value }))}>
            <option value="">Select</option>
            {INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {shippingCostRequired && (
        <div className="form-field" style={{ marginBottom: 10 }}>
          <label className="field-label">
            Shipping Cost ({listing.currency ?? 'USD'})
            <span style={{ color: 'var(--color-red)', marginLeft: 3 }}>*</span>
          </label>
          <input type="number" className="input" min="0" step="0.01" value={form.shipping_cost}
            onChange={e => setForm(p => ({ ...p, shipping_cost: e.target.value }))} placeholder="0.00" />
        </div>
      )}
      <div className="form-field" style={{ marginBottom: 10 }}>
        <label className="field-label">Payment Terms</label>
        <select className="input form-select" value={form.proposed_payment_terms}
          onChange={e => setForm(p => ({ ...p, proposed_payment_terms: e.target.value }))}>
          <option value="">Select</option>
          {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-field" style={{ marginBottom: 12 }}>
        <label className="field-label">Notes</label>
        <textarea className="input" rows={2} value={form.notes}
          onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
      </div>
      {error && <p className="field-error" style={{ marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-blue btn-sm" disabled={submitting || !canSubmit} onClick={() => onSubmit(form)}>
          {submitting ? 'Sending…' : `Send Counter${total > 0 ? ` — ${total.toLocaleString()} ${listing.currency ?? ''}` : ''}`}
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
  listingLineItems,
  isListingOwner,
  isMyOffer,
  posterOrgName,
  onAccept,
  onReject,
  onWithdraw,
  onCounterStart,
  counteringOfferId,
  onCounterSubmit,
  onCounterCancel,
  onOpenRoom,
  actionSubmitting,
  actionError,
}: {
  item: { offer: MarketplaceOffer; offeror_org: Record<string, unknown> | null; ai_analysis: string | null; ai_recommendation: string | null }
  listing: MarketplaceListing
  listingLineItems: any[]
  isListingOwner: boolean
  isMyOffer: boolean
  posterOrgName: string
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onWithdraw: (id: string) => void
  onCounterStart: (id: string) => void
  counteringOfferId: string | null
  onCounterSubmit: (id: string, f: OfferFormState) => void
  onCounterCancel: () => void
  onOpenRoom: (offerId: string) => void
  actionSubmitting: boolean
  actionError: string | null
}) {
  const router = useRouter()
  const { offer, offeror_org, ai_analysis, ai_recommendation } = item
  const isInactive = ['withdrawn', 'rejected', 'expired'].includes(offer.status)
  const isActive = ['pending', 'countered'].includes(offer.status)
  const isCounting = counteringOfferId === offer.id
  const roomId = (offer.metadata?.room_id as string | undefined) ?? null

  // Turn-based counter logic: whoever received the last counter gets to respond.
  const rounds = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null
  // isListingOwnerTurn: no rounds yet (fresh offer) OR last round submitted by offeror
  const isListingOwnerTurn = !lastRound || (lastRound as any).by_org_id === offer.from_org_id
  // isOfferorTurn: a round exists AND last round was submitted by listing org
  const isOfferorTurn = lastRound != null && (lastRound as any).by_org_id !== offer.from_org_id

  // Whether this user just sent a counter and is waiting for the other party
  const iWaitingForOther = offer.status === 'countered' && (
    (isListingOwner && !isListingOwnerTurn) ||
    (isMyOffer && !isOfferorTurn)
  )

  // Extract offer_items from the last round
  const lastRoundItems: any[] = (lastRound as any)?.offer_items ?? []
  const offerTotal = lastRoundItems.length > 0
    ? lastRoundItems.reduce((sum: number, it: any) => {
        const qty = Number(it.quantity) || 0
        const price = Number(it.unit_price) || 0
        return sum + qty * price
      }, 0)
    : null

  // Helper: compute total from a round's offer_items
  function roundTotal(r: any): number | null {
    const items: any[] = r?.offer_items ?? []
    if (items.length === 0) return null
    const t = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
    return t > 0 ? t : null
  }

  const offerorName = (offeror_org?.doing_business_as as string | null) || (offeror_org?.legal_name as string | null) || 'Offeror'

  const score = (offeror_org?.passport_score as number | null) ?? null
  const scoreColor = score == null ? 'var(--gray)' : score >= 70 ? 'var(--color-green)' : score >= 45 ? 'var(--color-amber)' : 'var(--color-red)'

  return (
    <div className="mp-offer-card" style={isInactive ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>

      {/* ── Status + round ── */}
      <div className="mp-offer-card-status">
        <span className={`badge ${OFFER_STATUS_CLASS[offer.status] ?? 'badge-draft'}`}>{offer.status}</span>
        {offer.current_round > 1 && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray)', letterSpacing: '0.08em' }}>
            Round {offer.current_round}
          </span>
        )}
      </div>

      {/* ── Total price ── */}
      <div style={{ padding: '4px 20px 16px', borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 4 }}>
          Total Offer
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1 }}>
            {(offerTotal ?? offer.offered_price)?.toLocaleString() ?? '—'}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--gray)' }}>
            {listing.currency}
          </span>
        </div>
      </div>

      {/* ── Offered by ── */}
      {offeror_org && (
        <div style={{ padding: '14px 20px 16px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 12 }}>
            Offered By
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            {/* Score ring */}
            <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
              <svg width="56" height="56" viewBox="0 0 56 56" style={{ position: 'absolute', inset: 0 }}>
                <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border-strong)" strokeWidth="3.5" />
                {score != null && (
                  <circle
                    cx="28" cy="28" r="24"
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="3.5"
                    strokeDasharray={`${(score / 100) * 150.8} 150.8`}
                    strokeLinecap="round"
                    transform="rotate(-90 28 28)"
                    style={{ transition: 'stroke-dasharray 0.6s ease' }}
                  />
                )}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
                  {score ?? '—'}
                </span>
              </div>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(offeror_org.doing_business_as as string | null) || (offeror_org.legal_name as string | null) || 'Unknown'}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', border: '1px solid var(--border-strong)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
                  {offeror_org.type as string}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>Trades</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>
                    {(offeror_org.trade_count_total as number | null) ?? '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>Avg Pay</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>
                    {(offeror_org.avg_payment_days as number | null) != null ? `${offeror_org.avg_payment_days}d` : '—'}
                  </div>
                </div>
                {(offeror_org.dispute_rate_network as number | null) != null && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>Disputes</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>
                      {((offeror_org.dispute_rate_network as number) * 100).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>

              <button
                className="btn btn-ghost btn-sm"
                onClick={() => router.push(`/passport/${offeror_org.id as string}`)}
              >
                View Passport →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Negotiation history (shown when 2+ rounds have happened) ── */}
      {rounds.length >= 2 && (
        <div style={{ padding: '14px 20px 4px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 10 }}>
            Negotiation History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {(rounds as any[]).map((r, idx) => {
              const sentByOwner = r.by_org_id !== offer.from_org_id
              const senderName = sentByOwner ? posterOrgName : offerorName
              const isMe = sentByOwner ? isListingOwner : isMyOffer
              const total = roundTotal(r)
              const prev = idx > 0 ? roundTotal(rounds[idx - 1]) : null
              const delta = total != null && prev != null ? total - prev : null
              const isCurrent = idx === rounds.length - 1

              return (
                <div key={idx} style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto auto',
                  gap: '0 10px',
                  padding: '8px 0',
                  borderBottom: idx < rounds.length - 1 ? '1px solid var(--border-light)' : 'none',
                  alignItems: 'center',
                  opacity: isCurrent ? 1 : 0.65,
                }}>
                  {/* Round indicator */}
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: isCurrent ? 'var(--blue)' : 'var(--border-strong)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: isCurrent ? '#fff' : 'var(--gray)', flexShrink: 0,
                  }}>
                    {idx + 1}
                  </div>

                  {/* Sender */}
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      {senderName}
                    </span>
                    {isMe && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-light)', borderRadius: 999, padding: '1px 6px', marginLeft: 6, letterSpacing: '0.04em' }}>
                        You
                      </span>
                    )}
                    {isCurrent && (
                      <span style={{ fontSize: 10, color: 'var(--gray)', marginLeft: 6 }}>· Current</span>
                    )}
                  </div>

                  {/* Delta */}
                  <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 600 }}>
                    {delta != null && (
                      <span style={{ color: delta < 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                        {delta < 0 ? '▼' : '▲'} {Math.abs(delta).toLocaleString()}
                      </span>
                    )}
                    {delta == null && idx === 0 && (
                      <span style={{ color: 'var(--gray)', fontSize: 10 }}>Initial</span>
                    )}
                  </div>

                  {/* Total */}
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    {total != null ? (
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                        {total.toLocaleString()} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--gray)' }}>{listing.currency}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--gray)' }}>—</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Per-item breakdown ── */}
      {lastRoundItems.length > 0 && (
        <div style={{ padding: '14px 20px 4px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 10 }}>
            Item Breakdown
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 50px 90px 90px', gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-light)', fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
            <span>Item</span><span>Qty</span><span>Unit</span><span>Unit Price</span><span style={{ textAlign: 'right' }}>Total</span>
          </div>
          {lastRoundItems.map((it: any, idx: number) => {
            const qty = Number(it.quantity) || 0
            const price = Number(it.unit_price) || 0
            const lineTotal = qty * price
            return (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 50px 90px 90px', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--border-light)', alignItems: 'start' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{it.name}</div>
                  {it.description && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{it.description}</div>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink)', paddingTop: 2 }}>{it.quantity ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--gray)', paddingTop: 2 }}>{it.unit ?? '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', paddingTop: 2 }}>{price > 0 ? price.toLocaleString() : '—'}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', paddingTop: 2, textAlign: 'right' }}>
                  {lineTotal > 0 ? lineTotal.toLocaleString() : '—'}
                </div>
              </div>
            )
          })}
          {offerTotal != null && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 8, padding: '10px 0 6px' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gray)' }}>Total</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{offerTotal.toLocaleString()}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--gray)' }}>{listing.currency}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Trade terms pills ── */}
      <div className="mp-offer-terms-row">
        {offer.proposed_incoterms && <span className="mp-offer-term-pill">{offer.proposed_incoterms}</span>}
        {offer.proposed_payment_terms && <span className="mp-offer-term-pill">{offer.proposed_payment_terms}</span>}
        {offer.proposed_delivery_date && <span className="mp-offer-term-pill">Delivery: {fmtDate(offer.proposed_delivery_date)}</span>}
        {offer.shipping_cost != null && <span className="mp-offer-term-pill">Shipping: {offer.shipping_cost.toLocaleString()} {listing.currency}</span>}
      </div>

      {/* ── AI analysis strip ── */}
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
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray-soft)', letterSpacing: '0.06em' }}>
          {timeAgo(offer.created_at)}
        </span>

        {/* Room button — always visible for active offers parties are involved in */}
        {(isListingOwner || isMyOffer) && isActive && (
          roomId ? (
            <button className="btn btn-sm btn-ghost" onClick={() => router.push(`/rooms/${roomId}`)}>
              Go to Strike Room →
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onOpenRoom(offer.id)}>
              Open Strike Room
            </button>
          )
        )}

        {offer.status === 'accepted' && offer.deal_id && (
          <button className="btn btn-sm btn-blue" onClick={() => router.push(`/deals/${offer.deal_id}`)}>
            View Deal →
          </button>
        )}

        {/* Negotiation actions — only shown when it's your turn */}
        {(isListingOwner || isMyOffer) && isActive && (
          <div className="mp-offer-actions">
            {iWaitingForOther ? (
              <span style={{ fontSize: 12, color: 'var(--gray)', fontStyle: 'italic', padding: '0 4px' }}>
                Counter submitted — awaiting their response
              </span>
            ) : (
              <>
                {/* Listing owner actions */}
                {isListingOwner && offer.status === 'pending' && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>Counter</button>
                    <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onReject(offer.id)}>Reject</button>
                    <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>Accept</button>
                  </>
                )}
                {isListingOwner && offer.status === 'countered' && isListingOwnerTurn && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>Counter</button>
                    <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onReject(offer.id)}>Reject</button>
                    <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>Accept Counter</button>
                  </>
                )}

                {/* Offeror actions */}
                {isMyOffer && offer.status === 'pending' && (
                  <button className="btn btn-sm btn-danger" disabled={actionSubmitting} onClick={() => onWithdraw(offer.id)}>Withdraw</button>
                )}
                {isMyOffer && offer.status === 'countered' && isOfferorTurn && (
                  <>
                    <button className="btn btn-sm btn-ghost" disabled={actionSubmitting} onClick={() => onCounterStart(offer.id)}>Counter</button>
                    <button className="btn btn-sm btn-blue" disabled={actionSubmitting} onClick={() => onAccept(offer.id)}>Accept Counter</button>
                    <button className="btn btn-sm btn-danger" disabled={actionSubmitting} onClick={() => onWithdraw(offer.id)}>Withdraw</button>
                  </>
                )}
              </>
            )}
            {/* Offeror can always withdraw even while waiting */}
            {isMyOffer && iWaitingForOther && (
              <button className="btn btn-sm btn-danger" disabled={actionSubmitting} onClick={() => onWithdraw(offer.id)}>Withdraw</button>
            )}
          </div>
        )}
      </div>

      {isCounting && (
        <CounterForm
          offer={offer}
          listing={listing}
          listingLineItems={listingLineItems}
          showShippingCost={(isMyOffer && listing.listing_type === 'po_request') || (isListingOwner && listing.listing_type === 'product_service')}
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

  const [lineItems, setLineItems] = useState<any[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [documents, setDocuments] = useState<any[]>([])

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

  // Fetch line items and bank accounts in parallel when listing loads
  useEffect(() => {
    if (!id) return
    fetch(`/api/marketplace/listings/${id}/line-items`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setLineItems(d.items ?? []) })
      .catch(() => {})
    // Fetch current user's bank accounts for offer form
    fetch('/api/settings/bank-accounts')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBankAccounts(d.accounts ?? []) })
      .catch(() => {})
    // Fetch listing documents
    fetch(`/api/marketplace/listings/${id}/document`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDocuments(d.documents ?? []) })
      .catch(() => {})
  }, [id])

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

  async function handleOpenRoom(offerId: string) {
    setActionSubmitting(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/marketplace/offers/${offerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_room' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create room')
      if (json.room_id) {
        await fetchData()
        router.push(`/rooms/${json.room_id}`)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Error creating room')
    } finally {
      setActionSubmitting(false)
    }
  }

  async function handleSubmitOffer(form: OfferFormState) {
    if (!data) return
    setOfferSubmitting(true)
    setOfferError(null)
    try {
      const total = computeOfferTotal(form.offer_items)
      const res = await fetch('/api/marketplace/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: id,
          offered_price: total > 0 ? total : 0,
          proposed_delivery_date: form.proposed_delivery_date || undefined,
          proposed_incoterms: form.proposed_incoterms || undefined,
          proposed_payment_terms: form.proposed_payment_terms || undefined,
          shipping_cost: form.shipping_cost ? parseFloat(form.shipping_cost) : undefined,
          notes: form.notes || undefined,
          bank_account_id: form.bank_account_id || undefined,
          offer_items: form.offer_items.length > 0 ? form.offer_items : undefined,
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
      if (extra?.offer_items && extra.offer_items.length > 0) {
        body.offered_price = computeOfferTotal(extra.offer_items)
        body.offer_items = extra.offer_items
      }
      if (extra?.proposed_delivery_date) body.proposed_delivery_date = extra.proposed_delivery_date
      if (extra?.proposed_incoterms) body.proposed_incoterms = extra.proposed_incoterms
      if (extra?.proposed_payment_terms) body.proposed_payment_terms = extra.proposed_payment_terms
      if (extra?.shipping_cost) body.shipping_cost = parseFloat(extra.shipping_cost)
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

  const posterName = (poster_org?.doing_business_as as string | null) || (poster_org?.legal_name as string | null) || 'Listing Owner'

  function buildRoundHistory(offerItem: typeof offers[0]) {
    const offerRounds = Array.isArray((offerItem.offer as any).offer_rounds) ? (offerItem.offer as any).offer_rounds as any[] : []
    const offerorDisplayName = (offerItem.offeror_org as any)?.doing_business_as || (offerItem.offeror_org as any)?.legal_name || 'Offeror'
    return offerRounds.map((r: any, idx: number) => {
      const sentByOwner = r.by_org_id !== offerItem.offer.from_org_id
      const items: any[] = r.offer_items ?? []
      const total = items.length > 0 ? items.reduce((s: number, it: any) => s + (Number(it.quantity)||0) * (Number(it.unit_price)||0), 0) : null
      const prevItems: any[] = idx > 0 ? (offerRounds[idx - 1]?.offer_items ?? []) : []
      const prevTotal = prevItems.length > 0 ? prevItems.reduce((s: number, it: any) => s + (Number(it.quantity)||0) * (Number(it.unit_price)||0), 0) : null
      return {
        round: idx + 1,
        sent_by: sentByOwner ? 'listing_owner' : 'offeror',
        sent_by_name: sentByOwner ? posterName : offerorDisplayName,
        total: total ?? null,
        delta_from_prev: total != null && prevTotal != null ? total - prevTotal : null,
        incoterms: r.proposed_incoterms ?? null,
        payment_terms: r.proposed_payment_terms ?? null,
        delivery_date: r.proposed_delivery_date ?? null,
        notes: r.notes ?? null,
      }
    })
  }

  const aiContext = JSON.stringify({
    page: 'listing_detail',
    listing_id: listing.id,
    listing_type: listing.listing_type === 'po_request' ? 'PO Request (buyer seeking supplier)' : 'Product/Service (supplier offering)',
    title: listing.title,
    category: listing.category,
    target_price: listing.target_price,
    currency: listing.currency,
    delivery_deadline: listing.delivery_deadline,
    delivery_location: listing.delivery_location,
    incoterms: listing.incoterms,
    payment_terms: listing.payment_terms,
    poster_name: posterName,
    poster_passport_score: poster_org?.passport_score ?? null,
    poster_kyb_status: poster_org?.kyb_status ?? null,
    poster_type: poster_org?.type ?? null,
    offer_count,
    is_owner: isListingOwner,
    can_submit_offer: canSubmitOffer,
    my_offer: myOffer ? {
      status: myOffer.offer.status,
      current_round: myOffer.offer.current_round,
      offered_price: myOffer.offer.offered_price,
      proposed_delivery_date: myOffer.offer.proposed_delivery_date,
      proposed_incoterms: myOffer.offer.proposed_incoterms,
      proposed_payment_terms: myOffer.offer.proposed_payment_terms,
      notes: myOffer.offer.notes,
      round_history: buildRoundHistory(myOffer),
      whose_turn: (() => {
        const mr = Array.isArray((myOffer.offer as any).offer_rounds) ? (myOffer.offer as any).offer_rounds as any[] : []
        const lr = mr.length > 0 ? mr[mr.length - 1] : null
        return (!lr || lr.by_org_id === myOffer.offer.from_org_id) ? `listing_owner (${posterName})` : `offeror (me)`
      })(),
    } : null,
    // Full offer details when viewer is listing owner so AI can compare, advise, and know who sent what
    all_offers: isListingOwner ? offers.map(item => {
      const offerorDisplayName = (item.offeror_org as any)?.doing_business_as || (item.offeror_org as any)?.legal_name || 'Unknown'
      const itemRounds = Array.isArray((item.offer as any).offer_rounds) ? (item.offer as any).offer_rounds as any[] : []
      const lastR = itemRounds.length > 0 ? itemRounds[itemRounds.length - 1] : null
      const lastTotal = lastR?.offer_items?.reduce((s: number, it: any) => s + (Number(it.quantity)||0) * (Number(it.unit_price)||0), 0) ?? null
      return {
        offer_id: item.offer.id,
        status: item.offer.status,
        current_round: item.offer.current_round,
        current_total: lastTotal ?? item.offer.offered_price,
        proposed_incoterms: item.offer.proposed_incoterms,
        proposed_payment_terms: item.offer.proposed_payment_terms,
        proposed_delivery_date: item.offer.proposed_delivery_date,
        offeror_name: offerorDisplayName,
        offeror_passport_score: (item.offeror_org as any)?.passport_score ?? null,
        offeror_kyb_status: (item.offeror_org as any)?.kyb_status ?? null,
        ai_recommendation: item.ai_recommendation ?? null,
        round_history: buildRoundHistory(item),
        whose_turn: (() => {
          const lr = itemRounds.length > 0 ? itemRounds[itemRounds.length - 1] : null
          if (!lr) return `listing_owner (${posterName})`
          return lr.by_org_id === item.offer.from_org_id ? `listing_owner (${posterName})` : `offeror (${offerorDisplayName})`
        })(),
      }
    }) : null,
    line_items: lineItems.map((li: any) => ({
      name: li.name, qty: li.quantity, unit: li.unit, unit_price: li.unit_price,
    })),
  })

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

      <div className="page mp-page" data-page-name="Listing" data-ai-context={aiContext}>
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
            {(() => {
              const lineItemsTotal = lineItems.reduce((sum: number, item: any) => {
                const qty = Number(item.quantity) || 0
                const price = Number(item.unit_price) || 0
                return sum + (qty > 0 && price > 0 ? qty * price : 0)
              }, 0)
              const displayPrice = lineItemsTotal > 0 ? lineItemsTotal : listing.target_price
              const isTotal = lineItemsTotal > 0
              return (
            <div className="card">
              <div className="card-head">Trade Terms</div>
              <div style={{ padding: '8px 0' }}>
                <div className="kv-row">
                  <span className="k">{isTotal ? 'Total Value' : 'Target Price'}</span>
                  <span className="v" style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {displayPrice != null
                      ? displayPrice.toLocaleString()
                      : '—'}&nbsp;
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--gray)' }}>
                      {listing.currency}{!isTotal && listing.unit ? ` / ${listing.unit}` : ''}
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
                {listing.shipping_cost != null && (
                  <div className="kv-row">
                    <span className="k">Shipping Cost</span>
                    <span className="v">{listing.shipping_cost.toLocaleString()} {listing.currency}</span>
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
                          fontFamily: 'var(--font-body)',
                          fontSize: 11,
                          fontWeight: 500,
                          letterSpacing: '0.04em',
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
              )
            })()}

            {/* Description */}
            {listing.description && (
              <div className="card">
                <div className="card-head">Description</div>
                <div className="card-body" style={{ fontSize: 14, color: 'var(--color-ink-2)', lineHeight: 1.65 }}>
                  {listing.description}
                </div>
              </div>
            )}

            {/* Line Items */}
            {lineItems.length > 0 && (
              <div className="card">
                <div className="card-head">Line Items</div>
                <div style={{ padding: '0 0 8px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px', gap: 8, padding: '8px 20px', fontSize: 11, fontFamily: 'var(--font-body)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', borderBottom: '1px solid var(--border)' }}>
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Unit</span>
                    <span>Price/Unit</span>
                  </div>
                  {lineItems.map((item: any) => (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px', gap: 8, padding: '10px 20px', alignItems: 'start', borderBottom: '1px solid var(--border-light)' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{item.name}</div>
                        {item.description && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{item.description}</div>}
                      </div>
                      <div style={{ fontSize: 13 }}>{item.quantity ?? '—'}</div>
                      <div style={{ fontSize: 13 }}>{item.unit ?? '—'}</div>
                      <div style={{ fontSize: 13 }}>
                        {item.unit_price != null
                          ? `${item.unit_price.toLocaleString()} ${item.currency ?? listing.currency ?? 'USD'}`
                          : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary */}
            {listing.ai_summary && (
              <div style={{ borderLeft: '3px solid var(--teal)', background: 'var(--teal-dim)', padding: '12px 16px' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 4 }}>
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
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                    Offers Received
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>
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
                      listingLineItems={lineItems}
                      isListingOwner={isListingOwner}
                      isMyOffer={item.offer.from_org_id === viewer_org_id}
                      posterOrgName={posterName}
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
                      onOpenRoom={handleOpenRoom}
                      actionSubmitting={actionSubmitting}
                      actionError={actionError}
                    />
                  ))}
                </div>
              </div>
            ) : offers.length > 0 ? (
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 12 }}>
                  Your Offer
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {offers.map(item => (
                    <OfferCard
                      key={item.offer.id}
                      item={item}
                      listing={listing}
                      listingLineItems={lineItems}
                      isListingOwner={false}
                      isMyOffer={true}
                      posterOrgName={posterName}
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
                      onOpenRoom={handleOpenRoom}
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
                listingLineItems={lineItems}
                onSubmit={handleSubmitOffer}
                submitting={offerSubmitting}
                error={offerError}
                bankAccounts={bankAccounts}
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
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 2 }}>
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
                <div style={{ padding: '0 20px 16px' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%' }}
                    onClick={() => router.push(`/passport/${poster_org.id as string}`)}
                  >
                    View Passport →
                  </button>
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

            {/* Documents */}
            {documents.length > 0 && (
              <div className="card">
                <div className="card-head">Documents</div>
                <div style={{ padding: '4px 0 8px' }}>
                  {documents.map((doc: any) => (
                    <a
                      key={doc.id}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 20px',
                        borderBottom: '1px solid var(--border-light)',
                        textDecoration: 'none',
                        color: 'var(--ink)',
                      }}
                    >
                      <span style={{ fontSize: 18 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>
                          {fmtDate(doc.created_at)}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600, flexShrink: 0 }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

          </aside>
        </div>
      </div>
    </>
  )
}
