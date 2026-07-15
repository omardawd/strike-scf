import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Period = 'daily' | 'weekly' | 'monthly'
type Bucket = { label: string; start: Date; end: Date }

function buildBuckets(period: Period): Bucket[] {
  const now = new Date()
  if (period === 'daily') {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (29 - i))
      d.setHours(0, 0, 0, 0)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, start: d, end }
    })
  }
  if (period === 'weekly') {
    return Array.from({ length: 12 }, (_, i) => {
      const end = new Date(now)
      end.setDate(end.getDate() - (11 - i) * 7)
      end.setHours(23, 59, 59, 999)
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return { label: `Wk ${i + 1}`, start, end }
    })
  }
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1)
    return { label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), start: d, end }
  })
}

async function fetchOrgNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await adminClient
    .from('organizations')
    .select('id, legal_name')
    .in('id', ids)
  return new Map((data ?? []).map((o: { id: string; legal_name: string }) => [o.id, o.legal_name]))
}

export async function GET(request: Request) {
  const url    = new URL(request.url)
  const period = (url.searchParams.get('period') ?? 'monthly') as Period

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await adminClient
    .from('users')
    .select('role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // Normalize org_admin / org_member → anchor_admin / supplier_admin based on org type
  let effectiveRole = profile.role
  if (profile.role === 'org_admin' || profile.role === 'org_member') {
    if (profile.org_id) {
      const { data: orgData } = await adminClient
        .from('organizations')
        .select('type')
        .eq('id', profile.org_id)
        .single()
      effectiveRole = orgData?.type === 'anchor' ? 'anchor_admin' : 'supplier_admin'
    } else {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
    }
  }

  // ── BANK ──────────────────────────────────────────────────────────────────
  if (effectiveRole.startsWith('bank')) {
    const bankId = profile.bank_id

    const { data: bankPrograms } = await adminClient
      .from('programs')
      .select('id, name')
      .eq('bank_id', bankId)

    const programIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)

    if (programIds.length === 0) {
      const emptyMonths = buildBuckets(period).map(b => ({ label: b.label, count: 0, volume: 0 }))
      return NextResponse.json({
        role: 'bank',
        monthly_volume:   emptyMonths,
        status_breakdown: [],
        top_suppliers:    [],
        portfolio: { active_deals: 0, outstanding_balance: 0, total_repaid: 0, avg_rate: null, total_transactions: 0 },
      })
    }

    const [txnResult, supplierTxnResult] = await Promise.all([
      adminClient
        .from('transactions')
        .select('id, status, financing_amount_approved, financing_amount_requested, financing_rate_apr, created_at, repaid_at, supplier_id, program_id')
        .in('program_id', programIds),
      adminClient
        .from('transactions')
        .select('supplier_id, financing_amount_approved, status')
        .in('program_id', programIds)
        .not('financing_amount_approved', 'is', null),
    ])

    const txns         = txnResult.data         ?? []
    const supplierTxns = supplierTxnResult.data  ?? []

    // ── Volume by period ──
    const buckets = buildBuckets(period)
    const monthly_volume = buckets.map(b => {
      const slice = txns.filter(t => {
        const d = new Date(t.created_at)
        return d >= b.start && d < b.end
      })
      return {
        label:  b.label,
        count:  slice.length,
        volume: slice.reduce((s, t) => s + (t.financing_amount_approved ?? t.financing_amount_requested ?? 0), 0),
      }
    })

    // ── Status breakdown ──
    const statusMap = new Map<string, number>()
    for (const t of txns) statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1)
    const status_breakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // ── Top suppliers ──
    const supplierVolMap = new Map<string, { total: number; count: number }>()
    for (const t of supplierTxns) {
      if (!t.supplier_id) continue
      const existing = supplierVolMap.get(t.supplier_id)
      if (existing) {
        existing.total += t.financing_amount_approved ?? 0
        existing.count += 1
      } else {
        supplierVolMap.set(t.supplier_id, { total: t.financing_amount_approved ?? 0, count: 1 })
      }
    }
    const sortedSupplierIds = Array.from(supplierVolMap.keys())
      .sort((a, b) => supplierVolMap.get(b)!.total - supplierVolMap.get(a)!.total)
      .slice(0, 5)
    const orgNames = await fetchOrgNames(sortedSupplierIds)
    const top_suppliers = sortedSupplierIds.map(id => ({
      id,
      name:           orgNames.get(id) ?? id,
      total_financed: parseFloat((supplierVolMap.get(id)!.total).toFixed(2)),
      deal_count:     supplierVolMap.get(id)!.count,
    }))

    // ── Portfolio summary ──
    const activeDealStatuses = new Set([
      'pending_anchor_approval', 'pending_bank_review', 'more_info_requested',
      'financing_approved', 'funded', 'pending_supplier_counter_review',
    ])
    let active_deals = 0, outstanding_balance = 0, total_repaid = 0, rateSum = 0, rateCount = 0
    for (const t of txns) {
      if (activeDealStatuses.has(t.status)) {
        active_deals        += 1
        outstanding_balance += t.financing_amount_approved ?? 0
      }
      if (t.status === 'completed') total_repaid += t.financing_amount_approved ?? 0
      if (t.financing_rate_apr != null) { rateSum += t.financing_rate_apr; rateCount += 1 }
    }
    const avg_rate = rateCount > 0 ? parseFloat((rateSum / rateCount).toFixed(2)) : null

    const programNameMap = new Map((bankPrograms ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
    const programVolMap = new Map<string, { name: string; volume: number }>()
    for (const t of txns) {
      if (!t.program_id) continue
      const name = programNameMap.get(t.program_id) ?? t.program_id
      const cur = programVolMap.get(t.program_id) ?? { name, volume: 0 }
      cur.volume += t.financing_amount_approved ?? 0
      programVolMap.set(t.program_id, cur)
    }
    const program_breakdown = Array.from(programVolMap.values())
      .sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      role: 'bank',
      monthly_volume,
      status_breakdown,
      top_suppliers,
      program_breakdown,
      portfolio: {
        active_deals,
        outstanding_balance: parseFloat(outstanding_balance.toFixed(2)),
        total_repaid:        parseFloat(total_repaid.toFixed(2)),
        avg_rate,
        total_transactions:  txns.length,
      },
    })
  }

  // ── ANCHOR / SUPPLIER ────────────────────────────────────────────────────
  // Strike Place v2: the real activity for these roles lives in `deals` +
  // `financing_requests`, not the legacy `transactions`/`programs` tables
  // (those are the old direct-SCF-program flow and are near-empty for orgs
  // that transact through the marketplace). Source from deals so every KPI
  // here matches what the org actually sees on their Dashboard/My Deals.
  if (effectiveRole.startsWith('anchor') || effectiveRole.startsWith('supplier')) {
    const orgId = profile.org_id
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
    const isAnchor = effectiveRole.startsWith('anchor')

    // Deal role is per-deal (buyer_org_id/supplier_org_id), never derived from
    // organizations.type — an anchor org can still be the supplier on a given
    // deal. Match every deal where this org is on either side, same as
    // /api/deals, so counts here agree with My Deals / Dashboard.
    const [dealsResult, listingsResult, finReqResult] = await Promise.all([
      adminClient
        .from('deals')
        .select('id, status, agreed_price, total_value, agreed_currency, buyer_org_id, supplier_org_id, created_at, completed_at, cancelled_at, disputed_at, contract_document_id, external_counterparty_name')
        .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`)
        .order('created_at', { ascending: false }),
      adminClient
        .from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
      adminClient
        .from('financing_requests')
        .select('id, deal_id, status, amount_requested, structure_type, accepted_offer_id, created_at')
        .eq('requesting_org_id', orgId),
    ])

    const deals = dealsResult.data ?? []
    const active_listings = listingsResult.count ?? 0
    const finReqs = finReqResult.data ?? []

    const counterpartyOf = (d: { buyer_org_id: string; supplier_org_id: string }) =>
      d.buyer_org_id === orgId ? d.supplier_org_id : d.buyer_org_id

    const CANCELLED = new Set(['cancelled'])
    const COMPLETED = new Set(['completed'])
    const completedDeals = deals.filter(d => COMPLETED.has(d.status))
    const activeDeals = deals.filter(d => !COMPLETED.has(d.status) && !CANCELLED.has(d.status))
    const tradingDeals = deals.filter(d => !CANCELLED.has(d.status))
    const dealValue = (d: { total_value: number | null; agreed_price: number }) => Number(d.total_value ?? d.agreed_price ?? 0)

    // Headline "trade volume" = value of every deal in flight or done (not just
    // completed), valued at total_value with an agreed_price fallback — matching
    // what the org sees on My Deals. Completed/active are also broken out.
    const total_trade_volume = tradingDeals.reduce((s, d) => s + dealValue(d), 0)
    const completed_volume = completedDeals.reduce((s, d) => s + dealValue(d), 0)
    const active_volume = activeDeals.reduce((s, d) => s + dealValue(d), 0)

    const cycleDurations = completedDeals
      .filter(d => d.completed_at)
      .map(d => (new Date(d.completed_at as string).getTime() - new Date(d.created_at).getTime()) / (24 * 60 * 60 * 1000))
    const avg_deal_cycle_days = cycleDurations.length > 0
      ? Math.round(cycleDurations.reduce((s, n) => s + n, 0) / cycleDurations.length)
      : null

    // Fallback KPI so the "cycle time" card isn't empty until deals actually
    // complete — average age (in days) of deals still active right now.
    const now = Date.now()
    const pipelineAges = activeDeals.map(d => (now - new Date(d.created_at).getTime()) / (24 * 60 * 60 * 1000))
    const avg_pipeline_age_days = pipelineAges.length > 0
      ? Math.round(pipelineAges.reduce((s, n) => s + n, 0) / pipelineAges.length)
      : null

    // Volume by period — every deal counts toward activity, valued at agreed_price/total_value
    const buckets = buildBuckets(period)
    const monthly_volume = buckets.map(b => {
      const slice = deals.filter(d => {
        const created = new Date(d.created_at)
        return created >= b.start && created < b.end
      })
      return {
        label:  b.label,
        count:  slice.length,
        volume: slice.reduce((s, d) => s + dealValue(d), 0),
      }
    })

    // Status breakdown
    const statusMap = new Map<string, number>()
    for (const d of deals) statusMap.set(d.status, (statusMap.get(d.status) ?? 0) + 1)
    const status_breakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // Top counterparties (suppliers for an anchor, buyers for a supplier)
    const cpMap = new Map<string, { count: number; volume: number }>()
    for (const d of deals) {
      const cpId = counterpartyOf(d)
      const existing = cpMap.get(cpId)
      const val = dealValue(d)
      if (existing) { existing.count += 1; existing.volume += val }
      else cpMap.set(cpId, { count: 1, volume: val })
    }
    const sortedCpIds = Array.from(cpMap.keys()).sort((a, b) => cpMap.get(b)!.volume - cpMap.get(a)!.volume).slice(0, 5)
    const cpNames = await fetchOrgNames(sortedCpIds.filter(id => id))
    const top_counterparties = sortedCpIds.map(id => ({
      id,
      name:         cpNames.get(id) ?? 'Counterparty',
      deal_count:   cpMap.get(id)!.count,
      total_volume: parseFloat(cpMap.get(id)!.volume.toFixed(2)),
    }))

    // ── Audit / treasury metrics ──
    const disputedDeals = deals.filter(d => d.disputed_at != null)
    const cancelledDeals = deals.filter(d => CANCELLED.has(d.status))
    const dispute_rate = deals.length > 0 ? parseFloat(((disputedDeals.length / deals.length) * 100).toFixed(1)) : null
    const cancellation_rate = deals.length > 0 ? parseFloat(((cancelledDeals.length / deals.length) * 100).toFixed(1)) : null

    const concentration_risk = total_trade_volume > 0 && top_counterparties.length > 0
      ? parseFloat(((top_counterparties[0]!.total_volume / total_trade_volume) * 100).toFixed(1))
      : null

    const dealsWithContract = deals.filter(d => d.contract_document_id != null)
    const contract_completion_rate = deals.length > 0
      ? parseFloat(((dealsWithContract.length / deals.length) * 100).toFixed(1))
      : null

    const STALE_THRESHOLD_DAYS = 14
    const STALE_STATUSES = new Set(['negotiating', 'agreed'])
    const stale_deals = activeDeals
      .filter(d => STALE_STATUSES.has(d.status))
      .map(d => ({
        id: d.id,
        counterparty_name: cpNames.get(counterpartyOf(d)) ?? d.external_counterparty_name ?? 'Counterparty',
        status: d.status,
        days_stale: Math.floor((now - new Date(d.created_at).getTime()) / (24 * 60 * 60 * 1000)),
      }))
      .filter(d => d.days_stale >= STALE_THRESHOLD_DAYS)
      .sort((a, b) => b.days_stale - a.days_stale)
      .slice(0, 5)

    // Financing summary — requests this org has made against its own deals
    const openFinReqs = finReqs.filter(f => f.status === 'open' || f.status === 'offers_received')
    const acceptedFinReqs = finReqs.filter(f => f.status === 'accepted' || f.status === 'funded')
    const acceptedOfferIds = acceptedFinReqs.map(f => f.accepted_offer_id).filter((id): id is string => !!id)
    let acceptedOffers: Array<{ id: string; offered_rate_apr: number; offered_amount: number }> = []
    if (acceptedOfferIds.length > 0) {
      const { data } = await adminClient
        .from('financing_request_offers')
        .select('id, offered_rate_apr, offered_amount')
        .in('id', acceptedOfferIds)
      acceptedOffers = data ?? []
    }
    const total_financed = acceptedOffers.reduce((s, o) => s + (o.offered_amount ?? 0), 0)
    const rates = acceptedOffers.map(o => o.offered_rate_apr).filter((r): r is number => r != null)
    const avg_financing_rate = rates.length > 0 ? parseFloat((rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(2)) : null
    const min_financing_rate = rates.length > 0 ? Math.min(...rates) : null
    const max_financing_rate = rates.length > 0 ? Math.max(...rates) : null

    const recent_deals = deals.slice(0, 8).map(d => ({
      id:               d.id,
      counterparty_name: cpNames.get(counterpartyOf(d)) ?? d.external_counterparty_name ?? 'Counterparty',
      status:           d.status,
      value:            dealValue(d),
      currency:         d.agreed_currency ?? 'USD',
      created_at:       d.created_at,
    }))

    return NextResponse.json({
      role: isAnchor ? 'anchor' : 'supplier',
      kpis: {
        total_deals:                deals.length,
        active_deals:               activeDeals.length,
        completed_deals:            completedDeals.length,
        total_trade_volume:         parseFloat(total_trade_volume.toFixed(2)),
        completed_volume:           parseFloat(completed_volume.toFixed(2)),
        active_volume:              parseFloat(active_volume.toFixed(2)),
        avg_deal_cycle_days,
        avg_pipeline_age_days,
        active_listings,
        pending_financing_requests: openFinReqs.length,
        total_financing_requested:  parseFloat(openFinReqs.reduce((s, f) => s + (f.amount_requested ?? 0), 0).toFixed(2)),
        total_financed:             parseFloat(total_financed.toFixed(2)),
        avg_financing_rate,
        min_financing_rate,
        max_financing_rate,
        dispute_rate,
        cancellation_rate,
        concentration_risk,
        contract_completion_rate,
      },
      monthly_volume,
      status_breakdown,
      top_counterparties,
      stale_deals,
      recent_deals,
    })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
