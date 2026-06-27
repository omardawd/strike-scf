import { adminClient } from '../admin'

export interface GetErpDataInput {
  org_id: string
  data_type: 'ar_aging' | 'ap_aging' | 'cash_position' | 'inventory_levels' | 'open_orders' | 'all'
}

export async function getErpData(input: GetErpDataInput) {
  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, erp_type, base_url, status, last_synced_at')
    .eq('org_id', input.org_id)
    .eq('status', 'active')
    .single()

  if (!conn) {
    return {
      connected: false,
      message: 'No active ERP connection found for this organization. Connect an ERP system at Settings → ERP Integration.',
    }
  }

  const typesToFetch = input.data_type === 'all'
    ? ['ar_aging', 'ap_aging', 'cash_position', 'inventory_levels', 'open_orders']
    : [input.data_type]

  const { data: rows, error } = await adminClient
    .from('erp_sync_data')
    .select('data_type, data, fetched_at')
    .eq('org_id', input.org_id)
    .in('data_type', typesToFetch)

  if (error) return { connected: true, error: 'Failed to read ERP data' }

  if (!rows?.length) {
    return {
      connected: true,
      erp_type: conn.erp_type,
      last_synced_at: conn.last_synced_at,
      message: 'ERP is connected but no data has been synced yet. Trigger a sync from Settings → ERP Integration.',
    }
  }

  // Build summary per data type
  const summary: Record<string, unknown> = {
    connected: true,
    erp_type: conn.erp_type,
    last_synced_at: conn.last_synced_at,
  }

  for (const row of rows) {
    summary[row.data_type] = {
      ...row.data,
      as_of: row.fetched_at,
    }
  }

  // Derive advisory signals
  const advisories: string[] = []

  if (summary.ar_aging) {
    const ar = summary.ar_aging as Record<string, unknown>
    const buckets = ar.buckets as Record<string, number> | undefined
    if (buckets && buckets.over_90 && Number(buckets.over_90) > 0) {
      advisories.push(`AR aging: $${Number(buckets.over_90).toLocaleString()} is >90 days overdue — consider submitting invoices for early payment financing.`)
    }
  }

  if (summary.inventory_levels) {
    const inv = summary.inventory_levels as Record<string, unknown>
    const lowCount = Number(inv.low_stock_count) || 0
    if (lowCount > 0) {
      advisories.push(`${lowCount} SKU(s) are at or below reorder level — consider posting a PO request on Strike Marketplace.`)
    }
  }

  if (summary.cash_position) {
    const cash = summary.cash_position as Record<string, unknown>
    if (Number(cash.net_cash) < 0) {
      advisories.push(`Net cash position is negative ($${Math.abs(Number(cash.net_cash)).toLocaleString()}) — explore reverse factoring or dynamic discounting programs.`)
    }
  }

  if (advisories.length) summary.advisories = advisories

  return summary
}
