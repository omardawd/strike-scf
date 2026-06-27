import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateErpAdvisories } from '@/lib/ai/advisory'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── ERPNext API helpers ───────────────────────────────────────────────────────

function erpHeaders(apiKey: string, apiSecret: string) {
  return {
    Authorization: `token ${apiKey}:${apiSecret}`,
    'Content-Type': 'application/json',
  }
}

async function fetchErpList(
  baseUrl: string, apiKey: string, apiSecret: string,
  doctype: string, fields: string[], filters: unknown[][] = [], limit = 500
) {
  const params = new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
  })
  const res = await fetch(`${baseUrl}/api/resource/${encodeURIComponent(doctype)}?${params}`, {
    headers: erpHeaders(apiKey, apiSecret),
  })
  if (!res.ok) throw new Error(`ERPNext ${doctype} fetch failed: ${res.status}`)
  const json = await res.json()
  return (json.data ?? []) as Record<string, unknown>[]
}

// ── Data normalizers ──────────────────────────────────────────────────────────

async function syncArAging(baseUrl: string, ak: string, as_: string) {
  const invoices = await fetchErpList(baseUrl, ak, as_, 'Sales Invoice', [
    'name', 'customer', 'outstanding_amount', 'posting_date', 'due_date', 'currency',
  ], [['outstanding_amount', '>', '0'], ['docstatus', '=', '1']])

  const now = Date.now()
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 }
  let total = 0

  for (const inv of invoices) {
    const amount = Number(inv.outstanding_amount) || 0
    const due = inv.due_date ? new Date(inv.due_date as string).getTime() : now
    const ageDays = Math.floor((now - due) / 86400000)
    total += amount
    if (ageDays <= 0) buckets.current += amount
    else if (ageDays <= 30) buckets.days_1_30 += amount
    else if (ageDays <= 60) buckets.days_31_60 += amount
    else if (ageDays <= 90) buckets.days_61_90 += amount
    else buckets.over_90 += amount
  }

  return {
    total_outstanding: total,
    invoice_count: invoices.length,
    buckets,
    currency: invoices[0]?.currency ?? 'USD',
    invoices: invoices.slice(0, 50),
  }
}

async function syncApAging(baseUrl: string, ak: string, as_: string) {
  const invoices = await fetchErpList(baseUrl, ak, as_, 'Purchase Invoice', [
    'name', 'supplier', 'outstanding_amount', 'posting_date', 'due_date', 'currency',
  ], [['outstanding_amount', '>', '0'], ['docstatus', '=', '1']])

  const now = Date.now()
  let total = 0
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 }

  for (const inv of invoices) {
    const amount = Number(inv.outstanding_amount) || 0
    const due = inv.due_date ? new Date(inv.due_date as string).getTime() : now
    const ageDays = Math.floor((now - due) / 86400000)
    total += amount
    if (ageDays <= 0) buckets.current += amount
    else if (ageDays <= 30) buckets.days_1_30 += amount
    else if (ageDays <= 60) buckets.days_31_60 += amount
    else if (ageDays <= 90) buckets.days_61_90 += amount
    else buckets.over_90 += amount
  }

  return { total_outstanding: total, invoice_count: invoices.length, buckets, currency: invoices[0]?.currency ?? 'USD' }
}

async function syncCashPosition(baseUrl: string, ak: string, as_: string) {
  const entries = await fetchErpList(baseUrl, ak, as_, 'GL Entry', [
    'account', 'debit', 'credit', 'posting_date',
  ], [['is_cancelled', '=', '0']], 1000)

  let cash = 0
  for (const e of entries) {
    cash += (Number(e.debit) || 0) - (Number(e.credit) || 0)
  }

  return {
    net_cash: cash,
    entry_count: entries.length,
    as_of: new Date().toISOString().slice(0, 10),
  }
}

async function syncInventoryLevels(baseUrl: string, ak: string, as_: string) {
  const bins = await fetchErpList(baseUrl, ak, as_, 'Bin', [
    'item_code', 'warehouse', 'actual_qty', 'reserved_qty', 'projected_qty', 'valuation_rate',
  ])

  const low: typeof bins = []
  for (const b of bins) {
    const proj = Number(b.projected_qty) || 0
    const reserved = Number(b.reserved_qty) || 0
    if (proj <= reserved * 1.1) low.push(b)
  }

  return {
    total_sku_count: bins.length,
    low_stock_items: low.slice(0, 20),
    low_stock_count: low.length,
    bins: bins.slice(0, 100),
  }
}

async function syncOpenOrders(baseUrl: string, ak: string, as_: string) {
  const [sales, purchases] = await Promise.all([
    fetchErpList(baseUrl, ak, as_, 'Sales Order', [
      'name', 'customer', 'grand_total', 'currency', 'transaction_date', 'delivery_date', 'status',
    ], [['status', 'not in', ['Completed','Cancelled']], ['docstatus', '=', '1']]),
    fetchErpList(baseUrl, ak, as_, 'Purchase Order', [
      'name', 'supplier', 'grand_total', 'currency', 'transaction_date', 'schedule_date', 'status',
    ], [['status', 'not in', ['Completed','Cancelled']], ['docstatus', '=', '1']]),
  ])

  return {
    open_sales_orders: sales.length,
    open_purchase_orders: purchases.length,
    sales_order_total: sales.reduce((s, o) => s + (Number(o.grand_total) || 0), 0),
    purchase_order_total: purchases.reduce((s, o) => s + (Number(o.grand_total) || 0), 0),
    sales_orders: sales.slice(0, 30),
    purchase_orders: purchases.slice(0, 30),
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function runSync(orgId: string) {
  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, erp_type, base_url, api_key, api_secret')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .single()

  if (!conn) return { error: 'No active ERP connection for this org' }

  const { base_url: baseUrl, api_key: ak, api_secret: as_ } = conn

  const results: Record<string, unknown> = {}
  const errors: string[] = []

  const syncTasks: Array<{ type: string; fn: () => Promise<unknown> }> = [
    { type: 'ar_aging',          fn: () => syncArAging(baseUrl, ak, as_) },
    { type: 'ap_aging',          fn: () => syncApAging(baseUrl, ak, as_) },
    { type: 'cash_position',     fn: () => syncCashPosition(baseUrl, ak, as_) },
    { type: 'inventory_levels',  fn: () => syncInventoryLevels(baseUrl, ak, as_) },
    { type: 'open_orders',       fn: () => syncOpenOrders(baseUrl, ak, as_) },
  ]

  await Promise.all(syncTasks.map(async ({ type, fn }) => {
    try {
      const data = await fn()
      await adminClient
        .from('erp_sync_data')
        .upsert(
          {
            org_id: orgId,
            erp_connection_id: conn.id,
            data_type: type,
            data,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,data_type' }
        )
      results[type] = 'ok'
    } catch (err) {
      errors.push(`${type}: ${err instanceof Error ? err.message : 'failed'}`)
      results[type] = 'error'
    }
  }))

  await adminClient
    .from('erp_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      status: errors.length === syncTasks.length ? 'error' : 'active',
      error_message: errors.length ? errors.join('; ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id)

  // Fire-and-forget advisory generation
  void generateErpAdvisories(orgId).catch(() => { /* silently ignore */ })

  return { synced: results, errors }
}

// Manual sync trigger (authenticated user)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 401 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await runSync(userData.org_id)
  return NextResponse.json(result)
}

// Cron trigger — gated by CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Sync all active connections
  const { data: connections } = await adminClient
    .from('erp_connections')
    .select('org_id')
    .eq('status', 'active')

  if (!connections?.length) return NextResponse.json({ ok: true, synced: 0 })

  const results = await Promise.allSettled(
    connections.map((c: { org_id: string }) => runSync(c.org_id))
  )

  return NextResponse.json({
    ok: true,
    synced: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  })
}
