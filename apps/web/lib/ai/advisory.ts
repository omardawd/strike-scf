// ERP-driven proactive advisory engine.
// Reads erp_sync_data and writes actionable recommendations to the `recommendations` table.
// Called by /api/erp/sync after each successful sync.

import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminClient: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Advisory {
  priority: 'high' | 'medium' | 'low'
  category: string
  title: string
  body: string
  action_label: string
  action_url: string
  estimated_impact: string
}

function arAgingAdvisories(ar: Record<string, unknown>): Advisory[] {
  const advisories: Advisory[] = []
  const buckets = ar.buckets as Record<string, number> | undefined
  const currency = (ar.currency as string) ?? 'USD'

  if (!buckets) return advisories

  const overdue90 = Number(buckets.over_90) || 0
  const overdue60 = Number(buckets.days_61_90) || 0

  if (overdue90 > 0) {
    advisories.push({
      priority: 'high',
      category: 'cash_flow',
      title: `${currency} ${overdue90.toLocaleString()} in AR is >90 days overdue`,
      body: 'You have significantly aged receivables. Submit these invoices on Strike for invoice factoring to recover cash immediately instead of waiting for customer payment.',
      action_label: 'Request Invoice Financing',
      action_url: '/marketplace/financing',
      estimated_impact: `Up to ${currency} ${Math.round(overdue90 * 0.9).toLocaleString()} in advance funding`,
    })
  }

  if (overdue60 > 0) {
    advisories.push({
      priority: 'medium',
      category: 'cash_flow',
      title: `${currency} ${overdue60.toLocaleString()} in AR is 61–90 days overdue`,
      body: 'Receivables approaching the 90-day mark. Proactively financing these now locks in better rates before they become high-risk.',
      action_label: 'View Financing Options',
      action_url: '/marketplace/financing',
      estimated_impact: `Accelerate ${currency} ${overdue60.toLocaleString()} in cash flow`,
    })
  }

  return advisories
}

function inventoryAdvisories(inv: Record<string, unknown>): Advisory[] {
  const advisories: Advisory[] = []
  const lowCount = Number(inv.low_stock_count) || 0
  const lowItems = (inv.low_stock_items as Array<Record<string, unknown>>) ?? []

  if (lowCount > 0) {
    const topItems = lowItems
      .slice(0, 3)
      .map(i => i.item_code as string)
      .join(', ')

    advisories.push({
      priority: lowCount > 5 ? 'high' : 'medium',
      category: 'inventory',
      title: `${lowCount} SKU${lowCount > 1 ? 's' : ''} at or below reorder level`,
      body: `Items at low stock: ${topItems}${lowCount > 3 ? ` and ${lowCount - 3} more` : ''}. Post a PO request on Strike Marketplace to source these from trusted suppliers quickly.`,
      action_label: 'Post PO Request',
      action_url: '/marketplace/listings/new',
      estimated_impact: 'Prevent stockouts and production delays',
    })
  }

  return advisories
}

function cashAdvisories(cash: Record<string, unknown>): Advisory[] {
  const advisories: Advisory[] = []
  const netCash = Number(cash.net_cash) || 0

  if (netCash < 0) {
    advisories.push({
      priority: 'high',
      category: 'liquidity',
      title: `Net cash position is negative ($${Math.abs(netCash).toLocaleString()})`,
      body: 'Your ERP shows negative net cash. Explore reverse factoring programs on Strike — your bank anchor can approve early payment on outstanding invoices.',
      action_label: 'Explore Financing Programs',
      action_url: '/marketplace/financing',
      estimated_impact: 'Restore positive cash position',
    })
  }

  return advisories
}

function openOrdersAdvisories(orders: Record<string, unknown>): Advisory[] {
  const advisories: Advisory[] = []
  const openPOs = Number(orders.open_purchase_orders) || 0
  const poTotal = Number(orders.purchase_order_total) || 0

  if (openPOs > 0 && poTotal > 10000) {
    advisories.push({
      priority: 'low',
      category: 'procurement',
      title: `${openPOs} open purchase orders worth $${poTotal.toLocaleString()}`,
      body: 'You have open POs in your ERP. If any supplier is not yet on Strike, invite them to fulfill these orders through the platform with financing support.',
      action_label: 'View Marketplace',
      action_url: '/marketplace',
      estimated_impact: 'Streamline fulfillment and unlock financing options',
    })
  }

  return advisories
}

export async function generateErpAdvisories(orgId: string): Promise<void> {
  const { data: rows } = await adminClient
    .from('erp_sync_data')
    .select('data_type, data')
    .eq('org_id', orgId)

  if (!rows?.length) return

  const dataMap: Record<string, Record<string, unknown>> = {}
  for (const row of rows) dataMap[row.data_type] = row.data

  const allAdvisories: Advisory[] = [
    ...(dataMap.ar_aging        ? arAgingAdvisories(dataMap.ar_aging)         : []),
    ...(dataMap.inventory_levels ? inventoryAdvisories(dataMap.inventory_levels) : []),
    ...(dataMap.cash_position   ? cashAdvisories(dataMap.cash_position)        : []),
    ...(dataMap.open_orders     ? openOrdersAdvisories(dataMap.open_orders)    : []),
  ]

  if (!allAdvisories.length) return

  // Deduplicate: remove existing ERP advisories that have NOT been actioned or dismissed
  await adminClient
    .from('recommendations')
    .delete()
    .eq('org_id', orgId)
    .in('category', ['cash_flow', 'inventory', 'liquidity', 'procurement'])
    .eq('dismissed', false)
    .eq('actioned', false)

  // Insert fresh advisories
  await adminClient
    .from('recommendations')
    .insert(
      allAdvisories.map(a => ({
        org_id: orgId,
        priority: a.priority,
        category: a.category,
        title: a.title,
        body: a.body,
        action_label: a.action_label,
        action_url: a.action_url,
        estimated_impact: a.estimated_impact,
        dismissed: false,
        actioned: false,
      }))
    )
}
