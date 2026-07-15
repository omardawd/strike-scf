// organizations.trade_count_total / trade_volume_total / avg_payment_days /
// dispute_rate_network are never written by any deal lifecycle path (confirmed:
// no `.update()` on `organizations` sets them anywhere in the app). Reading them
// directly returns stale/always-null data. Compute live from `deals` instead —
// this was already done ad hoc inside the passport route; centralized here so
// every surface that shows an org's trade stats (Passport, Strike Place listing/
// financing detail pages, list-page mini cards) agrees.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export interface OrgTradeStats {
  trade_count_total: number
  trade_volume_total: number
  avg_payment_days: number | null
  on_time_payment_rate: number | null   // 0-100, of completed deals with payment data
  dispute_rate_network: number | null   // 0-1 fraction
}

interface DealRow {
  buyer_org_id?: string | null
  supplier_org_id?: string | null
  status: string
  total_value: number | null
  agreed_price: number | null
  payment_days_actual: number | null
  disputed_at: string | null
}

function dealValue(d: { total_value: number | null; agreed_price: number | null }): number {
  return Number(d.total_value ?? d.agreed_price ?? 0)
}

function computeStats(deals: DealRow[]): OrgTradeStats {
  const completedDeals = deals.filter(d => d.status === 'completed')
  const tradingDeals = deals.filter(d => d.status !== 'cancelled')
  const withPayData = completedDeals.filter(d => d.payment_days_actual != null)
  const disputedCount = deals.filter(d => d.disputed_at != null).length

  return {
    trade_count_total: tradingDeals.length,
    trade_volume_total: tradingDeals.reduce((sum, d) => sum + dealValue(d), 0),
    avg_payment_days: withPayData.length > 0
      ? Math.round(withPayData.reduce((s, d) => s + Number(d.payment_days_actual), 0) / withPayData.length)
      : null,
    on_time_payment_rate: withPayData.length > 0
      ? Math.round((withPayData.filter(d => Number(d.payment_days_actual) <= 30).length / withPayData.length) * 100)
      : null,
    dispute_rate_network: deals.length > 0 ? disputedCount / deals.length : null,
  }
}

const DEAL_COLUMNS = 'buyer_org_id, supplier_org_id, status, total_value, agreed_price, payment_days_actual, disputed_at'

export async function getOrgTradeStats(admin: AdminClient, orgId: string): Promise<OrgTradeStats> {
  const { data: deals } = await admin
    .from('deals')
    .select(DEAL_COLUMNS)
    .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`)
  return computeStats((deals ?? []) as DealRow[])
}

// Batch version for list pages showing many orgs' mini cards at once — one
// query instead of N, grouped client-side by org membership on each deal.
export async function getOrgsTradeStatsBatch(admin: AdminClient, orgIds: string[]): Promise<Record<string, OrgTradeStats>> {
  const uniqueIds = [...new Set(orgIds)]
  if (uniqueIds.length === 0) return {}

  const orFilter = uniqueIds.map(id => `buyer_org_id.eq.${id}`).concat(uniqueIds.map(id => `supplier_org_id.eq.${id}`)).join(',')
  const { data: deals } = await admin
    .from('deals')
    .select(DEAL_COLUMNS)
    .or(orFilter)

  const byOrg: Record<string, DealRow[]> = {}
  for (const id of uniqueIds) byOrg[id] = []
  for (const d of (deals ?? []) as DealRow[]) {
    if (d.buyer_org_id && byOrg[d.buyer_org_id]) byOrg[d.buyer_org_id]!.push(d)
    if (d.supplier_org_id && d.supplier_org_id !== d.buyer_org_id && byOrg[d.supplier_org_id]) byOrg[d.supplier_org_id]!.push(d)
  }

  const result: Record<string, OrgTradeStats> = {}
  for (const id of uniqueIds) result[id] = computeStats(byOrg[id] ?? [])
  return result
}
