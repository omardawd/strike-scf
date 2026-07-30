'use client'
import React, { useState, useEffect } from 'react'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { AIInsight } from '@/components/ai-insight'
import { AIInsightCard } from '@/components/ai-insight-card'
import { SupplyGraph } from '@/components/supply-graph'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { CountUp, Skeleton, SkeletonCard } from '@/components/motion'
import { useT } from '@/lib/i18n/locale-context'
import {
  Topbar, DashboardHeader, ActionQueueStrip, KpiStrip, PassportBanner, AgentActivityTicker, DealTable,
  fmtCurrency, fmtRelTime, dealStatusClass,
  type NotifItem, type DealItem, type PassportData, type ActionCard, type KpiItem,
} from '@/components/dashboard/shared'

// ─── Types ────────────────────────────────────────────────────────────────────
interface BankData {
  portal: 'bank'
  bank_name: string | null
  program_count: number
  active_program_count: number
  enrolled_org_count: number
  kyb_pending: number
  pending_bank_review: number
  active_transactions: number
  outstanding_balance: number
  avg_rate?: number | null
  // TC.6 — portfolio PassportScore distribution (replaces KYB Queue widget)
  passport_distribution?: {
    total: number
    avg_score: number | null
    strong: number
    fair: number
    weak: number
    pending: number
  }
}
interface AnchorData {
  portal: 'anchor'
  org_name: string | null
  programs: Array<{ id: string; name: string; financing_types: string[]; status: string }>
  enrolled_supplier_count: number
  pending_approval: number
}
interface SupplierData {
  portal: 'supplier'
  org_name: string | null
  programs: Array<{ id: string; name: string; financing_types: string[]; status: string }>
  active_transactions: number
  performance_tier?: string
  performance_score?: number | null
  on_time_rate?: number | null
  total_financed?: number
}

interface FinancingItem {
  request: {
    id: string
    amount_requested: number
    structure_type: string
    status: string
    ai_risk_assessment: string | null
    offer_count: number
  }
  buyer_passport: { legal_name: string | null; passport_score: number | null } | null
  supplier_passport: { legal_name: string | null; passport_score: number | null } | null
  all_offers_count: number
}

// Deal value: total_value is only populated late in the flow; agreed_price
// carries the value from the moment a deal is struck. Fall back so in-progress
// deals never read as $0.
function dealValue(d: { total_value: number | null; agreed_price: number | null }): number {
  return Number(d.total_value ?? d.agreed_price ?? 0)
}

interface ListingItem {
  listing: { id: string; title: string; offer_count: number; status: string }
}

interface OrgFinancingReq {
  id: string
  amount_requested: number
  structure_type: string
  status: string
  offer_count: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function greetingKey(): string {
  const h = new Date().getHours()
  if (h < 12) return 'dashboard.goodMorning'
  if (h < 17) return 'dashboard.goodAfternoon'
  return 'dashboard.goodEvening'
}

function todayFull(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtStructureType(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function financingStatusClass(status: string): string {
  switch (status) {
    case 'open':            return 'badge-active'
    case 'offers_received': return 'badge-offer'
    case 'accepted':        return 'badge-funded'
    case 'funded':          return 'badge-completed'
    default:                return 'badge-draft'
  }
}

function structureBadgeClass(s: string): string {
  switch (s) {
    case 'open':   return 'badge-active'
    case 'custom': return 'badge-signing'
    case 'preset': return 'badge-funded'
    default:       return 'badge-draft'
  }
}

// ─── BANK DASHBOARD ──────────────────────────────────────────────────────────
// TC.6 — PassportScore Overview widget. Distribution of portfolio passport_scores;
// replaces the bank "KYB Queue" widget (banks evaluate via PassportScore, not KYB).
function PassportOverviewWidget({
  dist,
  loading,
}: {
  dist?: { total: number; avg_score: number | null; strong: number; fair: number; weak: number; pending: number }
  loading: boolean
}) {
  const segments = dist
    ? [
        { key: 'strong',  label: 'Strong 70+',  value: dist.strong,  color: 'var(--color-green)' },
        { key: 'fair',    label: 'Fair 45–69',  value: dist.fair,    color: 'var(--color-amber)' },
        { key: 'weak',    label: 'Weak <45',    value: dist.weak,    color: 'var(--color-red)' },
        { key: 'pending', label: 'Pending',     value: dist.pending, color: 'var(--gray-soft)' },
      ]
    : []
  const total = dist?.total ?? 0

  return (
    <div className="card">
      <div className="card-head">
        <span>PassportScore Overview</span>
        <a href="/reporting" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>Portfolio →</a>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        {loading ? (
          <Skeleton height={48} />
        ) : !dist || total === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gray)', textAlign: 'center', padding: '12px 0' }}>
            No counterparties in your portfolio yet.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <PassportScoreRing score={dist.avg_score} size="sm" />
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>
                  Avg PassportScore
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
                  <CountUp value={dist.avg_score ?? NaN} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--gray)' }}>{total} counterpart{total === 1 ? 'y' : 'ies'}</div>
              </div>
            </div>

            {/* Distribution bar */}
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--border)', marginBottom: 12 }}>
              {segments.filter(s => s.value > 0).map(s => (
                <div key={s.key} title={`${s.label}: ${s.value}`} style={{ flex: s.value, background: s.color }} />
              ))}
            </div>

            <div className="reveal-stagger" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {segments.map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--gray)', flex: 1 }}>{s.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    <CountUp value={s.value} />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BankDashboard() {
  const user = useUser()
  const router = useRouter()
  const t = useT()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<BankData | null>(null)
  const [financing, setFinancing] = useState<FinancingItem[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([dash, fin, notifs]) => {
      if (dash?.portal === 'bank') setDashData(dash as BankData)
      const rawRequests: unknown[] = (fin as any)?.requests ?? []
      setFinancing(rawRequests.slice(0, 5) as FinancingItem[])
      setNotifications(((notifs as any)?.notifications ?? []) as NotifItem[])
      setLoading(false)
    })
  }, [])

  // TC.6 — banks no longer approve KYB; the KYB review queue is removed from the
  // bank dashboard. Counterparties are evaluated via PassportScore (widget below).
  const openFinancing = financing.length
  const txnsPending = dashData?.pending_bank_review ?? 0
  const attentionCount = openFinancing + txnsPending

  const actionCards: ActionCard[] = [
    { color: 'var(--blue)', label: `${openFinancing} open Strike Place request${openFinancing !== 1 ? 's' : ''}`, count: openFinancing, href: '/marketplace/financing' },
    { color: 'var(--color-amber)', label: `${txnsPending} transaction${txnsPending !== 1 ? 's' : ''} awaiting review`, count: txnsPending, href: '/transactions' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Programs',    value: dashData?.active_program_count ?? 0, sub: dashData ? `${dashData.program_count} total` : undefined, icon: 'programs', tint: 'var(--blue)' },
    { label: 'Outstanding Balance', value: dashData?.outstanding_balance ?? 0, format: fmtCurrency, valueColor: 'var(--blue)', icon: 'balance', tint: 'var(--blue)' },
    { label: 'Avg Financing Rate', value: dashData?.avg_rate ?? null, format: (n) => `${n}%`, icon: 'rate', tint: 'var(--color-purple)' },
    { label: 'Enrolled Orgs',     value: dashData?.enrolled_org_count ?? 0, icon: 'org', tint: 'var(--color-green)' },
  ]

  const bankAiContext = JSON.stringify({
    page: 'bank_dashboard',
    role: 'bank',
    bank: dashData?.bank_name ?? null,
    active_programs: dashData?.active_program_count ?? null,
    enrolled_orgs: dashData?.enrolled_org_count ?? null,
    pending_review: dashData?.pending_bank_review ?? null,
    active_transactions: dashData?.active_transactions ?? null,
    outstanding_balance: dashData?.outstanding_balance ?? null,
    avg_financing_rate: dashData?.avg_rate ?? null,
    open_financing_requests: openFinancing,
    portfolio_avg_passport_score: dashData?.passport_distribution?.avg_score ?? null,
    portfolio_weak_scores: dashData?.passport_distribution?.weak ?? null,
  })

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page"
        data-page-name="Dashboard"
        data-ai-context={bankAiContext}
      >

        {/* 1. Page header */}
        <DashboardHeader
          eyebrow={`${dashData?.bank_name ?? 'Bank'} · Command Center`}
          title={t(greetingKey(), { name: firstName })}
          subtitle={
            loading ? <Skeleton height={14} width={180} />
              : attentionCount > 0
              ? `${attentionCount} item${attentionCount !== 1 ? 's' : ''} need your attention · ${todayFull()}`
              : `Everything is up to date · ${todayFull()}`
          }
        />

        {dashData && (
          <div style={{ marginBottom: 24 }}>
            <AIInsightCard
              variant="banner"
              portal="bank"
              page="dashboard"
              context={{
                bank_name: dashData.bank_name,
                active_programs: dashData.active_program_count,
                total_programs: dashData.program_count,
                enrolled_orgs: dashData.enrolled_org_count,
                kyb_pending: dashData.kyb_pending,
                pending_bank_review: dashData.pending_bank_review,
                active_transactions: dashData.active_transactions,
                outstanding_balance: dashData.outstanding_balance,
              }}
            />
          </div>
        )}

        {/* 2. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 3. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 4. Two-column */}
        <div className="split-65 reveal-stagger" style={{ marginBottom: 24 }}>

          {/* LEFT — Strike Place */}
          <div className="card">
            <div className="card-head">
              <span>Strike Place</span>
              <a href="/marketplace/financing" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[1, 2, 3].map(i => <SkeletonCard key={i} height={96} />)}
              </div>
            ) : financing.length === 0 ? (
              <div className="float-slow" style={{ padding: '36px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>No open financing requests right now</div>
                <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Check back soon or browse Strike Place.</div>
                <a href="/marketplace/financing" className="btn btn-sm btn-ghost">Browse Strike Place →</a>
              </div>
            ) : (
              <div className="reveal-stagger">
                {financing.map((item) => (
                  <div
                    key={item.request.id}
                    className="card-interactive"
                    onClick={() => router.push(`/marketplace/financing/${item.request.id}`)}
                    style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', flexDirection: 'column', gap: 10,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
                        letterSpacing: '-0.02em', color: 'var(--ink)',
                      }}>
                        <CountUp value={item.request.amount_requested} format={fmtCurrency} />
                      </span>
                      <span className={`badge ${structureBadgeClass(item.request.structure_type)}`}>
                        {fmtStructureType(item.request.structure_type)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <PassportScoreRing score={item.buyer_passport?.passport_score ?? null} size="sm" />
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Buyer</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <PassportScoreRing score={item.supplier_passport?.passport_score ?? null} size="sm" />
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Supplier</span>
                      </div>
                      {item.request.ai_risk_assessment && (
                        <div style={{
                          flex: 1, fontSize: 12, color: 'var(--gray)', fontStyle: 'italic',
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                        }}>
                          {item.request.ai_risk_assessment}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <a href={`/marketplace/financing/${item.request.id}`} className="btn btn-sm btn-blue" onClick={(e) => e.stopPropagation()}>Submit Offer</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT — PassportScore Overview + Recent Activity + AI Insight */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* TC.6 — PassportScore Overview (replaces the KYB Queue widget) */}
            <PassportOverviewWidget dist={dashData?.passport_distribution} loading={loading} />

            <div className="card">
              <div className="card-head">
                <span>Recent Activity</span>
              </div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1, 2, 3].map(i => <Skeleton key={i} height={12} />)}
                </div>
              ) : notifications.length === 0 ? (
                <div className="float-slow" style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
                  No recent activity
                </div>
              ) : (
                <div className="dash-activity reveal-stagger">
                  {notifications.map(n => (
                    <div key={n.id} className="dash-act-row">
                      <div className={`dash-act-dot ${n.read ? '' : 'tone-blue'}`} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="dash-act-text" style={{ fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--gray)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.body}</div>
                      </div>
                      <div className="dash-act-time">{fmtRelTime(n.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--blue)' }}>
                View all notifications →
              </div>
            </div>

            <AIInsight
              title="Portfolio Insight"
              collapsed={true}
              prompt="Based on this bank's portfolio, what is the single most important action the bank should take today? Be specific and direct."
              context={{
                active_programs: dashData?.active_program_count ?? 0,
                portfolio_avg_passport_score: dashData?.passport_distribution?.avg_score ?? null,
                portfolio_weak_scores: dashData?.passport_distribution?.weak ?? 0,
                transactions_pending_review: dashData?.pending_bank_review ?? 0,
                outstanding_balance: dashData?.outstanding_balance ?? 0,
                enrolled_orgs: dashData?.enrolled_org_count ?? 0,
                open_strike_place_requests: openFinancing,
              }}
            />
          </div>
        </div>

        {/* 5. Supply graph */}
        <SupplyGraph bankId={''} />
      </div>
    </>
  )
}

// ─── ANCHOR (BUYER) DASHBOARD ────────────────────────────────────────────────
function AnchorDashboard() {
  const user = useUser()
  const router = useRouter()
  const t = useT()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<AnchorData | null>(null)
  const [deals, setDeals] = useState<DealItem[]>([])
  const [listings, setListings] = useState<ListingItem[]>([])
  const [financing, setFinancing] = useState<OrgFinancingReq[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [passport, setPassport] = useState<PassportData | null>(null)

  useEffect(() => {
    const orgId = user?.org_id
    const base: Promise<unknown>[] = [
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/deals').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/listings?own=true&limit=3').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
      orgId
        ? fetch(`/api/passport/${orgId}`).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
    ]

    Promise.all(base).then(([dash, dealsRes, listRes, finRes, notifRes, passRes]) => {
      if ((dash as any)?.portal === 'anchor') setDashData(dash as AnchorData)
      setDeals(((dealsRes as any)?.deals ?? []) as DealItem[])
      setListings((((listRes as any)?.listings ?? []) as ListingItem[]).slice(0, 3))
      setFinancing((((finRes as any)?.requests ?? []) as OrgFinancingReq[]).slice(0, 3))
      setNotifications(((notifRes as any)?.notifications ?? []) as NotifItem[])
      if (passRes) setPassport(passRes as PassportData)
      setLoading(false)
    })
  }, [user?.org_id])

  const activeDeals = deals.filter(d => !['completed', 'cancelled'].includes(d.status))
  const tradingDeals = deals.filter(d => d.status !== 'cancelled')
  const tradeVolume = tradingDeals.reduce((s, d) => s + dealValue(d), 0)
  const completedDealCount = deals.filter(d => d.status === 'completed').length
  const financingActiveAmt = financing.filter(f => ['open', 'offers_received', 'accepted'].includes(f.status)).reduce((s, f) => s + f.amount_requested, 0)

  const dealsNeedingAction = deals.filter(d => d.status === 'negotiating' && d.user_role === 'buyer').length
  const listingsWithOffersList = listings.filter(l => l.listing.offer_count > 0)
  const listingsWithOffers = listingsWithOffersList.length
  const financingWithOffers = financing.filter(f => f.status === 'offers_received').length

  // Deep-link straight to the listing when there's exactly one with offers;
  // otherwise land on Strike Place so the user can pick from "My Listings".
  const listingsWithOffersHref = listingsWithOffers === 1 && listingsWithOffersList[0]
    ? `/marketplace/listings/${listingsWithOffersList[0].listing.id}`
    : '/marketplace'

  const actionCards: ActionCard[] = [
    { color: 'var(--color-amber)', label: `${dealsNeedingAction} deal${dealsNeedingAction !== 1 ? 's' : ''} awaiting your action`, count: dealsNeedingAction, href: '/deals' },
    { color: 'var(--blue)', label: `${listingsWithOffers} listing${listingsWithOffers !== 1 ? 's' : ''} with offers`, count: listingsWithOffers, href: listingsWithOffersHref },
    { color: 'var(--color-green)', label: `${financingWithOffers} financing offer${financingWithOffers !== 1 ? 's' : ''} received`, count: financingWithOffers, href: '/marketplace/financing' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Deals',         value: activeDeals.length, icon: 'deals', tint: 'var(--blue)' },
    { label: 'Trade Volume',         value: tradeVolume, format: fmtCurrency, sub: completedDealCount > 0 ? `${completedDealCount} completed` : 'Active + completed', valueColor: tradeVolume > 0 ? 'var(--color-green)' : undefined, icon: 'volume', tint: 'var(--color-green)' },
    { label: 'Financing Active',     value: financingActiveAmt, format: fmtCurrency, valueColor: financingActiveAmt > 0 ? 'var(--blue)' : undefined, icon: 'financing', tint: 'var(--color-purple)' },
    { label: 'Strike Place Listings', value: listings.length, icon: 'listings', tint: 'var(--color-amber)' },
  ]

  const anchorAiContext = JSON.stringify({
    page: 'anchor_dashboard',
    role: 'buyer',
    org: dashData?.org_name ?? null,
    passport_score: (passport as any)?.organization?.passport_score ?? null,
    active_deals: activeDeals.length,
    deals_needing_action: dealsNeedingAction,
    listings: listings.length,
    listings_with_offers: listingsWithOffers,
    financing_active_amount: financingActiveAmt,
    financing_with_new_offers: financingWithOffers,
    trade_volume: tradeVolume,
    completed_deals: completedDealCount,
    active_deal_list: activeDeals.slice(0, 5).map(d => ({
      status: d.status,
      value: (d as any).total_value ?? null,
      role: d.user_role,
    })),
  })

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page"
        data-page-name="Dashboard"
        data-ai-context={anchorAiContext}
      >

        {/* 1. Header */}
        <DashboardHeader
          title={t(greetingKey(), { name: firstName })}
          subtitle={`${dashData?.org_name ?? ''}${dashData?.org_name ? ' · ' : ''}${todayFull()}`}
        />

        {/* AI Overview — only mount after data loads so context is populated */}
        {!loading && (
          <div style={{ marginBottom: 20 }}>
            <AIInsightCard
              variant="banner"
              portal="anchor"
              page="dashboard"
              context={{
                org_name: dashData?.org_name,
                active_deals: activeDeals.length,
                deals_needing_action: dealsNeedingAction,
                listings_with_offers: listingsWithOffers,
                pending_financing: financing?.length ?? 0,
                trade_volume: tradeVolume,
              }}
            />
          </div>
        )}

        {/* 2. PassportScore banner */}
        <PassportBanner passport={passport} loading={loading} size="md" />
        <AgentActivityTicker />

        {/* 3. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 4. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 5. Two-column */}
        <div className="split-65 reveal-stagger" style={{ marginBottom: 24 }}>

          {/* LEFT — My Deals */}
          <div className="card">
            <div className="card-head">
              <span>Active Deals</span>
              <a href="/deals" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            <DealTable
              deals={deals}
              loading={loading}
              emptyTitle="No active deals yet."
              emptySub=""
              emptyCta={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/marketplace" className="btn btn-sm btn-blue">Browse Strike Place</a>
                  <a href="/deals/import" className="btn btn-sm btn-ghost">Finance Existing Trade</a>
                </div>
              }
            />
          </div>

          {/* RIGHT — My Listings + Financing */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head">
                <span>My Listings</span>
                <a href="/marketplace/listings/new" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>+ New</a>
              </div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2].map(i => <Skeleton key={i} height={14} />)}
                </div>
              ) : listings.length === 0 ? (
                <div className="float-slow" style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No listings yet</div>
              ) : (
                <div className="reveal-stagger">
                  {listings.map(item => (
                    <div
                      key={item.listing.id}
                      className="card-interactive"
                      onClick={() => router.push(`/marketplace/listings/${item.listing.id}`)}
                      style={{
                        padding: '10px 16px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {item.listing.title}
                      </div>
                      {item.listing.offer_count > 0 && (
                        <span className="badge badge-offer">{item.listing.offer_count} offer{item.listing.offer_count !== 1 ? 's' : ''}</span>
                      )}
                      <span className={`badge ${dealStatusClass(item.listing.status)}`}>{item.listing.status}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/marketplace/listings/new" className="btn btn-sm btn-primary" style={{ display: 'block', textAlign: 'center' }}>Post a Listing</a>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span>Financing Requests</span></div>
              {loading ? (
                <div style={{ padding: 16 }}><Skeleton height={14} /></div>
              ) : financing.length === 0 ? (
                <div className="float-slow" style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No financing requests yet</div>
              ) : (
                <div className="reveal-stagger">
                  {financing.map(f => (
                    <div
                      key={f.id}
                      className="card-interactive"
                      onClick={() => router.push(`/marketplace/financing/${f.id}`)}
                      style={{
                        padding: '10px 16px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
                          <CountUp value={f.amount_requested} format={fmtCurrency} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{fmtStructureType(f.structure_type)}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span className={`badge ${financingStatusClass(f.status)}`}>{f.status.replace(/_/g, ' ')}</span>
                        {f.offer_count > 0 && <span style={{ fontSize: 11, color: 'var(--gray)' }}>{f.offer_count} offer{f.offer_count !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/deals" className="btn btn-sm btn-ghost" style={{ display: 'block', textAlign: 'center' }}>Request Financing</a>
              </div>
            </div>
          </div>
        </div>

        {/* 6. AI Insight */}
        <AIInsight
          title="Trade Intelligence"
          collapsed={true}
          prompt={`This buyer has ${activeDeals.length} active deals and $${tradeVolume.toFixed(0)} in total trade volume across active and completed deals. They have ${listings.length} Strike Place listings and ${financing.length} financing requests. What should they focus on today to accelerate their trade activity?`}
          context={{
            active_deals: activeDeals.length,
            trade_volume: tradeVolume,
            marketplace_listings: listings.length,
            financing_requests: financing.length,
            listings_with_offers: listingsWithOffers,
            financing_with_offers: financingWithOffers,
          }}
        />
      </div>
    </>
  )
}

// ─── SUPPLIER DASHBOARD ──────────────────────────────────────────────────────
function SupplierDashboard() {
  const user = useUser()
  const t = useT()
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'
  const [loading, setLoading] = useState(true)
  const [dashData, setDashData] = useState<SupplierData | null>(null)
  const [deals, setDeals] = useState<DealItem[]>([])
  const [financing, setFinancing] = useState<OrgFinancingReq[]>([])
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [passport, setPassport] = useState<PassportData | null>(null)
  const [pendingNetworks, setPendingNetworks] = useState<any[]>([])
  const router = useRouter()

  useEffect(() => {
    const orgId = user?.org_id
    const base: Promise<unknown>[] = [
      fetch('/api/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/deals').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/financing').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/notifications?unread_only=true&limit=5').then(r => r.ok ? r.json() : null).catch(() => null),
      orgId
        ? fetch(`/api/passport/${orgId}`).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      fetch('/api/networks/supplier').then(r => r.ok ? r.json() : null).catch(() => null),
    ]

    Promise.all(base).then(([dash, dealsRes, finRes, notifRes, passRes, networkRes]) => {
      if ((dash as any)?.portal === 'supplier') setDashData(dash as SupplierData)
      setDeals(((dealsRes as any)?.deals ?? []) as DealItem[])
      setFinancing((((finRes as any)?.requests ?? []) as OrgFinancingReq[]).slice(0, 3))
      setNotifications(((notifRes as any)?.notifications ?? []) as NotifItem[])
      if (passRes) setPassport(passRes as PassportData)
      const nets = (networkRes as any)?.networks ?? []
      setPendingNetworks(nets.filter((n: any) => n.membership?.status === 'invited'))
      setLoading(false)
    })
  }, [user?.org_id])

  const activeDeals = deals.filter(d => !['completed', 'cancelled'].includes(d.status))
  const completedDeals = deals.filter(d => d.status === 'completed').length
  const totalFinanced = financing.filter(f => ['accepted', 'funded'].includes(f.status)).reduce((s, f) => s + f.amount_requested, 0)

  const dealsNeedingAction = deals.filter(d =>
    (d.status === 'negotiating' && d.user_role === 'supplier') || d.status === 'agreed'
  ).length
  const financingWithOffers = financing.filter(f => f.status === 'offers_received').length

  const actionCards: ActionCard[] = [
    { color: 'var(--color-amber)', label: `${dealsNeedingAction} deal${dealsNeedingAction !== 1 ? 's' : ''} awaiting your action`, count: dealsNeedingAction, href: '/deals' },
    { color: 'var(--blue)', label: `${financingWithOffers} financing offer${financingWithOffers !== 1 ? 's' : ''} to review`, count: financingWithOffers, href: '/marketplace/financing' },
  ]

  const kpis: KpiItem[] = [
    { label: 'Active Deals',    value: activeDeals.length, icon: 'deals', tint: 'var(--blue)' },
    { label: 'Total Financed',  value: totalFinanced, format: fmtCurrency, valueColor: totalFinanced > 0 ? 'var(--color-green)' : undefined, icon: 'financing', tint: 'var(--color-green)' },
    { label: 'Completed Deals', value: completedDeals, sub: 'Track record', icon: 'volume', tint: 'var(--color-purple)' },
    { label: 'Bank Views',      value: passport?.bank_view_count_30d ?? 0, sub: 'Last 30 days', icon: 'org', tint: 'var(--color-amber)' },
  ]

  const passportExtras = passport ? (
    <div style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 'auto', textAlign: 'right', flexShrink: 0 }}>
      <div>Viewed by <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{passport.bank_view_count_30d}</strong> banks this month</div>
      {passport.organization.passport_narrative && (
        <div style={{
          marginTop: 4, maxWidth: 220, fontStyle: 'italic',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          "{passport.organization.passport_narrative.slice(0, 120)}{passport.organization.passport_narrative.length > 120 ? '…' : ''}"
        </div>
      )}
    </div>
  ) : undefined

  const supplierAiContext = JSON.stringify({
    page: 'supplier_dashboard',
    role: 'supplier',
    org: dashData?.org_name ?? null,
    passport_score: (passport as any)?.organization?.passport_score ?? null,
    bank_views_30d: passport?.bank_view_count_30d ?? 0,
    active_deals: activeDeals.length,
    completed_deals: completedDeals,
    deals_needing_action: dealsNeedingAction,
    financing_with_new_offers: financingWithOffers,
    total_financed: totalFinanced,
    pending_network_invitations: pendingNetworks.length,
    active_deal_list: activeDeals.slice(0, 5).map(d => ({
      status: d.status,
      value: (d as any).total_value ?? null,
      role: d.user_role,
    })),
  })

  return (
    <>
      <Topbar crumbs={[{ label: 'Dashboard' }]} />
      <div className="page"
        data-page-name="Dashboard"
        data-ai-context={supplierAiContext}
      >

        {/* 1. Header */}
        <DashboardHeader
          title={t(greetingKey(), { name: firstName })}
          subtitle={`${dashData?.org_name ?? ''}${dashData?.org_name ? ' · ' : ''}${todayFull()}`}
        />

        {/* AI Overview — only mount after data loads so context is populated */}
        {!loading && (
          <div style={{ marginBottom: 20 }}>
            <AIInsightCard
              variant="banner"
              portal="supplier"
              page="dashboard"
              context={{
                org_name: dashData?.org_name,
                active_deals: activeDeals.length,
                deals_needing_action: dealsNeedingAction,
                pending_financing: financing?.length ?? 0,
                total_financed: totalFinanced,
                completed_deals: completedDeals,
                passport_score: passport?.organization?.passport_score ?? null,
              }}
            />
          </div>
        )}

        {/* 2. PassportScore banner */}
        <PassportBanner passport={passport} loading={loading} size="lg" extras={passportExtras} />
        <AgentActivityTicker />

        {/* 2b. Network Invitations widget (hidden when no pending invites) */}
        {!loading && pendingNetworks.length > 0 && (
          <div className="card" style={{ marginBottom: 8, borderLeft: '3px solid var(--color-amber)', paddingLeft: 16 }}>
            <div className="card-head" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 700 }}>Network Invitations</span>
              <a href="/networks" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>
                View all ({pendingNetworks.length}) →
              </a>
            </div>
            <div className="reveal-stagger">
              {pendingNetworks.slice(0, 2).map((item: any) => (
                <div key={item.membership.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 12,
                }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{item.anchor?.legal_name ?? 'A buyer'}</strong> invited you to{' '}
                    <em>"{item.network?.name}"</em>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => router.push('/networks')}
                      style={{
                        padding: '6px 12px', fontSize: 12, borderRadius: 'var(--radius-button)',
                        background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Action queue */}
        <ActionQueueStrip cards={actionCards} loading={loading} />

        {/* 4. KPI strip */}
        <KpiStrip kpis={kpis} loading={loading} />

        {/* 5. Two-column */}
        <div className="split-65 reveal-stagger" style={{ marginBottom: 24 }}>

          {/* LEFT — My Deals */}
          <div className="card">
            <div className="card-head">
              <span>Active Deals</span>
              <a href="/deals" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>View all →</a>
            </div>
            <DealTable
              deals={deals}
              loading={loading}
              emptyTitle="No active deals yet."
              emptySub="List your products on Strike Place to start receiving offers."
              emptyCta={<a href="/marketplace/listings/new" className="btn btn-sm btn-blue">List on Strike Place</a>}
            />
          </div>

          {/* RIGHT — Financing + Passport Activity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-head"><span>Active Financing</span></div>
              {loading ? (
                <div style={{ padding: 16 }}><Skeleton height={14} /></div>
              ) : financing.length === 0 ? (
                <div className="float-slow" style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>No financing requests</div>
              ) : (
                <div className="reveal-stagger">
                  {financing.map(f => (
                    <div
                      key={f.id}
                      className="card-interactive"
                      onClick={() => router.push(`/marketplace/financing/${f.id}`)}
                      style={{
                        padding: '10px 16px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
                          <CountUp value={f.amount_requested} format={fmtCurrency} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{fmtStructureType(f.structure_type)}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span className={`badge ${financingStatusClass(f.status)}`}>{f.status.replace(/_/g, ' ')}</span>
                        {f.offer_count > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--blue)' }}>{f.offer_count} offer{f.offer_count !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><span>Passport Activity</span></div>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2, 3].map(i => <Skeleton key={i} height={12} />)}
                </div>
              ) : !passport ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
                  No passport data yet
                </div>
              ) : (
                <div className="kv-rows reveal-stagger">
                  <div className="kv-row">
                    <span className="k">Org views · 30d</span>
                    <span className="v"><CountUp value={passport.org_view_count_30d} /></span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Bank views · 30d</span>
                    <span className="v"><CountUp value={passport.bank_view_count_30d} /></span>
                  </div>
                  {passport.avg_rating != null && (
                    <div className="kv-row">
                      <span className="k">Avg review</span>
                      <span className="v">{passport.avg_rating.toFixed(1)}/5 · {passport.review_count} review{passport.review_count !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {notifications.length === 0 && (
                    <div className="kv-row">
                      <span className="k">Last activity</span>
                      <span className="v plain" style={{ color: 'var(--gray)' }}>No recent activity</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <a href="/settings/agent" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>Improve your score →</a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const portal = usePortal()
  if (portal === 'bank')   return <BankDashboard />
  if (portal === 'anchor') return <AnchorDashboard />
  return <SupplierDashboard />
}
