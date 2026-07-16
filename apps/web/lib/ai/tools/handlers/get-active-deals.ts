import { adminClient } from '../admin'

export interface GetActiveDealsInput {
  org_id: string
  status_filter?: 'all' | 'active_only' | 'payment_due' | 'needs_action'
}

export async function getActiveDeals(input: GetActiveDealsInput) {
  const { data: deals, error } = await adminClient
    .from('deals')
    .select(
      'id, deal_source, status, created_at, updated_at, ' +
      'buyer_org_id, supplier_org_id, ' +
      'payment_due_date, payment_currency, payment_amount, ' +
      'financing_payment_active, ' +
      // marketplace_listings has two FK paths to/from deals (deals.listing_id
      // and marketplace_listings.matched_deal_id) — PostgREST can't pick one
      // without an explicit hint, or it throws "more than one relationship
      // was found" and this entire query returns nothing.
      'marketplace_listings!deals_listing_id_fkey(title, listing_type, category), ' +
      'buyer:organizations!deals_buyer_org_id_fkey(id, legal_name, doing_business_as, passport_score, risk_tier), ' +
      'supplier:organizations!deals_supplier_org_id_fkey(id, legal_name, doing_business_as, passport_score, risk_tier)'
    )
    .or(`buyer_org_id.eq.${input.org_id},supplier_org_id.eq.${input.org_id}`)
    .not('status', 'in', '("completed","cancelled")')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return { error: `Failed to fetch deals: ${error.message}` }

  const allDeals = deals ?? []

  const statusFilter = input.status_filter ?? 'all'
  const filtered = statusFilter === 'all' ? allDeals : allDeals.filter((d: { status: string; payment_due_date: string | null }) => {
    if (statusFilter === 'active_only') return !['completed', 'cancelled', 'payment_due', 'payment_overdue'].includes(d.status)
    if (statusFilter === 'payment_due') return d.status === 'payment_due' || d.status === 'payment_overdue'
    if (statusFilter === 'needs_action') return ['agreed', 'contract_pending', 'documents_pending', 'delivery_confirmed', 'payment_due', 'payment_overdue'].includes(d.status)
    return true
  })

  const summary = {
    total_active: allDeals.length,
    by_status: allDeals.reduce((acc: Record<string, number>, d: { status: string }) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1
      return acc
    }, {}),
  }

  return {
    org_id: input.org_id,
    deals: filtered.map((d: {
      id: string; deal_source: string; status: string; created_at: string; updated_at: string;
      buyer_org_id: string; supplier_org_id: string;
      payment_due_date: string | null; financing_payment_active: boolean | null;
      marketplace_listings: { title: string; listing_type: string; category: string | null } | null;
      buyer: { id: string; legal_name: string | null; doing_business_as: string | null; passport_score: number | null; risk_tier: string | null } | null;
      supplier: { id: string; legal_name: string | null; doing_business_as: string | null; passport_score: number | null; risk_tier: string | null } | null;
    }) => ({
      id: d.id,
      deal_source: d.deal_source,
      status: d.status,
      role: d.buyer_org_id === input.org_id ? 'buyer' : 'seller',
      listing_title: d.marketplace_listings?.title ?? null,
      listing_type: d.marketplace_listings?.listing_type ?? null,
      category: d.marketplace_listings?.category ?? null,
      counterparty: d.buyer_org_id === input.org_id
        ? (d.supplier?.doing_business_as ?? d.supplier?.legal_name ?? 'Unknown')
        : (d.buyer?.doing_business_as ?? d.buyer?.legal_name ?? 'Unknown'),
      counterparty_passport_score: d.buyer_org_id === input.org_id ? d.supplier?.passport_score : d.buyer?.passport_score,
      counterparty_risk_tier: d.buyer_org_id === input.org_id ? d.supplier?.risk_tier : d.buyer?.risk_tier,
      payment_due_date: d.payment_due_date,
      financing_active: d.financing_payment_active ?? false,
      updated_at: d.updated_at,
    })),
    summary,
  }
}
