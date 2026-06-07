'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { usePortal } from '@/lib/portal-context'
import type { FinancingRequest } from '@strike-scf/types'

interface OrgPassport {
  id: string
  legal_name: string
  passport_score: number | null
  risk_tier: string | null
  trade_count_total: number
  avg_payment_days: number | null
  dispute_rate_network: number | null
}

interface DealSummary {
  id: string
  agreed_price: number
  agreed_currency: string
  goods_description: string | null
  agreed_delivery_date: string | null
  agreed_incoterms: string | null
  total_value?: number | null
}

interface BankRequestItem {
  request:          FinancingRequest
  deal:             DealSummary | null
  buyer_passport:   OrgPassport | null
  supplier_passport: OrgPassport | null
  my_offer:         any | null
  all_offers_count: number
}

interface OrgRequestItem extends FinancingRequest {
  deal: DealSummary | null
}

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
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

function structureBadge(s: string) {
  return (
    <span className="badge badge-draft" style={{ textTransform: 'none', fontSize: 10 }}>
      {s}
    </span>
  )
}

function PassportMini({ passport, label }: { passport: OrgPassport | null; label: string }) {
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
        </div>
      </div>
    </div>
  )
}

function BankFeed({ items, filterType, filterSort, onFilterType, onFilterSort }: {
  items: BankRequestItem[]
  filterType: string
  filterSort: string
  onFilterType: (v: string) => void
  onFilterSort: (v: string) => void
}) {
  const router = useRouter()

  const filtered = items
    .filter(i => !filterType || i.request.financing_type === filterType || i.request.structure_type === filterType)
    .sort((a, b) => {
      if (filterSort === 'amount_desc') return (b.request.amount_requested ?? 0) - (a.request.amount_requested ?? 0)
      if (filterSort === 'amount_asc')  return (a.request.amount_requested ?? 0) - (b.request.amount_requested ?? 0)
      return new Date(b.request.created_at).getTime() - new Date(a.request.created_at).getTime()
    })

  return (
    <>
      <div className="mp-filter-row">
        <select className="mp-filter-select" value={filterType} onChange={e => onFilterType(e.target.value)}>
          <option value="">All Structure Types</option>
          <option value="open">Open</option>
          <option value="preset">Preset</option>
          <option value="custom">Custom</option>
          <option value="reverse_factoring">Reverse Factoring</option>
          <option value="invoice_factoring">Invoice Factoring</option>
          <option value="po_financing">PO Financing</option>
          <option value="dynamic_discounting">Dynamic Discounting</option>
        </select>
        <select className="mp-filter-select" value={filterSort} onChange={e => onFilterSort(e.target.value)}>
          <option value="newest">Newest First</option>
          <option value="amount_desc">Highest Amount</option>
          <option value="amount_asc">Lowest Amount</option>
        </select>
        <div className="mp-filter-spacer" />
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{filtered.length} request{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 && (
        <div className="mp-empty-state">
          <div className="mp-empty-title">No open financing requests</div>
          <div className="mp-empty-sub">New requests will appear here automatically.</div>
        </div>
      )}

      <div className="mp-listing-feed">
        {filtered.map(item => (
          <div
            key={item.request.id}
            className="listing-card"
            onClick={() => router.push(`/marketplace/financing/${item.request.id}`)}
          >
            {/* Header */}
            <div className="listing-card-head">
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                color: 'var(--ink)',
              }}>
                {fmt(item.deal?.total_value ?? item.request.amount_requested, item.request.currency)}
              </span>
              <span style={{ marginLeft: 8 }}>{structureBadge(item.request.financing_type ?? item.request.structure_type)}</span>
              <span className={statusBadge(item.request.status)} style={{ marginLeft: 4 }}>{item.request.status.replace(/_/g, ' ')}</span>
              {item.request.expires_at && (
                <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-amber)' }}>
                  Expires {fmtDate(item.request.expires_at)}
                </span>
              )}
            </div>

            <div className="listing-card-body">
              {/* Goods + delivery */}
              {item.deal && (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div className="listing-detail-item">
                    <span className="listing-detail-label">Goods</span>
                    <span className="listing-detail-value" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.deal.goods_description ?? '—'}
                    </span>
                  </div>
                  <div className="listing-detail-item">
                    <span className="listing-detail-label">Delivery</span>
                    <span className="listing-detail-value">{fmtDate(item.deal.agreed_delivery_date)}</span>
                  </div>
                  <div className="listing-detail-item">
                    <span className="listing-detail-label">Tenor Pref.</span>
                    <span className="listing-detail-value">{item.request.preferred_tenor_days ? `${item.request.preferred_tenor_days}d` : '—'}</span>
                  </div>
                </div>
              )}

              {/* Passports */}
              <div style={{ display: 'flex', gap: 8 }}>
                <PassportMini passport={item.buyer_passport}    label="Buyer" />
                <PassportMini passport={item.supplier_passport} label="Supplier" />
              </div>

              {/* AI context */}
              {(item.request.ai_market_context || item.request.ai_risk_assessment) && (
                <div className="ai-tip-card">
                  <div className="ai-tip-icon">✦</div>
                  <div className="ai-tip-body">
                    <span className="ai-tip-label">Strike AI</span>
                    {item.request.ai_market_context && (
                      <p className="ai-tip-text" style={{ margin: 0 }}>{item.request.ai_market_context}</p>
                    )}
                    {item.request.ai_risk_assessment && (
                      <p className="ai-tip-text" style={{ margin: '4px 0 0', opacity: 0.85 }}>{item.request.ai_risk_assessment}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="listing-card-footer">
              <div className="listing-offer-badge">
                <span className="listing-offer-badge-count">{item.all_offers_count}</span>
                {' '}offer{item.all_offers_count !== 1 ? 's' : ''} submitted
              </div>
              {item.my_offer && (
                <span className="badge badge-active" style={{ marginLeft: 8 }}>My Offer: {item.my_offer.offered_rate_apr}% APR</span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <span
                  className={`btn btn-sm ${item.my_offer ? 'btn-ghost' : 'btn-blue'}`}
                  onClick={e => { e.stopPropagation(); router.push(`/marketplace/financing/${item.request.id}`) }}
                >
                  {item.my_offer ? 'Edit Offer' : 'Submit Offer'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function OrgList({ items }: { items: OrgRequestItem[] }) {
  const router = useRouter()

  if (items.length === 0) {
    return (
      <div className="mp-empty-state">
        <div className="mp-empty-title">No financing requests yet</div>
        <div className="mp-empty-sub">
          Go to your deals to request financing from competing banks.{' '}
          <Link href="/deals" style={{ color: 'var(--blue)', fontWeight: 500 }}>View deals →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mp-listing-feed">
      {items.map(item => (
        <div
          key={item.id}
          className="listing-card"
          onClick={() => router.push(`/marketplace/financing/${item.id}`)}
        >
          <div className="listing-card-head">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {fmt(item.amount_requested, item.currency)}
            </span>
            {structureBadge(item.financing_type ?? item.structure_type)}
            <span className={statusBadge(item.status)} style={{ marginLeft: 4 }}>{item.status.replace(/_/g, ' ')}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray-soft)', fontFamily: 'var(--font-mono)' }}>
              {timeAgo(item.created_at)}
            </span>
          </div>
          <div className="listing-card-body" style={{ gap: 8 }}>
            {item.deal?.goods_description && (
              <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>{item.deal.goods_description}</p>
            )}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div className="listing-detail-item">
                <span className="listing-detail-label">Tenor Pref.</span>
                <span className="listing-detail-value">{item.preferred_tenor_days ? `${item.preferred_tenor_days}d` : '—'}</span>
              </div>
              <div className="listing-detail-item">
                <span className="listing-detail-label">Max Rate</span>
                <span className="listing-detail-value">{item.preferred_rate_max ? `${item.preferred_rate_max}%` : '—'}</span>
              </div>
            </div>
          </div>
          <div className="listing-card-footer">
            <div className="listing-offer-badge">
              <span className="listing-offer-badge-count">{item.offer_count}</span>
              {' '}offer{item.offer_count !== 1 ? 's' : ''}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>
              View →
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function FinancingMarketplacePage() {
  const portal = usePortal()
  const router = useRouter()
  const isBank = portal === 'bank'

  const [loading, setLoading]   = useState(true)
  const [items, setItems]       = useState<any[]>([])
  const [filterType, setFilterType] = useState('')
  const [filterSort, setFilterSort] = useState('newest')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    fetch('/api/marketplace/financing')
      .then(r => r.json())
      .then(d => {
        setItems(d.requests ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    if (isBank) {
      intervalRef.current = setInterval(load, 60000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load, isBank])

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Marketplace', onClick: () => router.push('/marketplace') },
          { label: isBank ? 'Open Financing Requests' : 'My Financing Requests' },
        ]}
      />

      <div className="mp-page page">
        <div className="page-header" style={{ marginBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            {isBank ? 'Open Financing Requests' : 'My Financing Requests'}
          </h1>
          {isBank && (
            <p className="subtitle">Live feed of financing requests from verified trade counterparties.</p>
          )}
        </div>

        {loading ? (
          <div className="mp-listing-feed">
            {[0, 1, 2].map(i => <div key={i} className="mp-skeleton-card" />)}
          </div>
        ) : isBank ? (
          <BankFeed
            items={items}
            filterType={filterType}
            filterSort={filterSort}
            onFilterType={setFilterType}
            onFilterSort={setFilterSort}
          />
        ) : (
          <OrgList items={items} />
        )}
      </div>
    </>
  )
}
