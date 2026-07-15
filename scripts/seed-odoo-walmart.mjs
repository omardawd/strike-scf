#!/usr/bin/env node
// Seed an Odoo instance with realistic Walmart US data for Strike ERP integration testing.
//
// Usage:
//   node scripts/seed-odoo-walmart.mjs <base_url> <db_name> <email> <api_key_or_password>
//
// Example (odoo.com):
//   node scripts/seed-odoo-walmart.mjs https://mycompany.odoo.com mycompany admin@co.com my-api-key

const [,, BASE_URL, DB_NAME, EMAIL, PASSWORD] = process.argv
if (!BASE_URL || !DB_NAME || !EMAIL || !PASSWORD) {
  console.error('Usage: node seed-odoo-walmart.mjs <base_url> <db_name> <email> <api_key_or_password>')
  process.exit(1)
}

const base = BASE_URL.replace(/\/$/, '')
let UID = 0

// ── XML-RPC helpers ───────────────────────────────────────────────────────────

function xmlEnc(v) {
  if (v === null || v === undefined) return '<nil/>'
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`
  if (typeof v === 'number' && Number.isInteger(v)) return `<int>${v}</int>`
  if (typeof v === 'number') return `<double>${v}</double>`
  if (typeof v === 'string') return `<string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string>`
  if (Array.isArray(v)) return `<array><data>${v.map(i=>`<value>${xmlEnc(i)}</value>`).join('')}</data></array>`
  if (typeof v === 'object') {
    const m = Object.entries(v).map(([k,val])=>`<member><name>${k}</name><value>${xmlEnc(val)}</value></member>`).join('')
    return `<struct>${m}</struct>`
  }
  return `<string>${v}</string>`
}

function xmlBuild(method, params) {
  const ps = params.map(p=>`<param><value>${xmlEnc(p)}</value></param>`).join('')
  return `<?xml version='1.0'?><methodCall><methodName>${method}</methodName><params>${ps}</params></methodCall>`
}

function xmlParseVal(s, i) {
  while (' \n\r\t'.includes(s[i])) i++
  if (s.startsWith('<int>', i) || s.startsWith('<i4>', i)) {
    const tag = s.startsWith('<int>', i) ? 'int' : 'i4'
    const ci = i + tag.length + 2; const end = s.indexOf(`</${tag}>`, ci)
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
    i += 7; while (' \n\r\t'.includes(s[i])) i++
    i += 6 // <data>
    const items = []
    while (true) {
      while (' \n\r\t'.includes(s[i])) i++
      if (s.startsWith('</data>', i)) { i += 7; break }
      if (!s.startsWith('<value>', i)) break
      i += 7; const r = xmlParseVal(s, i); items.push(r.val); i = r.i
      while (' \n\r\t'.includes(s[i])) i++
      if (s.startsWith('</value>', i)) i += 8
    }
    while (' \n\r\t'.includes(s[i])) i++
    if (s.startsWith('</array>', i)) i += 8
    return { val: items, i }
  }
  if (s.startsWith('<struct>', i)) {
    i += 8; const obj = {}
    while (true) {
      while (' \n\r\t'.includes(s[i])) i++
      if (s.startsWith('</struct>', i)) { i += 9; break }
      if (!s.startsWith('<member>', i)) break
      i += 8; while (' \n\r\t'.includes(s[i])) i++
      i += 6; const ne = s.indexOf('</name>', i); const name = s.slice(i, ne); i = ne + 7
      while (' \n\r\t'.includes(s[i])) i++
      i += 7; const r = xmlParseVal(s, i); obj[name] = r.val; i = r.i
      while (' \n\r\t'.includes(s[i])) i++
      if (s.startsWith('</value>', i)) i += 8
      while (' \n\r\t'.includes(s[i])) i++
      if (s.startsWith('</member>', i)) i += 9
    }
    return { val: obj, i }
  }
  const end = s.indexOf('</value>', i)
  return { val: end > i ? s.slice(i, end).trim() : '', i: end < 0 ? i : end }
}

function xmlParse(xml) {
  if (xml.includes('<fault>')) {
    const m = xml.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string>/)
    throw new Error(m?.[1]?.trim() ?? 'Odoo fault')
  }
  const vi = xml.indexOf('<value>', xml.indexOf('<param>')) + 7
  return xmlParseVal(xml, vi).val
}

async function xmlrpc(path, method, params) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlBuild(method, params),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return xmlParse(await r.text())
}

async function call(model, method, args = [], kwargs = {}) {
  return xmlrpc('/xmlrpc/2/object', 'execute_kw', [DB_NAME, UID, PASSWORD, model, method, args, { context: { lang: 'en_US' }, ...kwargs }])
}

async function create(model, vals) {
  try {
    const id = await call(model, 'create', [vals])
    return id
  } catch (e) {
    const msg = String(e.message)
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('already exists')) {
      process.stdout.write('~')
      return null
    }
    console.warn(`\n  ⚠ skipped ${model}: ${msg.slice(-300)}`)
    return null
  }
}

async function search(model, domain, fields, limit = 500) {
  return call(model, 'search_read', [domain], { fields, limit })
}

async function getFirst(model, domain, fields) {
  const rows = await search(model, domain, fields, 1)
  return rows?.[0] ?? null
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}

// ── Probe: fetch required config ──────────────────────────────────────────────

async function probe() {
  console.log('→ Probing Odoo configuration...')

  // Company
  const company = await getFirst('res.company', [], ['id', 'name', 'currency_id'])
  if (!company) throw new Error('No company found')
  const companyId = company.id
  const currency = Array.isArray(company.currency_id) ? company.currency_id[1] : 'USD'
  console.log(`  Company: ${company.name} (currency: ${currency})`)

  // Currency record
  const currencyRec = await getFirst('res.currency', [['name', '=', currency.split(' ')[0] ?? 'USD']], ['id', 'name'])
  const currencyId = currencyRec?.id

  // Journals
  const purchaseJournal = await getFirst('account.journal', [['type', '=', 'purchase']], ['id', 'name'])
  const salesJournal    = await getFirst('account.journal', [['type', '=', 'sale']], ['id', 'name'])
  const bankJournal     = await getFirst('account.journal', [['type', 'in', ['bank', 'cash']]], ['id', 'name'])
  console.log(`  Purchase journal: ${purchaseJournal?.name}, Sales: ${salesJournal?.name}, Bank: ${bankJournal?.name}`)

  // Accounts
  const payableAcc   = await getFirst('account.account', [['account_type', '=', 'liability_payable']], ['id', 'name'])
  const receivableAcc = await getFirst('account.account', [['account_type', '=', 'asset_receivable']], ['id', 'name'])
  const expenseAcc   = await getFirst('account.account', [['account_type', 'in', ['expense', 'expense_direct_cost']]], ['id', 'name'])
  const incomeAcc    = await getFirst('account.account', [['account_type', '=', 'income']], ['id', 'name'])
  console.log(`  Payable: ${payableAcc?.name}, Receivable: ${receivableAcc?.name}`)

  // UoM
  const uom = await getFirst('uom.uom', [['name', 'in', ['Units', 'Unit(s)', 'pcs', 'Pieces']]], ['id', 'name'])
  const uomId = uom?.id ?? 1

  // Payment terms
  const payTerms = await getFirst('account.payment.term', [], ['id', 'name'])
  const payTermsId = payTerms?.id

  // Locations (internal stock)
  const stockLoc = await getFirst('stock.location', [['usage', '=', 'internal'], ['active', '=', true]], ['id', 'name'])
  const stockLocId = stockLoc?.id

  return { companyId, currencyId, purchaseJournal, salesJournal, bankJournal, payableAcc, receivableAcc, expenseAcc, incomeAcc, uomId, payTermsId, stockLocId }
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

async function seedSuppliers() {
  console.log('→ Suppliers...')
  const names = [
    'Procter and Gamble Co', 'Unilever US LLC', 'Samsung Electronics America',
    'Nike Inc', 'Levi Strauss and Co', 'Dyson Inc',
    'Instant Brands LLC', 'Johnson and Johnson Consumer',
    'Kellogg Sales Company', 'Hanes Brands Inc',
  ]
  const ids = {}
  for (const name of names) {
    const id = await create('res.partner', { name, supplier_rank: 1, is_company: true, country_id: 233 })
    if (id) ids[name] = id
    process.stdout.write('.')
  }
  console.log()
  return ids
}

// ── Customers ─────────────────────────────────────────────────────────────────

async function seedCustomers() {
  console.log('→ Customers...')
  const names = ['Sams Club Corporate', 'Walmart eCommerce', 'Walmart Neighborhood Market', 'Walmart Supercenter East']
  const ids = {}
  for (const name of names) {
    const id = await create('res.partner', { name, customer_rank: 1, is_company: true, country_id: 233 })
    if (id) ids[name] = id
    process.stdout.write('.')
  }
  console.log()
  return ids
}

// ── Products ──────────────────────────────────────────────────────────────────

async function seedProducts(ctx) {
  console.log('→ Products (SKUs)...')
  const products = [
    { name: '65in 4K Smart TV',                default_code: 'ELEC-TV-65-4K',     standard_price: 420,  list_price: 698 },
    { name: '15in Laptop 16GB',                default_code: 'ELEC-LAPTOP-15',    standard_price: 580,  list_price: 849 },
    { name: 'Smartphone 5G 128GB',             default_code: 'ELEC-PHONE-5G',     standard_price: 310,  list_price: 499 },
    { name: '10in Tablet WiFi',                default_code: 'ELEC-TABLET-10',    standard_price: 185,  list_price: 299 },
    { name: 'Wireless Noise-Cancel Headphones',default_code: 'ELEC-HEADPHONE',    standard_price: 89,   list_price: 149 },
    { name: 'Tide Detergent 100oz',            default_code: 'GROC-TIDE-100',     standard_price: 11.2, list_price: 18.97 },
    { name: 'Pampers Diapers Size 4 132ct',    default_code: 'GROC-PAMPERS-N4',   standard_price: 22.5, list_price: 39.94 },
    { name: 'Dove Body Wash 22oz',             default_code: 'GROC-DOVE-SOAP',    standard_price: 4.8,  list_price: 8.97 },
    { name: 'Pringles Original 40oz',          default_code: 'GROC-PRINGLES',     standard_price: 6.2,  list_price: 10.98 },
    { name: 'Bounty Paper Towels 12-pack',     default_code: 'GROC-PAPER-TOW',    standard_price: 14.5, list_price: 24.97 },
    { name: 'Levis 501 Mens Jeans',            default_code: 'APRL-LEVIS-501M',   standard_price: 28,   list_price: 59.98 },
    { name: 'Nike Air Max Running Shoes',      default_code: 'APRL-NIKE-AIR',     standard_price: 62,   list_price: 109.99 },
    { name: 'Hanes Mens T-Shirt 3-pack',       default_code: 'APRL-HANES-TSHIRT', standard_price: 9.5,  list_price: 16.98 },
    { name: 'Instant Pot 6Qt Duo',             default_code: 'HOME-INSTANT-POT',  standard_price: 55,   list_price: 99.95 },
    { name: 'Dyson V11 Cordless Vacuum',       default_code: 'HOME-DYSON-V11',    standard_price: 320,  list_price: 599.99 },
    { name: 'Tylenol Extra Strength 500ct',    default_code: 'PHRM-TYLENOL-500',  standard_price: 12.5, list_price: 22.44 },
    { name: 'Vitamin D3 5000IU 365ct',         default_code: 'PHRM-VITAMIN-D',    standard_price: 9.8,  list_price: 16.88 },
    { name: 'Premium Yoga Mat 6mm',            default_code: 'SPRT-YOGA-MAT',     standard_price: 18,   list_price: 34.99 },
    { name: 'Dumbbell Set 20lb Pair',          default_code: 'SPRT-DUMBBELL-20',  standard_price: 42,   list_price: 79.99 },
    { name: 'Indoor Plant Assortment 4in',     default_code: 'HOME-PLANTS-MIX',   standard_price: 4.2,  list_price: 8.98 },
  ]
  const ids = {}
  for (const p of products) {
    const id = await create('product.product', {
      name: p.name,
      default_code: p.default_code,
      type: 'consu',
      standard_price: p.standard_price,
      list_price: p.list_price,
      uom_id: ctx.uomId,
    })
    if (id) ids[p.default_code] = id
    process.stdout.write('.')
  }
  console.log()
  return ids
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function seedPurchaseOrders(ctx, supplierIds, productIds) {
  console.log('→ Purchase Orders...')
  // Resolve partner IDs if we don't have them from create (partner may already exist)
  async function getOrLookupPartner(name) {
    if (supplierIds[name]) return supplierIds[name]
    const p = await getFirst('res.partner', [['name', '=', name]], ['id'])
    return p?.id
  }

  const makeItem = (code, qty, price) => ({
    product_id: productIds[code],
    product_qty: qty,
    price_unit: price,
    date_planned: daysFromNow(30),
    name: code,
  })

  const orders = [
    { supplier: 'Procter and Gamble Co',       date: daysAgo(5),  items: [makeItem('GROC-TIDE-100', 8000, 11.2), makeItem('GROC-PAMPERS-N4', 5000, 22.5)] },
    { supplier: 'Samsung Electronics America', date: daysAgo(3),  items: [makeItem('ELEC-TV-65-4K', 2500, 420), makeItem('ELEC-PHONE-5G', 6000, 310)] },
    { supplier: 'Nike Inc',                    date: daysAgo(8),  items: [makeItem('APRL-NIKE-AIR', 10000, 62)] },
    { supplier: 'Dyson Inc',                   date: daysAgo(2),  items: [makeItem('HOME-DYSON-V11', 1200, 320)] },
    { supplier: 'Unilever US LLC',             date: daysAgo(10), items: [makeItem('GROC-PAPER-TOW', 9500, 14.5)] },
    { supplier: 'Johnson and Johnson Consumer', date: daysAgo(1), items: [makeItem('PHRM-TYLENOL-500', 15000, 12.5)] },
    { supplier: 'Hanes Brands Inc',            date: daysAgo(6),  items: [makeItem('APRL-HANES-TSHIRT', 20000, 9.5)] },
  ]

  for (const o of orders) {
    const partnerId = await getOrLookupPartner(o.supplier)
    if (!partnerId || o.items.some(i => !i.product_id)) { process.stdout.write('x'); continue }
    const poId = await create('purchase.order', {
      partner_id: partnerId,
      date_order: o.date,
      order_line: o.items.map(item => [0, 0, item]),
    })
    if (poId) {
      // Confirm PO
      try { await call('purchase.order', 'button_confirm', [[poId]]) } catch {}
    }
    process.stdout.write(poId ? '.' : 'x')
  }
  console.log()
}

// ── Vendor Bills (AP Aging) ───────────────────────────────────────────────────

async function seedVendorBills(ctx, supplierIds, productIds) {
  console.log('→ Vendor Bills (AP aging)...')

  async function getOrLookupPartner(name) {
    if (supplierIds[name]) return supplierIds[name]
    const p = await getFirst('res.partner', [['name', '=', name]], ['id'])
    return p?.id
  }

  const makeItem = (code, qty, price) => ({
    product_id: productIds[code],
    quantity: qty,
    price_unit: price,
    name: code,
    account_id: ctx.expenseAcc?.id,
  })

  const bills = [
    // Current
    { supplier: 'Procter and Gamble Co',       date: daysAgo(10), due: daysFromNow(20), items: [makeItem('GROC-TIDE-100', 5000, 11.2), makeItem('GROC-PAMPERS-N4', 3000, 22.5)] },
    { supplier: 'Samsung Electronics America', date: daysAgo(5),  due: daysFromNow(55), items: [makeItem('ELEC-LAPTOP-15', 1500, 580)] },
    { supplier: 'Nike Inc',                    date: daysAgo(15), due: daysFromNow(15), items: [makeItem('APRL-NIKE-AIR', 4000, 62)] },
    // 1–30 overdue
    { supplier: 'Unilever US LLC',             date: daysAgo(45), due: daysAgo(15), items: [makeItem('GROC-PAPER-TOW', 6000, 14.5), makeItem('GROC-DOVE-SOAP', 8000, 4.8)] },
    { supplier: 'Kellogg Sales Company',       date: daysAgo(40), due: daysAgo(10), items: [makeItem('GROC-PRINGLES', 5000, 6.2)] },
    // 31–60 overdue
    { supplier: 'Johnson and Johnson Consumer', date: daysAgo(80), due: daysAgo(50), items: [makeItem('PHRM-TYLENOL-500', 10000, 12.5)] },
    { supplier: 'Hanes Brands Inc',            date: daysAgo(75), due: daysAgo(45), items: [makeItem('APRL-HANES-TSHIRT', 8000, 9.5)] },
    // 61–90 overdue
    { supplier: 'Instant Brands LLC',          date: daysAgo(110), due: daysAgo(80), items: [makeItem('HOME-INSTANT-POT', 2000, 55)] },
    // 90+ overdue — triggers HIGH advisory
    { supplier: 'Levi Strauss and Co',         date: daysAgo(150), due: daysAgo(120), items: [makeItem('APRL-LEVIS-501M', 6000, 28)] },
    { supplier: 'Dyson Inc',                   date: daysAgo(140), due: daysAgo(110), items: [makeItem('HOME-DYSON-V11', 800, 320)] },
  ]

  for (const b of bills) {
    const partnerId = await getOrLookupPartner(b.supplier)
    if (!partnerId || b.items.some(i => !i.product_id)) { process.stdout.write('x'); continue }
    const billId = await create('account.move', {
      move_type: 'in_invoice',
      partner_id: partnerId,
      invoice_date: b.date,
      invoice_date_due: b.due,
      journal_id: ctx.purchaseJournal?.id,
      invoice_line_ids: b.items.map(item => [0, 0, item]),
    })
    if (billId) {
      try { await call('account.move', 'action_post', [[billId]]) } catch {}
    }
    process.stdout.write(billId ? '.' : 'x')
  }
  console.log()
}

// ── Customer Invoices (AR Aging) ──────────────────────────────────────────────

async function seedCustomerInvoices(ctx, customerIds, productIds) {
  console.log('→ Customer Invoices (AR aging)...')

  async function getOrLookupPartner(name) {
    if (customerIds[name]) return customerIds[name]
    const p = await getFirst('res.partner', [['name', '=', name]], ['id'])
    return p?.id
  }

  const makeItem = (code, qty, price) => ({
    product_id: productIds[code],
    quantity: qty,
    price_unit: price,
    name: code,
    account_id: ctx.incomeAcc?.id,
  })

  const invoices = [
    { customer: 'Sams Club Corporate',          date: daysAgo(20),  due: daysFromNow(10), items: [makeItem('ELEC-TV-65-4K', 500, 698), makeItem('ELEC-HEADPHONE', 2000, 149)] },
    { customer: 'Walmart eCommerce',            date: daysAgo(15),  due: daysFromNow(15), items: [makeItem('ELEC-PHONE-5G', 3000, 499)] },
    { customer: 'Walmart Neighborhood Market',  date: daysAgo(50),  due: daysAgo(20),     items: [makeItem('GROC-TIDE-100', 2000, 18.97), makeItem('GROC-PAMPERS-N4', 1500, 39.94)] },
    { customer: 'Walmart Supercenter East',     date: daysAgo(100), due: daysAgo(70),     items: [makeItem('APRL-NIKE-AIR', 2500, 109.99), makeItem('HOME-INSTANT-POT', 800, 99.95)] },
  ]

  for (const inv of invoices) {
    const partnerId = await getOrLookupPartner(inv.customer)
    if (!partnerId || inv.items.some(i => !i.product_id)) { process.stdout.write('x'); continue }
    const invId = await create('account.move', {
      move_type: 'out_invoice',
      partner_id: partnerId,
      invoice_date: inv.date,
      invoice_date_due: inv.due,
      journal_id: ctx.salesJournal?.id,
      invoice_line_ids: inv.items.map(item => [0, 0, item]),
    })
    if (invId) {
      try { await call('account.move', 'action_post', [[invId]]) } catch {}
    }
    process.stdout.write(invId ? '.' : 'x')
  }
  console.log()
}

// ── Inventory (stock.quant) ───────────────────────────────────────────────────

async function seedInventory(ctx, productIds) {
  console.log('→ Inventory levels...')
  if (!ctx.stockLocId) { console.warn('  ⚠ No internal stock location found — skipping inventory'); return }

  const stock = [
    // Healthy
    { code: 'GROC-TIDE-100',     qty: 45000 },
    { code: 'GROC-PAMPERS-N4',   qty: 28000 },
    { code: 'GROC-DOVE-SOAP',    qty: 62000 },
    { code: 'GROC-PAPER-TOW',    qty: 38000 },
    { code: 'ELEC-PHONE-5G',     qty: 12000 },
    { code: 'PHRM-TYLENOL-500',  qty: 55000 },
    { code: 'PHRM-VITAMIN-D',    qty: 32000 },
    { code: 'APRL-HANES-TSHIRT', qty: 40000 },
    { code: 'SPRT-YOGA-MAT',     qty: 8500 },
    // Critically low — triggers advisory
    { code: 'ELEC-TV-65-4K',     qty: 85 },
    { code: 'ELEC-LAPTOP-15',    qty: 120 },
    { code: 'HOME-DYSON-V11',    qty: 45 },
    { code: 'HOME-INSTANT-POT',  qty: 210 },
    { code: 'APRL-NIKE-AIR',     qty: 380 },
    { code: 'GROC-PRINGLES',     qty: 1200 },
    { code: 'SPRT-DUMBBELL-20',  qty: 95 },
    { code: 'ELEC-TABLET-10',    qty: 160 },
    { code: 'APRL-LEVIS-501M',   qty: 290 },
    { code: 'ELEC-HEADPHONE',    qty: 420 },
  ]

  for (const s of stock) {
    const productId = productIds[s.code]
    if (!productId) { process.stdout.write('x'); continue }
    // Use inventory adjustment (stock.quant write)
    try {
      await call('stock.quant', 'with_prefetch', [[]])
      // Try direct quant creation
      await create('stock.quant', {
        product_id: productId,
        location_id: ctx.stockLocId,
        inventory_quantity: s.qty,
      })
    } catch {
      // Older Odoo: use inventory adjustment
      try {
        await call('stock.quant', '_update_available_quantity', [productId, ctx.stockLocId, s.qty])
      } catch {}
    }
    process.stdout.write('.')
  }
  console.log()
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏪 Seeding Odoo with Walmart US data`)
  console.log(`   Site: ${base} | DB: ${DB_NAME}\n`)

  // Auth via XML-RPC
  const uid = await xmlrpc('/xmlrpc/2/common', 'authenticate', [DB_NAME, EMAIL, PASSWORD, {}])
  if (!uid || uid === false || uid === 0) { console.error('✗ Login failed — check db, email, and API key'); process.exit(1) }
  UID = uid
  console.log(`✓ Logged in (uid: ${UID})\n`)
  const ctx = await probe()
  console.log()

  const supplierIds = await seedSuppliers()
  const customerIds = await seedCustomers()
  const productIds  = await seedProducts(ctx)

  await seedPurchaseOrders(ctx, supplierIds, productIds)
  await seedVendorBills(ctx, supplierIds, productIds)
  await seedCustomerInvoices(ctx, customerIds, productIds)
  await seedInventory(ctx, productIds)

  console.log(`
✅ Done! Your Odoo now has realistic Walmart US data.

Next steps:
  1. Go to Strike → Settings → ERP Integration
  2. Select Odoo, enter: ${base}
  3. DB: ${DB_NAME} | Email: ${EMAIL}
  4. Click Sync Now
  5. Ask Strike AI: "What should I be worried about today?"
`)
}

main().catch(e => { console.error('\n✗ Fatal:', e.message); process.exit(1) })
