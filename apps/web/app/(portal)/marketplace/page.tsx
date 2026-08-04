'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/portal-shell'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import { useGhost } from '@/lib/use-ghost'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { SkeletonCard, Skeleton, SkeletonText } from '@/components/motion'
import type { ListingWithPassport } from '@strike-scf/types'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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

// AI-generated summaries sometimes lead with a markdown heading (e.g. "# Trade
// Listing Summary") that duplicates the card's own title — strip it so the card
// shows clean prose instead of raw markdown syntax.
function cleanSummary(s: string): string {
  return s.replace(/^#{1,6}\s+[^\n]*\n*/, '').trim()
}

function ListingImageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.8" cy="7.3" r="1.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 13.5l4-4 3 3 3.5-3.5 4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StackIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 2.5h9a1.5 1.5 0 011.5 1.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PosterOrg({ org, bordered = true }: { org: NonNullable<ListingWithPassport['poster_org']>; bordered?: boolean }) {
  const t = useT()
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      ...(bordered ? { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' } : {}),
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
          {org.type} · {t('marketplace.tradeCount', { count: org.trade_count_total ?? 0 })} · {formatVolume(org.trade_volume_total)}
        </div>
      </div>
    </div>
  )
}

function ListingCard({ item, isOwn = false }: { item: ListingWithPassport & { line_items_total?: number | null }; isOwn?: boolean }) {
  const router = useRouter()
  const t = useT()
  const { listing, poster_org } = item
  const [imgIndex, setImgIndex] = useState(0)

  const rawPrice = (item as any).line_items_total ?? listing.target_price
  const price = rawPrice != null
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(rawPrice)
    : null
  const isTotal = (item as any).line_items_total != null
  const deadline = formatDeadline(listing.delivery_deadline)
  const images = listing.image_urls?.length ? listing.image_urls : (listing.cover_image_url ? [listing.cover_image_url] : [])
  const activeIdx = Math.min(imgIndex, images.length - 1)

  function prevImage(e: React.MouseEvent) {
    e.stopPropagation()
    setImgIndex(i => (Math.min(i, images.length - 1) - 1 + images.length) % images.length)
  }
  function nextImage(e: React.MouseEvent) {
    e.stopPropagation()
    setImgIndex(i => (Math.min(i, images.length - 1) + 1) % images.length)
  }

  return (
    <div
      className="listing-card card-interactive"
      onClick={() => router.push(`/marketplace/listings/${listing.id}`)}
      data-demo-target={`listing-card-${listing.id}`}
    >
      <div className="listing-card-image-wrap">
        {images.length > 0 ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[activeIdx]} alt={listing.title} className="listing-card-image" />
            {images.length > 1 && (
              <>
                <button type="button" className="listing-image-arrow listing-image-arrow-prev" onClick={prevImage} aria-label={t('newListing.previousPhoto')}>‹</button>
                <button type="button" className="listing-image-arrow listing-image-arrow-next" onClick={nextImage} aria-label={t('newListing.nextPhoto')}>›</button>
                <span className="listing-image-count-badge">
                  <StackIcon />{activeIdx + 1}/{images.length}
                </span>
              </>
            )}
          </>
        ) : (
          <div className="listing-card-image-placeholder">
            <ListingImageIcon />
          </div>
        )}
      </div>
      <div className="listing-card-head">
        <span className={`listing-type-badge ${listing.listing_type === 'po_request' ? 'listing-type-po' : 'listing-type-product'}`}>
          {listing.listing_type === 'po_request' ? t('passport.poRequest') : t('passport.productService')}
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
              ? <span className="listing-price-unit">{t('marketplace.total')}</span>
              : listing.unit && <span className="listing-price-unit">/ {listing.unit}</span>
            }
          </div>
        )}

        <div className="listing-details-row">
          {listing.quantity != null && listing.unit && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">{t('marketplace.quantity')}</span>
              <span className="listing-detail-value">{listing.quantity} {listing.unit}</span>
            </div>
          )}
          {deadline && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">{t('marketplace.deadline')}</span>
              <span className="listing-detail-value">{t('marketplace.due')} {deadline}</span>
            </div>
          )}
          {listing.delivery_location && (
            <div className="listing-detail-item">
              <span className="listing-detail-label">{t('marketplace.location')}</span>
              <span className="listing-detail-value">{listing.delivery_location}</span>
            </div>
          )}
        </div>

        {listing.ai_summary && (
          <div className="listing-ai-summary">{cleanSummary(listing.ai_summary)}</div>
        )}
      </div>

      <div className="listing-card-footer">
        {!isOwn && poster_org && (
          <div className="listing-card-footer-row">
            <PosterOrg org={poster_org} bordered={false} />
          </div>
        )}
        <div className="listing-card-footer-row">
          {!isOwn && (
            <span className="listing-offer-badge">
              <span className="listing-offer-badge-count">{listing.offer_count ?? 0}</span>
              &nbsp;{(listing.offer_count ?? 0) !== 1 ? t('marketplace.offersPlural') : t('marketplace.offerSingular')}
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
              {isOwn ? t('marketplace.view') : t('marketplace.viewAndOffer')}
            </button>
          </div>
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
  const t = useT()
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

  const [quickStats, setQuickStats] = useState<{ active_deals: number; orgs: number; volume: number } | null>(null)

  useEffect(() => {
    fetch('/api/marketplace/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setQuickStats(d) })
      .catch(() => {})
  }, [])

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
  // (gracefully degrades if WebSocket is blocked — listings still load via fetchListings)
  const realtimeRef = useRef<ReturnType<typeof createClient> | null>(null)
  useEffect(() => {
    let supabase: ReturnType<typeof createClient> | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null
    try {
      supabase = createClient()
      realtimeRef.current = supabase
      channel = supabase
        .channel('marketplace-listings-list')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'marketplace_listings',
        }, () => { fetchListings() })
        .subscribe()
    } catch { /* realtime unavailable — page still works without live updates */ }
    return () => { if (supabase && channel) supabase.removeChannel(channel) }
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
        crumbs={[{ label: t('nav.strikePlace') }]}
        actions={
          <div className="topbar-right">
            {/* Ghost orgs browse only — actions route to Passport activation. */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => router.push(isGhost ? '/onboarding' : '/marketplace/listings/new')}
            >
              {isGhost ? t('marketplace.activateToPost') : t('marketplace.postAListing')}
            </button>
            <button
              className="btn btn-blue btn-sm"
              onClick={() => { if (isGhost) router.push('/onboarding') }}
            >
              {isGhost ? t('marketplace.activateToFinance') : t('marketplace.financeExistingTrade')}
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
        <div className="mp-tabs reveal">
          <button
            className={`mp-tab${mainTab === 'marketplace' ? ' mp-tab-active' : ''}`}
            onClick={() => setMainTab('marketplace')}
          >
            {t('nav.strikePlace')}
          </button>
          <button
            className={`mp-tab${mainTab === 'my_listings' ? ' mp-tab-active' : ''}`}
            onClick={() => setMainTab('my_listings')}
          >
            {t('marketplace.myListings')}
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
                  placeholder={t('marketplace.searchPlaceholder')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setCommittedSearch(searchInput)}
                >
                  {t('marketplace.search')}
                </button>
              </div>

              {/* Filters */}
              <div className="mp-filter-row reveal">
                <select
                  className="mp-filter-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">{t('marketplace.allCategories')}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                <div className="mp-type-toggle">
                  {(['all', 'po', 'product'] as TypeFilter[]).map((tf) => (
                    <button
                      key={tf}
                      className={`mp-type-btn${typeFilter === tf ? ' mp-type-btn-active' : ''}`}
                      onClick={() => setTypeFilter(tf)}
                    >
                      {tf === 'all' ? t('common.all') : tf === 'po' ? t('passport.poRequest') : t('passport.productService')}
                    </button>
                  ))}
                </div>

                <div className="mp-filter-spacer" />

                <select
                  className="mp-filter-select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="newest">{t('marketplace.sortMostRecent')}</option>
                  <option value="price_asc">{t('marketplace.sortPriceAsc')}</option>
                  <option value="price_desc">{t('marketplace.sortPriceDesc')}</option>
                </select>
              </div>

              {/* Ghost browse-only notice — listings stay visible; actions gated. */}
              {isGhost && (
                <div className="ghost-action-lock" style={{ marginBottom: 16 }}>
                  <p className="ghost-action-lock-title">{t('marketplace.browsingStrikePlace')}</p>
                  <p className="ghost-action-lock-body">
                    {t('marketplace.browsingHint')}
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => router.push('/onboarding')}
                  >
                    {t('marketplace.activatePassport')}
                  </button>
                </div>
              )}

              {/* Feed */}
              <div className="mp-listing-grid reveal-stagger" data-demo-target="marketplace-grid">
                {loading
                  ? skeletons.map((_, i) => (
                      <SkeletonCard key={i} height={220} />
                    ))
                  : listings.map((item) => (
                      <ListingCard key={item.listing.id} item={item} />
                    ))}
              </div>

              {!loading && listings.length === 0 && (
                <div className="mp-empty-state" style={{ marginTop: 20 }}>
                  <div className="mp-empty-icon float-slow">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2h10v12l-2-1.2-2 1.2-2-1.2-2 1.2L3 13zM5.5 6h5M5.5 9h5" />
                    </svg>
                  </div>
                  <p className="mp-empty-title">{t('marketplace.noListingsYet')}</p>
                  <p className="mp-empty-sub">
                    {committedSearch || category || typeFilter !== 'all'
                      ? t('marketplace.noListingsMatchFilters')
                      : t('marketplace.noListingsHint')}
                  </p>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 16 }}
                    onClick={() => router.push('/marketplace/listings/new')}
                  >
                    {t('marketplace.postFirstListing')}
                  </button>
                </div>
              )}

              {!loading && total > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--gray)', textAlign: 'center' }}>
                  {t('marketplace.showingOfListings', { shown: listings.length, total })}
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="mp-sidebar">
              <div className="card">
                <div className="card-head">{t('marketplace.quickStats')}</div>
                <div className="mp-quick-stats">
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">{t('marketplace.listings')}</span>
                    <span className="mp-stat-value">{loading ? '—' : total}</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">{t('marketplace.activeDeals')}</span>
                    <span className="mp-stat-value">{quickStats ? quickStats.active_deals : '—'}</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">{t('marketplace.orgs')}</span>
                    <span className="mp-stat-value">{quickStats ? quickStats.orgs : '—'}</span>
                  </div>
                  <div className="mp-stat-cell">
                    <span className="mp-stat-label">{t('marketplace.volume')}</span>
                    <span className="mp-stat-value">{quickStats ? formatVolume(quickStats.volume) : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">{t('marketplace.yourPassport')}</div>
                {!user?.org_id ? (
                  <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--gray)', textAlign: 'center' }}>
                    {t('marketplace.accountNotLinked')}
                  </div>
                ) : passportLoading ? (
                  <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Skeleton circle width={48} height={48} />
                    <Skeleton width={110} height={12} />
                    <div style={{ width: '100%' }}><SkeletonText lines={1} widths={['60%']} /></div>
                  </div>
                ) : ownPassport && !ownPassport.network_visible ? (
                  <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
                    <PassportScoreRing score={ownPassport.passport_score} size="md" showLabel pendingLabel={t('marketplace.passportInactive')} />
                    <p style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5 }}>
                      {t('marketplace.activatePassportHint')}
                    </p>
                    <button
                      className="btn btn-blue btn-sm"
                      style={{ width: '100%' }}
                      onClick={() => router.push('/onboarding')}
                    >
                      {t('marketplace.activatePassport')}
                    </button>
                  </div>
                ) : ownPassport ? (
                  <>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <PassportScoreRing score={ownPassport.passport_score} size="md" showLabel />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                          {ownPassport.doing_business_as ?? ownPassport.legal_name ?? t('marketplace.yourOrganization')}
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
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{t('marketplace.trades')}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                            {formatVolume(ownPassport.trade_volume_total)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{t('marketplace.volume')}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: '0 14px 14px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ width: '100%' }}
                        onClick={() => router.push('/passport')}
                      >
                        {t('marketplace.viewFullPassport')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--gray)', textAlign: 'center' }}>
                    {t('marketplace.passportNotAvailable')}
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
                  + {t('marketplace.postNewListing')}
                </button>
              </div>
              {myListingsLoading ? (
                <div className="reveal-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {Array.from({ length: 2 }).map((_, i) => (
                    <SkeletonCard key={i} height={220} />
                  ))}
                </div>
              ) : myListings.length === 0 ? (
                <div className="mp-empty-state">
                  <div className="mp-empty-icon float-slow">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2h10v12l-2-1.2-2 1.2-2-1.2-2 1.2L3 13zM5.5 6h5M5.5 9h5" />
                    </svg>
                  </div>
                  <p className="mp-empty-title">{t('marketplace.noListingsYet')}</p>
                  <p className="mp-empty-sub">{t('marketplace.postFirstListingHint')}</p>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 16 }}
                    onClick={() => router.push('/marketplace/listings/new')}
                  >
                    {t('marketplace.postAListing')}
                  </button>
                </div>
              ) : (
                <div className="mp-listing-grid reveal-stagger">
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
