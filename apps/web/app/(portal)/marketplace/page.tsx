'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import { useGhost } from '@/lib/use-ghost'
import { PassportScoreRing } from '@/components/passport-score-ring'
import type { ListingWithPassport } from '@strike-scf/types'

interface OwnPassport {
  passport_score: number | null
  network_visible: boolean
  legal_name: string | null
  doing_business_as: string | null
  type: string
  trade_count_total: number | null
  trade_volume_total: number | null
}

const CATEGORIES = [
  'Electronics & Components',
  'Raw Materials',
  'Agricultural Commodities',
  'Chemicals & Plastics',
  'Textiles & Apparel',
  'Industrial Equipment',
  'Food & Beverage',
  'Construction Materials',
  'Pharmaceuticals',
  'Packaging',
]

function formatVolume(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

function PosterOrg({ org }: { org: NonNullable<ListingWithPassport['poster_org']> }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 10,
      paddingTop: 10,
      borderTop: '1px solid var(--border)',
    }}>
      <PassportScoreRing score={org.passport_score} size="sm" />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {org.doing_business_as ?? org.legal_name ?? '—'}
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginTop: 1,
        }}>
          {org.type} · {org.trade_count_total ?? 0} trades · {formatVolume(org.trade_volume_total)}
        </div>
      </div>
    </div>
  )
}

function ListingCard({ item, isOwn = false }: { item: ListingWithPassport & { line_items_total?: number | null }; isOwn?: boolean }) {
  const router = useRouter()
  const { listing, poster_org } = item

  const rawPrice = (item as any).line_items_total ?? listing.target_price
  const price = rawPrice != null
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(rawPrice)
    : null
  const isTotal = (item as any).line_items_total != null
  const deadline = formatDeadline(listing.delivery_deadline)

  return (
    <div
      className="listing-card"
      onClick={() => router.push(`/marketplace/listings/${listing.id}`)}
    >
      <div className="listing-card-head">
        <span className={`listing-type-badge ${listing.listing_type === 'po_request' ? 'listing-type-po' : 'listing-type-product'}`}>
          {listing.listing_type === 'po_request' ? 'PO Request' : 'Product / Service'}
        </span>
        {listing.category && (
          <span className="listing-category-tag">{listing.category}</span>
        )}
        {isOwn && (
          <span className={`badge ${listing.status === 'active' ? 'badge-active' : 'badge-draft'}`} style={{ marginLeft: 'auto' }}>
            {listing.status}
          </span>
        )}
        {!isOwn && (
          <span className="listing-posted-time">
            {formatDeadline(listing.created_at) ?? ''}
          </span>
        )}
      </div>

      <div className="listing-card-body">
        <div className="listing-card-title">{listing.title}</div>

        {price != null && (
          <div className="listing-price-row">
            <span className="listing-price">{price}</span>
            <span className="listing-price-currency">{listing.currency}</span>
            {isTotal
              ? <span className="listing-price-unit">total</span>
              : listing.unit && <span className="listing-price-unit">/ {listing.unit}</span>
            }
          </div>
        )}

        <div className="listing-details-row">
          {listing.quantity != null && listing.unit && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">Quantity</span>
              <span className="listing-detail-value">{listing.quantity} {listing.unit}</span>
            </div>
          )}
          {deadline && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">Deadline</span>
              <span className="listing-detail-value">Due {deadline}</span>
            </div>
          )}
          {listing.delivery_location && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">Location</span>
              <span className="listing-detail-value">{listing.delivery_location}</span>
            </div>
          )}
        </div>

        {listing.ai_summary && (
          <div className="listing-ai-summary">{listing.ai_summary}</div>
        )}

        {!isOwn && poster_org && <PosterOrg org={poster_org} />}
      </div>

      <div className="listing-card-footer">
        {!isOwn && (
          <span className="listing-offer-badge">
            <span className="listing-offer-badge-count">{listing.offer_count ?? 0}</span>
            &nbsp;offer{listing.offer_count !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/marketplace/listings/${listing.id}`)
            }}
          >
            {isOwn ? 'View' : 'View & Offer'}
          </button>
        </div>
      </div>
    </div>
  )
}

type MainTab = 'marketplace' | 'my_listings'
type TypeFilter = 'all' | 'po' | 'product'

export default function MarketplacePage() {
  const router = useRouter()
  const user = useUser()
  const { isGhost } = useGhost()

  const [mainTab, setMainTab] = useState<MainTab>('marketplace')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('newest')
  const [searchInput, setSearchInput] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')

  const [listings, setListings] = useState<ListingWithPassport[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [myListings, setMyListings] = useState<ListingWithPassport[]>([])
  const [myListingsLoading, setMyListingsLoading] = useState(false)

  const [ownPassport, setOwnPassport] = useState<OwnPassport | null>(null)
  const [passportLoading, setPassportLoading] = useState(false)

  useEffect(() => {
    const orgId = user?.org_id
    if (!orgId) return
    setPassportLoading(true)
    fetch(`/api/passport/${orgId}`)
      .then(r => r.json())
      .then(data => {
        if (data.organization) {
          const org = data.organization
          setOwnPassport({
            passport_score: org.passport_score ?? null,
            network_visible: !!org.network_visible,
            legal_name: org.legal_name ?? null,
            doing_business_as: org.doing_business_as ?? null,
            type: org.type ?? '',
            trade_count_total: org.trade_count_total ?? null,
            trade_volume_total: org.trade_volume_total ?? null,
          })
        }
      })
      .catch(() => {})
      .finally(() => setPassportLoading(false))
  }, [user?.org_id])

  const fetchListings = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (committedSearch) qs.set('search', committedSearch)
      if (category) qs.set('category', category)
      if (typeFilter === 'po') qs.set('listing_type', 'po_request')
      if (typeFilter === 'product') qs.set('listing_type', 'product_service')
      qs.set('sort', sort)

      const res = await fetch(`/api/marketplace/listings?${qs}`)
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()
      setListings(data.listings ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setListings([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [committedSearch, category, typeFilter, sort])

  useEffect(() => {
    if (mainTab === 'marketplace') {
      fetchListings()
    }
  }, [fetchListings, mainTab])

  // Realtime: refresh listings when new listings are created or statuses change
  const realtimeRef = useRef<ReturnType<typeof createClient> | null>(null)
  useEffect(() => {
    const supabase = createClient()
    realtimeRef.current = supabase
    const channel = supabase
      .channel('marketplace-listings-list')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'marketplace_listings',
      }, () => { fetchListings() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchListings])

  useEffect(() => {
    if (mainTab !== 'my_listings') return
    setMyListingsLoading(true)
    fetch('/api/marketplace/listings?mine=true')
      .then(r => r.json())
      .then(data => setMyListings(data.listings ?? []))
      .catch(() => setMyListings([]))
      .finally(() => setMyListingsLoading(false))
  }, [mainTab])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setCommittedSearch(searchInput)
    }
  }

  const skeletons = Array.from({ length: 3 })

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Strike Place' }]}
        actions={
          <div className="topbar-right">
            {/* Ghost orgs browse only — actions route to Passport activation. */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => router.push(isGhost ? '/onboarding' : '/marketplace/listings/new')}
            >
              {isGhost ? 'Activate to Post' : 'Post a Listing'}
            </button>
            <button
              className="btn btn-blue btn-sm"
              onClick={() => { if (isGhost) router.push('/onboarding') }}
            >
              {isGhost ? 'Activate to Finance' : 'Finance an Existing Trade'}
            </button>
          </div>
        }
      />

      <div className="mp-page page" data-page-name="Marketplace" data-ai-context={JSON.stringify({
          role: (user as any)?.role,
          total_listings: total,
          active_tab: mainTab,
          type_filter: typeFilter,
          category,
          sort,
          search: committedSearch,
          my_listings_count: myListings.length,
          visible_listings: (mainTab === 'marketplace' ? listings : myListings).map(item => ({
            id: item.listing.id,
            type: item.listing.listing_type,
            title: item.listing.title,
            description: item.listing.description ?? null,
            category: item.listing.category ?? null,
            quantity: item.listing.quantity ?? null,
            unit: item.listing.unit ?? null,
            target_price: item.listing.target_price ?? null,
            currency: item.listing.currency,
            incoterms: item.listing.incoterms ?? null,
            payment_terms: item.listing.payment_terms ?? null,
            delivery_location: item.listing.delivery_location ?? null,
            delivery_deadline: item.listing.delivery_deadline ?? null,
            offer_count: item.listing.offer_count,
            ai_summary: item.listing.ai_summary ?? null,
            poster: item.poster_org ? {
              name: item.poster_org.doing_business_as ?? item.poster_org.legal_name,
              type: item.poster_org.type,
              passport_score: item.poster_org.passport_score,
              risk_tier: item.poster_org.risk_tier,
              trade_count: item.poster_org.trade_count_total,
              country: item.poster_org.country_of_origin,
            } : null,
          })),
        })}>
        <div className="mp-tabs">
          <button
            className={`mp-tab${mainTab === 'marketplace' ? ' mp-tab-active' : ''}`}
            onClick={() => setMainTab('marketplace')}
          >
            Strike Place
          </button>
          <button
            className={`mp-tab${mainTab === 'my_listings' ? ' mp-tab-active' : ''}`}
            onClick={() => setMainTab('my_listings')}
          >
            My Listings
          </button>
        </div>

        {mainTab === 'marketplace' && (
          <div className="mp-layout">
            <div className="mp-layout-main">
              {/* Search */}
              <div className="mp-search-bar">
                <input
                  type="text"
                  className="mp-search-input"
                  placeholder="Search listings by product, category, or organization..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setCommittedSearch(searchInput)}
                >
                  Search
                </button>
              </div>

              {/* Filters */}
              <div className="mp-filter-row">
                <select
                  className="mp-filter-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                <div className="mp-type-toggle">
                  {(['all', 'po', 'product'] as TypeFilter[]).map((t) => (
                    <button
                      key={t}
                      className={`mp-type-btn${typeFilter === t ? ' mp-type-btn-active' : ''}`}
                      onClick={() => setTypeFilter(t)}
                    >
                      {t === 'all' ? 'All' : t === 'po' ? 'PO Request' : 'Product / Service'}
                    </button>
                  ))}
                </div>

                <div className="mp-filter-spacer" />

                <select
                  className="mp-filter-select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="newest">Sort: Most Recent</option>
                  <option value="price_asc">Sort: Price ↑</option>
                  <option value="price_desc">Sort: Price ↓</option>
                </select>
              </div>

              {/* Ghost browse-only notice — listings stay visible; actions gated. */}
              {isGhost && (
                <div className="ghost-action-lock" style={{ marginBottom: 16 }}>
                  <p className="ghost-action-lock-title">You're browsing Strike Place</p>
                  <p className="ghost-action-lock-body">
                    Listings are visible to everyone. Activate your Passport to submit offers and request financing.
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => router.push('/onboarding')}
                  >
                    Activate Passport →
                  </button>
                </div>
              )}

              {/* Feed */}
              <div className="mp-listing-feed">
                {loading
                  ? skeletons.map((_, i) => (
                      <div
                        key={i}
                        className="mp-skeleton-card"
                        style={{ opacity: 1 - i * 0.2, animationDelay: `${i * 0.2}s` }}
                      />
                    ))
                  : listings.map((item) => (
                      <ListingCard key={item.listing.id} item={item} />
                    ))}
              </div>

              {!loading && listings.length === 0 && (
                <div className="mp-empty-state" style={{ marginTop: 20 }}>
                  <p className="mp-empty-title">No listings yet</p>
                  <p className="mp-empty-sub">
                    {committedSearch || category || typeFilter !== 'all'
                      ? 'No listings match your filters. Try adjusting your search.'
                      : 'Listings from verified organizations will appear here. Be one of the first.'}
                  </p>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 16 }}
                    onClick={() => router.push('/marketplace/listings/new')}
                  >
                    Post the first listing
                  </button>
                </div>
              )}

              {!loading && total > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--gray)', textAlign: 'center' }}>
                  Showing {listings.length} of {total} listings
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="mp-sidebar">
              <div className="card">
                <div className="card-head">Quick Stats</div>
                <div className="mp-quick-stats">
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">Listings</span>
                    <span className="mp-stat-value">{loading ? '—' : total}</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">Active Deals</span>
                    <span className="mp-stat-value">—</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">Orgs</span>
                    <span className="mp-stat-value">—</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">Volume</span>
                    <span className="mp-stat-value">—</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">Your Passport</div>
                {!user?.org_id ? (
                  <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--gray)', textAlign: 'center' }}>
                    Your account is not linked to an organization.
                  </div>
                ) : passportLoading ? (
                  <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--gray)', textAlign: 'center' }}>Loading…</div>
                ) : ownPassport && !ownPassport.network_visible ? (
                  <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
                    <PassportScoreRing score={ownPassport.passport_score} size="md" showLabel pendingLabel="Passport Inactive" />
                    <p style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5 }}>
                      Activate your Passport to publish your profile and appear in search results.
                    </p>
                    <button
                      className="btn btn-blue btn-sm"
                      style={{ width: '100%' }}
                      onClick={() => router.push('/onboarding')}
                    >
                      Activate Passport →
                    </button>
                  </div>
                ) : ownPassport ? (
                  <>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <PassportScoreRing score={ownPassport.passport_score} size="md" showLabel />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                          {ownPassport.doing_business_as ?? ownPassport.legal_name ?? 'Your Organization'}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 2 }}>
                          {ownPassport.type}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 20, width: '100%', justifyContent: 'center' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                            {ownPassport.trade_count_total ?? '—'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>Trades</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                            {formatVolume(ownPassport.trade_volume_total)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>Volume</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: '0 14px 14px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ width: '100%' }}
                        onClick={() => router.push('/passport')}
                      >
                        View Full Passport
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--gray)', textAlign: 'center' }}>
                    Passport not available.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {mainTab === 'my_listings' && (
          <div className="mp-layout">
            <div className="mp-layout-main">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => router.push('/marketplace/listings/new')}
                >
                  + Post New Listing
                </button>
              </div>
              {myListingsLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="mp-skeleton-card" style={{ opacity: 1 - i * 0.3 }} />
                ))
              ) : myListings.length === 0 ? (
                <div className="mp-empty-state">
                  <p className="mp-empty-title">No listings yet</p>
                  <p className="mp-empty-sub">Post your first listing to appear on Strike Place.</p>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 16 }}
                    onClick={() => router.push('/marketplace/listings/new')}
                  >
                    Post a Listing
                  </button>
                </div>
              ) : (
                <div className="mp-listing-feed">
                  {myListings.map((item) => (
                    <ListingCard key={item.listing.id} item={item} isOwn />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
