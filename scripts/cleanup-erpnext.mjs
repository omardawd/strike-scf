#!/usr/bin/env node
// Wipes all seeded Walmart data from ERPNext so you can re-seed cleanly.
//
// Usage:
//   node scripts/cleanup-erpnext.mjs <base_url> <api_key> <api_secret>

const [,, BASE_URL, API_KEY, API_SECRET] = process.argv
if (!BASE_URL || !API_KEY || !API_SECRET) {
  console.error('Usage: node cleanup-erpnext.mjs <base_url> <api_key> <api_secret>')
  process.exit(1)
}

const base = BASE_URL.replace(/\/$/, '')
const headers = { 'Authorization': `token ${API_KEY}:${API_SECRET}`, 'Content-Type': 'application/json' }

async function api(method, path, body) {
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, json }
}

async function list(doctype, filters = [], fields = ['name'], limit = 500) {
  const params = new URLSearchParams({ fields: JSON.stringify(fields), filters: JSON.stringify(filters), limit_page_length: String(limit) })
  const { json } = await api('GET', `/api/resource/${encodeURIComponent(doctype)}?${params}`)
  return json.data ?? []
}

async function cancelAndDelete(doctype, name) {
  // Use frappe.client.cancel — triggers the full cancel workflow (reverses GL/SLE entries)
  await api('POST', '/api/method/frappe.client.cancel', { doctype, name })
  // Now delete
  const { ok, json } = await api('DELETE', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
  if (!ok) {
    const msg = json?.exception ?? json?.message ?? JSON.stringify(json).slice(0, 120)
    process.stdout.write(`\n  ⚠ ${doctype}/${name}: ${msg.slice(0, 120)}`)
  }
}

async function deleteDoc(doctype, name) {
  const { ok, json } = await api('DELETE', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
  if (!ok) {
    const msg = json?.message ?? JSON.stringify(json).slice(0, 100)
    process.stdout.write(`\n  ⚠ ${doctype}/${name}: ${msg}`)
  }
}

async function wipe(doctype, filters, needsCancel = true) {
  const rows = await list(doctype, filters)
  if (!rows.length) { console.log(`  (none found)`); return }
  process.stdout.write(`  Deleting ${rows.length} ${doctype} records...`)
  for (const row of rows) {
    if (needsCancel) await cancelAndDelete(doctype, row.name)
    else await deleteDoc(doctype, row.name)
    process.stdout.write('.')
  }
  console.log()
}

// Known seeded values
const SUPPLIERS = ['Procter and Gamble Co', 'Unilever US LLC', 'Samsung Electronics America', 'Nike Inc', 'Levi Strauss and Co', 'Dyson Inc', 'Instant Brands LLC', 'Johnson and Johnson Consumer', 'Kellogg Sales Company', 'Hanes Brands Inc']
const CUSTOMERS = ['Sams Club Corporate', 'Walmart eCommerce', 'Walmart Neighborhood Market', 'Walmart Supercenter East']
const ITEM_CODES = ['ELEC-TV-65-4K','ELEC-LAPTOP-15','ELEC-PHONE-5G','ELEC-TABLET-10','ELEC-HEADPHONE','GROC-TIDE-100','GROC-PAMPERS-N4','GROC-DOVE-SOAP','GROC-PRINGLES','GROC-PAPER-TOW','APRL-LEVIS-501M','APRL-NIKE-AIR','APRL-HANES-TSHIRT','HOME-INSTANT-POT','HOME-DYSON-V11','HOME-PLANTS-MIX','PHRM-TYLENOL-500','PHRM-VITAMIN-D','SPRT-YOGA-MAT','SPRT-DUMBBELL-20']

async function main() {
  console.log(`\n🧹 Cleaning up seeded ERPNext data\n   Site: ${base}\n`)

  // Order matters: child docs before parents, submitted docs need cancel first

  console.log('→ Payment Entries...')
  await wipe('Payment Entry', [['party', 'in', [...SUPPLIERS, ...CUSTOMERS]]])

  console.log('→ Sales Invoices...')
  await wipe('Sales Invoice', [['customer', 'in', CUSTOMERS]])

  console.log('→ Purchase Invoices...')
  await wipe('Purchase Invoice', [['supplier', 'in', SUPPLIERS]])

  console.log('→ Stock Entries (Material Receipt)...')
  await wipe('Stock Entry', [['stock_entry_type', '=', 'Material Receipt']])

  console.log('→ Purchase Orders...')
  await wipe('Purchase Order', [['supplier', 'in', SUPPLIERS]])

  // Items, Customers, Suppliers: ERPNext blocks deletion once linked to transactions.
  // That's fine — they're unique by name/code so re-seeding won't duplicate them.
  console.log('→ Items / Customers / Suppliers: skipped (unique by name, won\'t duplicate on re-seed)')

  console.log('\n✅ Cleanup done. Run the seed script to re-populate cleanly.\n')
}

main().catch(e => { console.error('\n✗ Fatal:', e.message); process.exit(1) })
