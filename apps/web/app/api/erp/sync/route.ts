import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateErpAdvisories } from '@/lib/ai/advisory'
import { assertPublicHttpUrl } from '@/lib/ssrf'

// Node runtime: the SSRF guard uses node:dns / node:net.
export const runtime = 'nodejs'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Odoo XML-RPC helpers (works on all versions + odoo.com SaaS) ─────────────

function xmlEnc(v: unknown): string {
  if (v === null || v === undefined) return '<nil/>'
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`
  if (typeof v === 'number' && Number.isInteger(v)) return `<int>${v}</int>`
  if (typeof v === 'number') return `<double>${v}</double>`
  if (typeof v === 'string') return `<string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`
  if (Array.isArray(v)) return `<array><data>${v.map(i=>`<value>${xmlEnc(i)}</value>`).join('')}</data></array>`
  if (typeof v === 'object') {
    const members = Object.entries(v as Record<string,unknown>).map(([k,val])=>`<member><name>${k}</name><value>${xmlEnc(val)}</value></member>`).join('')
    return `<struct>${members}</struct>`
  }
  return `<string>${v}</string>`
}

function xmlBuild(method: string, params: unknown[]) {
  const ps = params.map(p=>`<param><value>${xmlEnc(p)}</value></param>`).join('')
  return `<?xml version='1.0'?><methodCall><methodName>${method}</methodName><params>${ps}</params></methodCall>`
}

// Recursive descent XML-RPC value parser
function xmlParseVal(s: string, i: number): { val: unknown; i: number } {
  while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t') i++

  if (s.startsWith('<int>', i) || s.startsWith('<i4>', i)) {
    const tag = s.startsWith('<int>', i) ? 'int' : 'i4'
    const ci = i + tag.length + 2
    const end = s.indexOf(`</${tag}>`, ci)
    return { val: parseInt(s.slice(ci, end)), i: end + tag.length + 3 }
  }
  if (s.startsWith('<double>', i)) {
    const ci = i + 8; const end = s.indexOf('</double>', ci)
    return { val: parseFloat(s.slice(ci, end)), i: end + 9 }
  }
  if (s.startsWith('<boolean>', i)) {
    const ci = i + 9; const end = s.indexOf('</boolean>', ci)
    return { val: s.slice(ci, end) === '1', i: end + 10 }
  }
  if (s.startsWith('<string/>', i)) return { val: '', i: i + 9 }
  if (s.startsWith('<string>', i)) {
    const ci = i + 8; const end = s.indexOf('</string>', ci)
    return { val: s.slice(ci, end).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'), i: end + 9 }
  }
  if (s.startsWith('<nil/>', i)) return { val: null, i: i + 6 }
  if (s.startsWith('<array>', i)) {
    i += 7
    while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
    i += 6 // <data>
    const items: unknown[] = []
    while (true) {
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      if (s.startsWith('</data>', i)) { i += 7; break }
      if (!s.startsWith('<value>', i)) break
      i += 7
      const r = xmlParseVal(s, i); items.push(r.val); i = r.i
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      if (s.startsWith('</value>', i)) i += 8
    }
    while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
    if (s.startsWith('</array>', i)) i += 8
    return { val: items, i }
  }
  if (s.startsWith('<struct>', i)) {
    i += 8
    const obj: Record<string, unknown> = {}
    while (true) {
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      if (s.startsWith('</struct>', i)) { i += 9; break }
      if (!s.startsWith('<member>', i)) break
      i += 8
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      i += 6; const ne = s.indexOf('</name>', i); const name = s.slice(i, ne); i = ne + 7
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      i += 7 // <value>
      const r = xmlParseVal(s, i); obj[name] = r.val; i = r.i
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      if (s.startsWith('</value>', i)) i += 8
      while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r') i++
      if (s.startsWith('</member>', i)) i += 9
    }
    return { val: obj, i }
  }
  // Raw string (no type wrapper)
  const end = s.indexOf('</value>', i)
  return { val: end > i ? s.slice(i, end).trim() : '', i: end < 0 ? i : end }
}

function xmlParse(xml: string): unknown {
  if (xml.includes('<fault>')) {
    const m = xml.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string>/)
    throw new Error(`Odoo: ${m?.[1]?.trim() ?? 'Access Denied'}`)
  }
  const vi = xml.indexOf('<value>', xml.indexOf('<param>')) + 7
  return xmlParseVal(xml, vi).val
}

async function xmlrpc(baseUrl: string, path: string, method: string, params: unknown[]) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlBuild(method, params),
  })
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`)
  return xmlParse(await res.text())
}

async function odooAuth(baseUrl: string, db: string, email: string, apiKey: string) {
  const uid = await xmlrpc(baseUrl, '/xmlrpc/2/common', 'authenticate', [db, email, apiKey, {}])
  if (!uid || uid === 0 || uid === false) throw new Error('Invalid credentials — check email and API key')
  return uid as number
}

async function odooFetch(
  baseUrl: string, db: string, uid: number, apiKey: string,
  model: string, domain: unknown[][], fields: string[], limit = 500
) {
  const result = await xmlrpc(baseUrl, '/xmlrpc/2/object', 'execute_kw', [
    db, uid, apiKey, model, 'search_read', [domain], { fields, limit }
  ])
  return (result ?? []) as Record<string, unknown>[]
}

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

// ── Odoo sync functions ───────────────────────────────────────────────────────

interface OdooCtx { baseUrl: string; db: string; uid: number; apiKey: string }

async function odooSyncArAging(ctx: OdooCtx) {
  const invoices = await odooFetch(ctx.baseUrl, ctx.db, ctx.uid, ctx.apiKey, 'account.move',
    [['move_type', '=', 'out_invoice'], ['payment_state', 'not in', ['paid', 'reversed', 'in_payment']], ['state', '=', 'posted']],
    ['name', 'partner_id', 'amount_residual', 'invoice_date', 'invoice_date_due', 'currency_id']
  )
  const now = Date.now()
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 }
  let total = 0
  for (const inv of invoices) {
    const amount = Number(inv.amount_residual) || 0
    const due = inv.invoice_date_due ? new Date(inv.invoice_date_due as string).getTime() : now
    const ageDays = Math.floor((now - due) / 86400000)
    total += amount
    if (ageDays <= 0) buckets.current += amount
    else if (ageDays <= 30) buckets.days_1_30 += amount
    else if (ageDays <= 60) buckets.days_31_60 += amount
    else if (ageDays <= 90) buckets.days_61_90 += amount
    else buckets.over_90 += amount
  }
  return { total_outstanding: total, invoice_count: invoices.length, buckets, currency: 'USD', invoices: invoices.slice(0, 50) }
}

async function odooSyncApAging(ctx: OdooCtx) {
  const invoices = await odooFetch(ctx.baseUrl, ctx.db, ctx.uid, ctx.apiKey, 'account.move',
    [['move_type', '=', 'in_invoice'], ['payment_state', 'not in', ['paid', 'reversed', 'in_payment']], ['state', '=', 'posted']],
    ['name', 'partner_id', 'amount_residual', 'invoice_date', 'invoice_date_due', 'currency_id']
  )
  const now = Date.now()
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 }
  let total = 0
  for (const inv of invoices) {
    const amount = Number(inv.amount_residual) || 0
    const due = inv.invoice_date_due ? new Date(inv.invoice_date_due as string).getTime() : now
    const ageDays = Math.floor((now - due) / 86400000)
    total += amount
    if (ageDays <= 0) buckets.current += amount
    else if (ageDays <= 30) buckets.days_1_30 += amount
    else if (ageDays <= 60) buckets.days_31_60 += amount
    else if (ageDays <= 90) buckets.days_61_90 += amount
    else buckets.over_90 += amount
  }
  return { total_outstanding: total, invoice_count: invoices.length, buckets, currency: 'USD' }
}

async function odooSyncCashPosition(ctx: OdooCtx) {
  const accounts = await odooFetch(ctx.baseUrl, ctx.db, ctx.uid, ctx.apiKey, 'account.account',
    [['account_type', 'in', ['asset_cash', 'asset_bank']]],
    ['name', 'code', 'current_balance']
  )
  const netCash = accounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0)
  return { net_cash: netCash, account_count: accounts.length, accounts: accounts.slice(0, 20), as_of: new Date().toISOString().slice(0, 10) }
}

async function odooSyncInventory(ctx: OdooCtx) {
  const quants = await odooFetch(ctx.baseUrl, ctx.db, ctx.uid, ctx.apiKey, 'stock.quant',
    [['location_id.usage', '=', 'internal']],
    ['product_id', 'location_id', 'quantity', 'reserved_quantity']
  )
  const low = quants.filter(q => {
    const avail = (Number(q.quantity) || 0) - (Number(q.reserved_quantity) || 0)
    return avail <= (Number(q.reserved_quantity) || 0) * 1.1
  })
  return { total_sku_count: quants.length, low_stock_count: low.length, low_stock_items: low.slice(0, 20), bins: quants.slice(0, 100) }
}

async function odooSyncOpenOrders(ctx: OdooCtx) {
  const tryFetch = async (model: string, domain: unknown[][], fields: string[]) => {
    try { return await odooFetch(ctx.baseUrl, ctx.db, ctx.uid, ctx.apiKey, model, domain, fields) }
    catch (e) { if (String(e).includes("doesn't exist")) return []; throw e }
  }
  const [sales, purchases] = await Promise.all([
    tryFetch('sale.order',
      [['state', 'in', ['sale', 'done']]],
      ['name', 'partner_id', 'amount_total', 'currency_id', 'date_order', 'commitment_date', 'state']
    ),
    tryFetch('purchase.order',
      [['state', 'in', ['purchase', 'done']]],
      ['name', 'partner_id', 'amount_total', 'currency_id', 'date_order', 'date_planned', 'state']
    ),
  ])
  return {
    open_sales_orders: sales.length,
    open_purchase_orders: purchases.length,
    sales_order_total: sales.reduce((s, o) => s + (Number(o.amount_total) || 0), 0),
    purchase_order_total: purchases.reduce((s, o) => s + (Number(o.amount_total) || 0), 0),
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

  const { base_url: baseUrl, api_key: ak, api_secret: as_, erp_type } = conn

  // Re-validate the stored URL before every sync — defends against DNS
  // rebinding (host was public at connect-time, now points at an internal IP).
  try {
    await assertPublicHttpUrl(baseUrl)
  } catch (err) {
    return { error: `ERP URL is no longer permitted: ${err instanceof Error ? err.message : 'blocked'}` }
  }

  const results: Record<string, unknown> = {}
  const errors: string[] = []

  let syncTasks: Array<{ type: string; fn: () => Promise<unknown> }>

  if (erp_type === 'odoo') {
    // For Odoo: api_key = email (username), api_secret = Bearer API key
    const extra = (conn as Record<string, unknown>).extra_config as Record<string, string> | null
    const db = extra?.db_name ?? new URL(baseUrl).hostname.split('.')[0] ?? 'odoo'
    const uid = await odooAuth(baseUrl, db, ak ?? '', as_ ?? '')
    const ctx: OdooCtx = { baseUrl, db, uid, apiKey: as_ ?? '' }
    syncTasks = [
      { type: 'ar_aging',         fn: () => odooSyncArAging(ctx) },
      { type: 'ap_aging',         fn: () => odooSyncApAging(ctx) },
      { type: 'cash_position',    fn: () => odooSyncCashPosition(ctx) },
      { type: 'inventory_levels', fn: () => odooSyncInventory(ctx) },
      { type: 'open_orders',      fn: () => odooSyncOpenOrders(ctx) },
    ]
  } else {
    syncTasks = [
      { type: 'ar_aging',         fn: () => syncArAging(baseUrl, ak, as_) },
      { type: 'ap_aging',         fn: () => syncApAging(baseUrl, ak, as_) },
      { type: 'cash_position',    fn: () => syncCashPosition(baseUrl, ak, as_) },
      { type: 'inventory_levels', fn: () => syncInventoryLevels(baseUrl, ak, as_) },
      { type: 'open_orders',      fn: () => syncOpenOrders(baseUrl, ak, as_) },
    ]
  }

  const runTask = async ({ type, fn }: { type: string; fn: () => Promise<unknown> }) => {
    try {
      const data = await fn()
      await adminClient
        .from('erp_sync_data')
        .upsert(
          { org_id: orgId, erp_connection_id: conn.id, data_type: type, data, fetched_at: new Date().toISOString() },
          { onConflict: 'org_id,data_type' }
        )
      results[type] = 'ok'
    } catch (err) {
      errors.push(`${type}: ${err instanceof Error ? err.message : 'failed'}`)
      results[type] = 'error'
    }
  }

  if (erp_type === 'odoo') {
    // Sequential — Odoo.com rate-limits concurrent XML-RPC requests
    for (const task of syncTasks) await runTask(task)
  } else {
    await Promise.all(syncTasks.map(runTask))
  }

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
