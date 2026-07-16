'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { SkeletonCard, CountUp } from '@/components/motion'

type DealTab = 'all' | 'active' | 'negotiating' | 'completed'

interface FinancingRequestSummary {
  id: string
  status: string
  structure_type: string
  financing_type: string
  amount_requested: number | null
  offer_count: number | null
  accepted_bank_id: string | null
}

interface DealRow {
  id: string
  status: string
  deal_source: string
  agreed_currency: string
  total_value: number | null
  agreed_price: number | null
  agreed_delivery_date: string | null
  created_at: string
  financing_requested: boolean
  financing_request_id: string | null
  user_role: 'buyer' | 'supplier'
  counterparty: {
    id: string
    legal_name: string | null
    passport_score: number | null
    risk_tier: string | null
  } | null
  financing_request: FinancingRequestSummary | null
  marketplace_listings: { id: string; title: string; listing_type: string } | null
}

const TAB_STATUS_MAP: Record<DealTab, string | null> = {
  all:         null,
  active:      'active',
  negotiating: 'negotiating',
  completed:   'completed',
}

const EMPTY_MESSAGES: Record<DealTab, { title: string; sub: string }> = {
  all:          { title: 'No deals yet',          sub: 'When you accept or send an offer on Strike Place, your deals will appear here.' },
  active:       { title: 'No active deals',        sub: 'Deals in progress — funded and on track — will show here.' },
  negotiating:  { title: 'No active negotiations',  sub: 'Deals and marketplace offers you are actively negotiating will appear here.' },
  completed:    { title: 'No completed deals',     sub: 'Deals that have reached delivery and payment will show here.' },
}

const DEAL_STATUS_LABEL: Record<string, string> = {
  negotiating:         'Negotiating',
  agreed:              'Agreed',
  documents_pending:   'Documents',
  confirmed:           'Confirmed',
  in_preparation:      'In Preparation',
  shipped:             'Shipped',
  goods_received:      'Goods Received',
  delivery_confirmed:  'Delivery Confirmed',
  payment_info_sent:   'Payment Info Sent',
  payment_confirmed:   'Payment Confirmed',
  active:              'Active',
  financing_requested: 'Financing Requested',
  financing_active:    'Financing Active',
  completed:           'Completed',
  in_dispute:          'In Dispute',
  disputed:            'Disputed',
  cancelled:           'Cancelled',
}

function statusLabel(s: string): string {
  return DEAL_STATUS_LABEL[s] ?? s.replace(/_/g, ' ')
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'negotiating':         return 'badge badge-draft'
    case 'agreed':              return 'badge badge-signing'
    case 'documents_pending':   return 'badge badge-pending'
    case 'confirmed':
    case 'in_preparation':
    case 'active':              return 'badge badge-active'
    case 'shipped':
    case 'goods_received':
    case 'delivery_confirmed':  return 'badge badge-active'
    case 'payment_info_sent':   return 'badge badge-offer'
    case 'payment_confirmed':   return 'badge badge-funded'
    case 'financing_requested': return 'badge badge-offer'
    case 'financing_active':    return 'badge badge-funded'
    case 'completed':           return 'badge badge-completed'
    case 'in_dispute':
    case 'disputed':            return 'badge badge-overdue'
    case 'cancelled':           return 'badge badge-rejected'
    default:                    return 'badge badge-draft'
  }
}

// Financing-request status → badge class (financing_request_status enum).
function financingBadgeClass(s: string): string {
  switch (s) {
    case 'open':            return 'badge badge-active'
    case 'offers_received': return 'badge badge-offer'
    case 'accepted':        return 'badge badge-signing'
    case 'funded':          return 'badge badge-funded'
    case 'expired':         return 'badge badge-draft'
    case 'cancelled':       return 'badge badge-rejected'
    default:                return 'badge badge-draft'
  }
}

// deal_source enum → human label.
const SOURCE_LABEL: Record<string, string> = {
  marketplace: 'Strike Place',
  imported:    'Imported',
  direct:      'Direct',
}

// financing_type enum → compact label for the financing cell.
const FIN_TYPE_LABEL: Record<string, string> = {
  reverse_factoring:   'Reverse Factoring',
  invoice_factoring:   'Invoice Factoring',
  po_financing:        'PO Financing',
  dynamic_discounting: 'Dynamic Discounting',
}

// A deal is financing-eligible when it has been agreed/is live but no financing
// has been requested yet. These are the "Finance This Deal" rows — the primary
// action path that replaces the old transactions flow (TB.3). Statuses match the
// detail page's actual financing gate (deals/[id]/page.tsx) so the CTA never
// dead-ends on a deal whose form won't open.
const FINANCEABLE_STATUSES = ['agreed', 'active']
function isFinanceable(d: DealRow): boolean {
  return !d.financing_requested && !d.financing_request_id && FINANCEABLE_STATUSES.includes(d.status)
}

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

const DEAL_COLUMNS = [
  { key: 'id',           label: 'Deal ID',       width: 150 },
  { key: 'counterparty', label: 'Counterparty',  width: undefined },
  { key: 'value',        label: 'Trade Value',   width: 130, align: 'right' as const },
  { key: 'status',       label: 'Status',        width: 140 },
  { key: 'financing',    label: 'Financing',     width: 180 },
  { key: 'delivery',     label: 'Delivery',      width: 110 },
  { key: 'actions',      label: '',              width: 150 },
]

interface ImportableErpDeal {
  erp_reference: string
  counterparty_name: string
  amount: number
  currency: string
  due_date: string | null
  invoice_name: string
}

interface PendingOffer {
  id: string
  status: 'pending' | 'countered'
  listing_id: string
  listing_title: string | null
  listing_currency: string
  listing_type: string | null
  listing_owner_name: string | null
  listing_owner_score: number | null
  current_total: number | null
  current_round: number
  proposed_delivery_date: string | null
  proposed_incoterms: string | null
  proposed_payment_terms: string | null
  created_at: string
}

export default function DealsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<DealTab>('all')
  const [deals, setDeals] = useState<DealRow[]>([])
  const [pendingOffers, setPendingOffers] = useState<PendingOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<Record<DealTab, number>>({ all: 0, active: 0, negotiating: 0, completed: 0 })
  const [erpImportable, setErpImportable] = useState<ImportableErpDeal[]>([])
  const [importingRef, setImportingRef] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/deals').then(r => r.ok ? r.json() : { deals: [] }).catch(() => ({ deals: [] })),
      fetch('/api/marketplace/offers').then(r => r.ok ? r.json() : { offers: [] }).catch(() => ({ offers: [] })),
      fetch('/api/deals/importable').then(r => r.ok ? r.json() : { deals: [] }).catch(() => ({ deals: [] })),
    ]).then(([dealsData, offersData, importableData]) => {
      const all: DealRow[] = dealsData.deals ?? []
      const offers: PendingOffer[] = offersData.offers ?? []
      setDeals(all)
      setPendingOffers(offers)
      setErpImportable(importableData.deals ?? [])
      const ACTIVE_STATUSES = ['active', 'confirmed', 'in_preparation', 'shipped', 'goods_received', 'delivery_confirmed', 'payment_info_sent', 'payment_confirmed', 'financing_requested', 'financing_active']
      setCounts({
        all:         all.length + offers.length,
        active:      all.filter(d => ACTIVE_STATUSES.includes(d.status)).length,
        negotiating: all.filter(d => d.status === 'negotiating' || d.status === 'agreed').length + offers.length,
        completed:   all.filter(d => d.status === 'completed').length,
      })
    }).finally(() => setLoading(false))
  }, [])

  async function importErpDeal(ref: string) {
    setImportingRef(ref)
    try {
      const res = await fetch('/api/deals/import-erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erp_reference: ref }),
      })
      const json = await res.json()
      if (!res.ok) { setImportingRef(null); return }
      router.push(`/deals/${json.deal_id}`)
    } catch {
      setImportingRef(null)
    }
  }

  const ACTIVE_STATUSES_FILTER = ['active', 'confirmed', 'in_preparation', 'shipped', 'goods_received', 'delivery_confirmed', 'payment_info_sent', 'payment_confirmed', 'financing_requested', 'financing_active']
  const filtered = deals.filter(d => {
    if (activeTab === 'all') return true
    if (activeTab === 'active') return ACTIVE_STATUSES_FILTER.includes(d.status)
    if (activeTab === 'negotiating') return ['negotiating', 'agreed'].includes(d.status)
    if (activeTab === 'completed') return d.status === 'completed'
    return true
  })

  const empty = EMPTY_MESSAGES[activeTab]

  return (
    <>
      <Topbar
        crumbs={[{ label: 'My Deals' }]}
        actions={
          <div className="topbar-right">
            <button
              className="btn btn-blue btn-sm"
              onClick={() => router.push('/deals/import')}
            >
              Finance an Existing Trade
            </button>
          </div>
        }
      />

      <div className="page" style={{ maxWidth: 1280 }} data-page-name="Deals" data-ai-context={JSON.stringify({ total: counts.all, active: counts.active, negotiating: counts.negotiating, completed: counts.completed, active_tab: activeTab, pending_offers: pendingOffers.length, pending_offer_listings: pendingOffers.map(o => ({ title: o.listing_title, status: o.status, round: o.current_round, total: o.current_total })) })}>
        <div className="page-header">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            My Deals
          </h1>
          <p className="subtitle">Track and manage your active trades from offer to delivery.</p>
        </div>

        {/* Tab row */}
        <div className="deals-tab-row">
          {(['all', 'active', 'negotiating', 'completed'] as DealTab[]).map(tab => (
            <button
              key={tab}
              className={`deals-tab${activeTab === tab ? ' deals-tab-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'all' && 'All'}
              {tab === 'active' && 'Active'}
              {tab === 'negotiating' && 'Negotiating'}
              {tab === 'completed' && 'Completed'}
              <span className="deals-tab-count"><CountUp value={counts[tab]} /></span>
            </button>
          ))}
        </div>

        {/* ERP-sourced deals available to import — shown on All and Active tabs */}
        {!loading && erpImportable.length > 0 && (activeTab === 'all' || activeTab === 'active') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>
              From Your ERP ({erpImportable.length})
            </div>
            <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {erpImportable.map(inv => (
                <div
                  key={inv.erp_reference}
                  className="card"
                  style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.counterparty_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2, fontFamily: 'var(--font-body)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Invoice {inv.invoice_name} · Unpaid receivable
                    </div>
                  </div>

                  <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
                      {fmt(inv.amount, inv.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gray)' }}>
                      Due {fmtDate(inv.due_date)}
                    </div>
                  </div>

                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flexShrink: 0 }}
                    disabled={importingRef === inv.erp_reference}
                    onClick={() => importErpDeal(inv.erp_reference)}
                  >
                    {importingRef === inv.erp_reference ? 'Importing…' : 'Import to Strike →'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Offers section — shown on All and Negotiating tabs */}
        {!loading && pendingOffers.length > 0 && (activeTab === 'all' || activeTab === 'negotiating') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>
              Pending Offers ({pendingOffers.length})
            </div>
            <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingOffers.map(offer => {
                const isCounted = offer.status === 'countered'
                return (
                  <div
                    key={offer.id}
                    className="card card-interactive"
                    style={{ cursor: 'pointer', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
                    onClick={() => router.push(`/marketplace/listings/${offer.listing_id}`)}
                  >
                    {/* Title + type */}
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {offer.listing_title ?? 'Untitled listing'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2, fontFamily: 'var(--font-body)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {offer.listing_type === 'po_request' ? 'PO Request' : 'Product / Service'} · Strike Place
                      </div>
                    </div>

                    {/* Posted by */}
                    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PassportScoreRing score={offer.listing_owner_score} size="sm" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{offer.listing_owner_name ?? '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray)' }}>Listing owner</div>
                      </div>
                    </div>

                    {/* Your offer total */}
                    <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
                        {offer.current_total != null ? fmt(offer.current_total, offer.listing_currency) : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)' }}>
                        Round {offer.current_round}
                      </div>
                    </div>

                    {/* Status */}
                    <div style={{ flex: '0 0 auto' }}>
                      <span className={isCounted ? 'badge badge-offer' : 'badge badge-draft'}>
                        {isCounted ? 'Countered' : 'Offer Sent'}
                      </span>
                    </div>

                    {/* Terms pills */}
                    <div style={{ flex: '0 0 auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {offer.proposed_incoterms && (
                        <span style={{ fontSize: 11, color: 'var(--gray)', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px' }}>
                          {offer.proposed_incoterms}
                        </span>
                      )}
                      {offer.proposed_payment_terms && (
                        <span style={{ fontSize: 11, color: 'var(--gray)', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px' }}>
                          {offer.proposed_payment_terms}
                        </span>
                      )}
                    </div>

                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); router.push(`/marketplace/listings/${offer.listing_id}`) }}
                    >
                      View Offer →
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Table — hidden when no deals to show and pending offers section already fills the tab */}
        {(filtered.length > 0 || loading || !(activeTab === 'negotiating' && pendingOffers.length > 0)) && <div className="card">
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              {DEAL_COLUMNS.map(col => (
                <col key={col.key} style={{ width: col.width ?? 'auto' }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {DEAL_COLUMNS.map(col => (
                  <th key={col.key} style={col.align === 'right' ? { textAlign: 'right' } : undefined}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="reveal-stagger">
              {loading ? (
                <tr>
                  <td colSpan={DEAL_COLUMNS.length} style={{ padding: '16px 20px', border: 'none' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={56} />)}
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 && !(activeTab === 'negotiating' && pendingOffers.length > 0) ? (
                <tr>
                  <td colSpan={DEAL_COLUMNS.length} style={{ padding: 0, border: 'none' }}>
                    <div className="deals-empty">
                      <div className="deals-empty-icon float-slow">
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 2h10v12l-2-1.2-2 1.2-2-1.2-2 1.2L3 13zM5.5 6h5M5.5 9h5" />
                        </svg>
                      </div>
                      <p className="deals-empty-title">{empty.title}</p>
                      <p className="deals-empty-sub">{empty.sub}</p>
                      {activeTab === 'all' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => router.push('/marketplace')}
                          >
                            Browse Strike Place
                          </button>
                          <button
                            className="btn btn-blue btn-sm"
                            onClick={() => router.push('/deals/import')}
                          >
                            Finance an Existing Trade
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(deal => {
                  const value = deal.total_value ?? deal.agreed_price
                  const cpName = deal.counterparty?.legal_name ?? 'Unknown'
                  const fin = deal.financing_request
                  const financeable = isFinanceable(deal)
                  return (
                    <tr key={deal.id} className="card-interactive" style={{ cursor: 'pointer' }} onClick={() => router.push(`/deals/${deal.id}`)}>
                      <td>
                        {deal.marketplace_listings?.title ? (
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{deal.marketplace_listings.title}</span>
                        ) : (
                          <span className="mono" style={{ color: 'var(--gray)' }}>Deal #{shortId(deal.id)}</span>
                        )}
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-body)', letterSpacing: '0.04em', color: 'var(--gray-soft)', textTransform: 'uppercase', marginTop: 2 }}>
                          {SOURCE_LABEL[deal.deal_source] ?? deal.deal_source}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {deal.counterparty && (
                            <PassportScoreRing score={deal.counterparty.passport_score} size="sm" />
                          )}
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{cpName}</div>
                            <div style={{ fontSize: 11, fontFamily: 'var(--font-body)', color: 'var(--gray-soft)', marginTop: 1 }}>
                              {deal.user_role === 'buyer' ? 'You are buyer' : 'You are supplier'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
                          {fmt(value, deal.agreed_currency)}
                        </span>
                      </td>
                      <td>
                        <span className={statusBadgeClass(deal.status)}>
                          {statusLabel(deal.status)}
                        </span>
                      </td>
                      <td>
                        {fin ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            <span className={financingBadgeClass(fin.status)}>
                              {fin.status.replace(/_/g, ' ')}
                            </span>
                            <span style={{ fontSize: 10.5, color: 'var(--gray)' }}>
                              {FIN_TYPE_LABEL[fin.financing_type] ?? fin.financing_type}
                              {fin.offer_count ? ` · ${fin.offer_count} offer${fin.offer_count !== 1 ? 's' : ''}` : ''}
                            </span>
                          </div>
                        ) : financeable ? (
                          <span style={{ fontSize: 11.5, color: 'var(--color-green)', fontWeight: 500 }}>Eligible</span>
                        ) : (
                          <span style={{ fontSize: 11.5, color: 'var(--gray-soft)' }}>Not financed</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)' }}>
                          {fmtDate(deal.agreed_delivery_date)}
                        </span>
                      </td>
                      <td>
                        {financeable ? (
                          <button
                            className="btn btn-blue btn-sm"
                            onClick={e => { e.stopPropagation(); router.push(`/deals/${deal.id}?action=finance`) }}
                          >
                            Finance This Deal
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={e => { e.stopPropagation(); router.push(`/deals/${deal.id}`) }}
                          >
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>}
      </div>
    </>
  )
}
