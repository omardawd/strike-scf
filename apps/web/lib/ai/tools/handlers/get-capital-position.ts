import { adminClient } from '../admin'

export interface GetCapitalPositionInput {
  org_id: string
  // Optional: model taking on one more deal against the current position, so a
  // single call can answer "should we take this deal" rather than needing a
  // separate tool call plus manual arithmetic in the response.
  hypothetical_deal_value?: number
  hypothetical_counterparty_org_id?: string
}

export async function getCapitalPosition(input: GetCapitalPositionInput) {
  const [
    { data: erpConn },
    { data: deals },
    { data: finReqs },
  ] = await Promise.all([
    adminClient
      .from('erp_connections')
      .select('id, status')
      .eq('org_id', input.org_id)
      .eq('status', 'active')
      .maybeSingle(),
    adminClient
      .from('deals')
      .select('id, status, agreed_price, total_value, agreed_currency, buyer_org_id, supplier_org_id, created_at')
      .or(`buyer_org_id.eq.${input.org_id},supplier_org_id.eq.${input.org_id}`)
      .neq('status', 'cancelled'),
    adminClient
      .from('financing_requests')
      .select('id, status, amount_requested')
      .eq('requesting_org_id', input.org_id)
      .in('status', ['open', 'offers_received', 'accepted', 'funded']),
  ])

  // ── ERP-sourced cash + receivables/payables (only if connected & synced) ──
  let cash: { net_cash: number; as_of: string } | null = null
  let receivables: { total_outstanding: number; overdue_61_90: number; overdue_over_90: number } | null = null
  let payables: { total_outstanding: number; overdue_over_90: number } | null = null

  if (erpConn) {
    const { data: erpRows } = await adminClient
      .from('erp_sync_data')
      .select('data_type, data, fetched_at')
      .eq('org_id', input.org_id)
      .in('data_type', ['cash_position', 'ar_aging', 'ap_aging'])

    for (const row of erpRows ?? []) {
      if (row.data_type === 'cash_position') {
        cash = { net_cash: Number(row.data?.net_cash ?? 0), as_of: row.fetched_at }
      }
      if (row.data_type === 'ar_aging') {
        const b = row.data?.buckets ?? {}
        receivables = {
          total_outstanding: Number(row.data?.total_outstanding ?? 0),
          overdue_61_90: Number(b.days_61_90 ?? 0),
          overdue_over_90: Number(b.over_90 ?? 0),
        }
      }
      if (row.data_type === 'ap_aging') {
        const b = row.data?.buckets ?? {}
        payables = {
          total_outstanding: Number(row.data?.total_outstanding ?? 0),
          overdue_over_90: Number(b.over_90 ?? 0),
        }
      }
    }
  }

  // ── Deal-book concentration (mirrors /api/reporting's logic, org-scoped) ──
  const dealValue = (d: { total_value: number | null; agreed_price: number | null }) =>
    Number(d.total_value ?? d.agreed_price ?? 0)
  const counterpartyOf = (d: { buyer_org_id: string; supplier_org_id: string }) =>
    d.buyer_org_id === input.org_id ? d.supplier_org_id : d.buyer_org_id

  const allDeals: { total_value: number | null; agreed_price: number | null; buyer_org_id: string; supplier_org_id: string }[] = deals ?? []
  const totalTradeVolume = allDeals.reduce((s: number, d) => s + dealValue(d), 0)

  const cpVolume = new Map<string, number>()
  for (const d of allDeals) {
    const cpId = counterpartyOf(d)
    if (!cpId) continue
    cpVolume.set(cpId, (cpVolume.get(cpId) ?? 0) + dealValue(d))
  }
  const sortedCpIds = [...cpVolume.keys()].sort((a, b) => (cpVolume.get(b) ?? 0) - (cpVolume.get(a) ?? 0))
  const topCpId = sortedCpIds[0]

  let topCounterpartyName: string | null = null
  if (topCpId) {
    const { data: org } = await adminClient.from('organizations').select('legal_name, doing_business_as').eq('id', topCpId).single()
    topCounterpartyName = org?.doing_business_as ?? org?.legal_name ?? null
  }

  const concentrationRiskPct = totalTradeVolume > 0 && topCpId
    ? Number(((cpVolume.get(topCpId)! / totalTradeVolume) * 100).toFixed(1))
    : null

  const outstandingFinancingExposure = (finReqs ?? []).reduce((s: number, f: { amount_requested: number | null }) => s + Number(f.amount_requested ?? 0), 0)

  const result: Record<string, unknown> = {
    org_id: input.org_id,
    erp_connected: !!erpConn,
    cash,
    receivables,
    payables,
    portfolio: {
      total_trade_volume: Number(totalTradeVolume.toFixed(2)),
      deal_count: allDeals.length,
      top_counterparty: topCpId ? { org_id: topCpId, name: topCounterpartyName, volume: Number((cpVolume.get(topCpId) ?? 0).toFixed(2)) } : null,
      concentration_risk_pct: concentrationRiskPct,
      outstanding_financing_exposure: Number(outstandingFinancingExposure.toFixed(2)),
    },
  }

  // ── Hypothetical: model adding one more deal on top of the current book ──
  if (input.hypothetical_deal_value != null && input.hypothetical_deal_value > 0) {
    const addedValue = input.hypothetical_deal_value
    const newTotal = totalTradeVolume + addedValue
    const withCounterpartyId = input.hypothetical_counterparty_org_id
    const existingWithThatCp = withCounterpartyId ? (cpVolume.get(withCounterpartyId) ?? 0) : 0
    const newCpVolume = existingWithThatCp + addedValue
    const newConcentrationWithThisCp = newTotal > 0 ? Number(((newCpVolume / newTotal) * 100).toFixed(1)) : null

    let hypotheticalCpName: string | null = null
    if (withCounterpartyId) {
      const { data: org } = await adminClient.from('organizations').select('legal_name, doing_business_as').eq('id', withCounterpartyId).single()
      hypotheticalCpName = org?.doing_business_as ?? org?.legal_name ?? null
    }

    result.hypothetical = {
      added_deal_value: addedValue,
      counterparty_name: hypotheticalCpName,
      new_total_trade_volume: Number(newTotal.toFixed(2)),
      new_concentration_with_this_counterparty_pct: newConcentrationWithThisCp,
      concentration_delta_pct: newConcentrationWithThisCp != null && concentrationRiskPct != null
        ? Number((newConcentrationWithThisCp - (withCounterpartyId === topCpId ? concentrationRiskPct : 0)).toFixed(1))
        : null,
      deal_value_as_pct_of_cash: cash && cash.net_cash > 0 ? Number(((addedValue / cash.net_cash) * 100).toFixed(1)) : null,
    }
  }

  return result
}
