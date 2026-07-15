#!/usr/bin/env node
// Seed an ERPNext site with realistic Walmart US data for Strike ERP integration testing.
//
// Usage:
//   node scripts/seed-erpnext-walmart.mjs <base_url> <api_key> <api_secret>

const [,, BASE_URL, API_KEY, API_SECRET] = process.argv

if (!BASE_URL || !API_KEY || !API_SECRET) {
  console.error('Usage: node seed-erpnext-walmart.mjs <base_url> <api_key> <api_secret>')
  process.exit(1)
}

const base = BASE_URL.replace(/\/$/, '')
const headers = {
  'Authorization': `token ${API_KEY}:${API_SECRET}`,
  'Content-Type': 'application/json',
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function get(path) {
  const r = await fetch(`${base}${path}`, { headers })
  return r.json()
}

async function post(path, body) {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await r.json()
  if (!r.ok) {
    // Extract the most useful part of the Frappe error
    const msg = json?.message ?? json?._server_messages ?? json?.exception ?? json?.exc_type ?? JSON.stringify(json).slice(0, 300)
    throw new Error(msg)
  }
  return json
}

async function put(path, body) {
  const r = await fetch(`${base}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
  const json = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(json).slice(0, 200))
  return json
}

async function create(doctype, doc) {
  try {
    const res = await post(`/api/resource/${encodeURIComponent(doctype)}`, doc)
    return res.data
  } catch (e) {
    const msg = String(e.message)
    if (msg.includes('DuplicateEntry') || msg.includes('duplicate') || msg.includes('already exist')) {
      return { name: doc.name ?? doc[Object.keys(doc)[0]] ?? '?' }
    }
    // Parse _server_messages JSON if present
    let detail = msg
    try {
      const parsed = JSON.parse(msg)
      const inner = Array.isArray(parsed) ? parsed[0] : parsed
      const innerParsed = typeof inner === 'string' ? JSON.parse(inner) : inner
      detail = innerParsed?.message ?? innerParsed?.title ?? msg
    } catch { /* keep original */ }
    console.warn(`\n  ⚠ skipped ${doctype}: ${detail.slice(0, 200)}`)
    return null
  }
}

async function submit(doctype, name) {
  try {
    await put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, { docstatus: 1 })
  } catch {
    // already submitted or minor validation — ignore
  }
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function log(msg) { console.log(`→ ${msg}`) }

// ── Probe: fetch all the ERPNext config we need before creating anything ──────

async function probe() {
  log('Probing ERPNext configuration...')

  // Company
  const compRes = await get('/api/resource/Company?limit=1')
  const company = compRes.data?.[0]?.name
  if (!company) throw new Error('No company found in ERPNext')

  const compDetail = await get(`/api/resource/Company/${encodeURIComponent(company)}`)
  const abbr = compDetail.data?.abbr ?? 'SCF'
  log(`  Company: ${company} (abbr: ${abbr})`)

  // Cost center
  const ccRes = await get(`/api/resource/Cost Center?filters=[["company","=","${company}"],["is_group","=","0"]]&limit=1`)
  const costCenter = ccRes.data?.[0]?.name
  log(`  Cost Center: ${costCenter}`)

  // Accounts we need
  async function findAccount(types, keywords = []) {
    for (const type of types) {
      const r = await get(`/api/resource/Account?filters=[["account_type","=","${type}"],["company","=","${company}"],["is_group","=","0"]]&limit=10`)
      if (r.data?.length) {
        if (keywords.length) {
          const match = r.data.find(a => keywords.some(k => a.name.toLowerCase().includes(k.toLowerCase())))
          if (match) return match.name
        }
        return r.data[0].name
      }
    }
    return null
  }

  // Find any account by name keyword (for "stock reçu non facturé" etc.)
  async function findAccountByName(keywords) {
    for (const kw of keywords) {
      const r = await get(`/api/resource/Account?filters=[["company","=","${company}"],["is_group","=","0"],["name","like","%${kw}%"]]&limit=1`)
      if (r.data?.length) return r.data[0].name
    }
    return null
  }

  const payableAcc   = await findAccount(['Payable'], ['payable', 'creditor'])
  const receivableAcc = await findAccount(['Receivable'], ['receivable', 'debtor'])
  const bankAcc      = await findAccount(['Bank', 'Cash'], ['bank', 'cash', 'caisse', 'tresor', 'banque'])
  const stockAcc     = await findAccount(['Stock', 'Expense Account'], ['stock', 'inventory'])
  const incomeAcc    = await findAccount(['Income Account', 'Revenue'], ['sales', 'income', 'revenue'])
  const expenseAcc   = await findAccount(['Expense Account', 'Cost of Goods Sold'], ['expense', 'cost', 'purchase'])

  // Company default currency (may be CAD for French/Canadian ERPNext)
  const companyCurrency = compDetail.data?.default_currency ?? 'USD'
  log(`  Currency:   ${companyCurrency}`)

  // "Stock Received Not Billed" — ERPNext forces this on PI for stock items without PO receipt
  const stockReceivedAcc = await findAccountByName(['non factur', 'not billed', 'reçu non', 'received not'])

  log(`  Payable:    ${payableAcc}`)
  log(`  Receivable: ${receivableAcc}`)
  log(`  Bank:       ${bankAcc}`)
  log(`  Stock:      ${stockAcc}`)
  log(`  Income:     ${incomeAcc}`)
  log(`  Expense:    ${expenseAcc}`)
  log(`  StockRcvd:  ${stockReceivedAcc}`)

  // Warehouses (already created or default)
  const whRes = await get(`/api/resource/Warehouse?filters=[["company","=","${company}"],["is_group","=","0"]]&limit=10`)
  const warehouses = whRes.data?.map(w => w.name) ?? []
  const defaultWh = warehouses[0]
  log(`  Warehouses: ${warehouses.slice(0, 3).join(', ')}…`)

  // Customer / Supplier / Territory groups
  // Must be a non-group (leaf) customer/supplier group
  const cgRes = await get('/api/resource/Customer Group?filters=[["is_group","=","0"]]&limit=1')
  const customerGroup = cgRes.data?.[0]?.name ?? 'Commercial'

  const sgRes = await get('/api/resource/Supplier Group?filters=[["is_group","=","0"]]&limit=1')
  const supplierGroup = sgRes.data?.[0]?.name ?? 'All Supplier Groups'

  const terrRes = await get('/api/resource/Territory?limit=1')
  const territory = terrRes.data?.[0]?.name ?? 'All Territories'

  // Mode of payment
  const mopRes = await get('/api/resource/Mode of Payment?limit=1')
  const mop = mopRes.data?.[0]?.name ?? 'Cash'

  return { company, abbr, companyCurrency, costCenter, payableAcc, receivableAcc, bankAcc, stockAcc, incomeAcc, expenseAcc, stockReceivedAcc, warehouses, defaultWh, customerGroup, supplierGroup, territory, mop }
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

async function seedSuppliers(ctx) {
  log('Suppliers...')
  const names = [
    'Procter and Gamble Co', 'Unilever US LLC', 'Samsung Electronics America',
    'Nike Inc', 'Levi Strauss and Co', 'Dyson Inc',
    'Instant Brands LLC', 'Johnson and Johnson Consumer',
    'Kellogg Sales Company', 'Hanes Brands Inc',
  ]
  for (const name of names) {
    await create('Supplier', { supplier_name: name, supplier_group: ctx.supplierGroup })
    process.stdout.write('.')
  }
  console.log()
  return names
}

// ── Customers ─────────────────────────────────────────────────────────────────

async function seedCustomers(ctx) {
  log('Customers...')
  const names = ['Sams Club Corporate', 'Walmart eCommerce', 'Walmart Neighborhood Market', 'Walmart Supercenter East']
  for (const name of names) {
    // Try with territory first, fall back to without it
    let doc = await create('Customer', { customer_name: name, customer_group: ctx.customerGroup, customer_type: 'Company', territory: ctx.territory })
    if (!doc) {
      doc = await create('Customer', { customer_name: name, customer_group: ctx.customerGroup, customer_type: 'Company' })
    }
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
  return names
}

// ── Items ─────────────────────────────────────────────────────────────────────

async function seedItems(ctx) {
  log('Items (SKUs)...')
  const items = [
    { item_code: 'ELEC-TV-65-4K',    item_name: '65in 4K Smart TV',               item_group: 'All Item Groups', valuation_rate: 420, standard_rate: 698 },
    { item_code: 'ELEC-LAPTOP-15',   item_name: '15in Laptop 16GB',                item_group: 'All Item Groups', valuation_rate: 580, standard_rate: 849 },
    { item_code: 'ELEC-PHONE-5G',    item_name: 'Smartphone 5G 128GB',             item_group: 'All Item Groups', valuation_rate: 310, standard_rate: 499 },
    { item_code: 'ELEC-TABLET-10',   item_name: '10in Tablet WiFi',                item_group: 'All Item Groups', valuation_rate: 185, standard_rate: 299 },
    { item_code: 'ELEC-HEADPHONE',   item_name: 'Wireless Noise-Cancel Headphones',item_group: 'All Item Groups', valuation_rate: 89,  standard_rate: 149 },
    { item_code: 'GROC-TIDE-100',    item_name: 'Tide Detergent 100oz',            item_group: 'All Item Groups', valuation_rate: 11.2, standard_rate: 18.97 },
    { item_code: 'GROC-PAMPERS-N4',  item_name: 'Pampers Diapers Size 4 132ct',    item_group: 'All Item Groups', valuation_rate: 22.5, standard_rate: 39.94 },
    { item_code: 'GROC-DOVE-SOAP',   item_name: 'Dove Body Wash 22oz',             item_group: 'All Item Groups', valuation_rate: 4.8,  standard_rate: 8.97 },
    { item_code: 'GROC-PRINGLES',    item_name: 'Pringles Original 40oz',          item_group: 'All Item Groups', valuation_rate: 6.2,  standard_rate: 10.98 },
    { item_code: 'GROC-PAPER-TOW',   item_name: 'Bounty Paper Towels 12-pack',     item_group: 'All Item Groups', valuation_rate: 14.5, standard_rate: 24.97 },
    { item_code: 'APRL-LEVIS-501M',  item_name: 'Levis 501 Mens Jeans',            item_group: 'All Item Groups', valuation_rate: 28,  standard_rate: 59.98 },
    { item_code: 'APRL-NIKE-AIR',    item_name: 'Nike Air Max Running Shoes',       item_group: 'All Item Groups', valuation_rate: 62,  standard_rate: 109.99 },
    { item_code: 'APRL-HANES-TSHIRT',item_name: 'Hanes Mens T-Shirt 3-pack',       item_group: 'All Item Groups', valuation_rate: 9.5, standard_rate: 16.98 },
    { item_code: 'HOME-INSTANT-POT', item_name: 'Instant Pot 6Qt Duo',             item_group: 'All Item Groups', valuation_rate: 55,  standard_rate: 99.95 },
    { item_code: 'HOME-DYSON-V11',   item_name: 'Dyson V11 Cordless Vacuum',       item_group: 'All Item Groups', valuation_rate: 320, standard_rate: 599.99 },
    { item_code: 'HOME-PLANTS-MIX',  item_name: 'Indoor Plant Assortment 4in',     item_group: 'All Item Groups', valuation_rate: 4.2, standard_rate: 8.98 },
    { item_code: 'PHRM-TYLENOL-500', item_name: 'Tylenol Extra Strength 500ct',    item_group: 'All Item Groups', valuation_rate: 12.5, standard_rate: 22.44 },
    { item_code: 'PHRM-VITAMIN-D',   item_name: 'Vitamin D3 5000IU 365ct',         item_group: 'All Item Groups', valuation_rate: 9.8,  standard_rate: 16.88 },
    { item_code: 'SPRT-YOGA-MAT',    item_name: 'Premium Yoga Mat 6mm',            item_group: 'All Item Groups', valuation_rate: 18,  standard_rate: 34.99 },
    { item_code: 'SPRT-DUMBBELL-20', item_name: 'Dumbbell Set 20lb Pair',          item_group: 'All Item Groups', valuation_rate: 42,  standard_rate: 79.99 },
  ]
  for (const item of items) {
    await create('Item', {
      item_code: item.item_code,
      item_name: item.item_name,
      item_group: item.item_group,
      stock_uom: 'Nos',
      is_stock_item: 1,
      valuation_rate: item.valuation_rate,
      standard_rate: item.standard_rate,
    })
    process.stdout.write('.')
  }
  console.log()
  return items
}

// ── Purchase Invoices (AP Aging) ──────────────────────────────────────────────

async function seedPurchaseInvoices(ctx) {
  log('Purchase Invoices (AP aging)...')
  if (!ctx.payableAcc) { console.warn('  ⚠ No payable account found — skipping purchase invoices'); return }

  // ERPNext forces the stock valuation account (Stock de produits fini) for stock items — use it directly
  const piExpAcc = ctx.stockAcc

  const makeItem = (item_code, qty, rate) => ({
    item_code, qty, rate, uom: 'Nos',
    expense_account: piExpAcc,
    cost_center: ctx.costCenter,
    warehouse: ctx.defaultWh,
  })

  const invoices = [
    // Current
    { supplier: 'Procter and Gamble Co', posting_date: daysAgo(10), due_date: daysFromNow(20), items: [makeItem('GROC-TIDE-100', 5000, 11.2), makeItem('GROC-PAMPERS-N4', 3000, 22.5)] },
    { supplier: 'Samsung Electronics America', posting_date: daysAgo(5), due_date: daysFromNow(55), items: [makeItem('ELEC-LAPTOP-15', 1500, 580)] },
    { supplier: 'Nike Inc', posting_date: daysAgo(15), due_date: daysFromNow(15), items: [makeItem('APRL-NIKE-AIR', 4000, 62)] },
    // 1–30 days overdue
    { supplier: 'Unilever US LLC', posting_date: daysAgo(45), due_date: daysAgo(15), items: [makeItem('GROC-PAPER-TOW', 6000, 14.5), makeItem('GROC-DOVE-SOAP', 8000, 4.8)] },
    { supplier: 'Kellogg Sales Company', posting_date: daysAgo(40), due_date: daysAgo(10), items: [makeItem('GROC-PRINGLES', 5000, 6.2)] },
    // 31–60 days overdue
    { supplier: 'Johnson and Johnson Consumer', posting_date: daysAgo(80), due_date: daysAgo(50), items: [makeItem('PHRM-TYLENOL-500', 10000, 12.5)] },
    { supplier: 'Hanes Brands Inc', posting_date: daysAgo(75), due_date: daysAgo(45), items: [makeItem('APRL-HANES-TSHIRT', 8000, 9.5)] },
    // 61–90 days overdue
    { supplier: 'Instant Brands LLC', posting_date: daysAgo(110), due_date: daysAgo(80), items: [makeItem('HOME-INSTANT-POT', 2000, 55)] },
    // 90+ days overdue — triggers HIGH advisory
    { supplier: 'Levi Strauss and Co', posting_date: daysAgo(150), due_date: daysAgo(120), items: [makeItem('APRL-LEVIS-501M', 6000, 28)] },
    { supplier: 'Dyson Inc', posting_date: daysAgo(140), due_date: daysAgo(110), items: [makeItem('HOME-DYSON-V11', 800, 320)] },
  ]

  for (const inv of invoices) {
    const doc = await create('Purchase Invoice', {
      ...inv,
      company: ctx.company,
      currency: ctx.companyCurrency,
      credit_to: ctx.payableAcc,
      update_stock: 1,
      set_warehouse: ctx.defaultWh,
      set_posting_time: 1,
    })
    if (doc?.name) await submit('Purchase Invoice', doc.name)
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
}

// ── Sales Invoices (AR) ───────────────────────────────────────────────────────

async function seedSalesInvoices(ctx) {
  log('Sales Invoices (AR)...')
  if (!ctx.receivableAcc) { console.warn('  ⚠ No receivable account — skipping sales invoices'); return }

  const makeItem = (item_code, qty, rate) => ({
    item_code, qty, rate, uom: 'Nos',
    income_account: ctx.incomeAcc,
    cost_center: ctx.costCenter,
    warehouse: ctx.defaultWh,
  })

  const invoices = [
    { customer: 'Sams Club Corporate', posting_date: daysAgo(20), due_date: daysFromNow(10), items: [makeItem('ELEC-TV-65-4K', 500, 698), makeItem('ELEC-HEADPHONE', 2000, 149)] },
    { customer: 'Walmart eCommerce', posting_date: daysAgo(15), due_date: daysFromNow(15), items: [makeItem('ELEC-PHONE-5G', 3000, 499)] },
    { customer: 'Walmart Neighborhood Market', posting_date: daysAgo(50), due_date: daysAgo(20), items: [makeItem('GROC-TIDE-100', 2000, 18.97), makeItem('GROC-PAMPERS-N4', 1500, 39.94)] },
    { customer: 'Walmart Supercenter East', posting_date: daysAgo(100), due_date: daysAgo(70), items: [makeItem('APRL-NIKE-AIR', 2500, 109.99), makeItem('HOME-INSTANT-POT', 800, 99.95)] },
  ]

  for (const inv of invoices) {
    const doc = await create('Sales Invoice', {
      ...inv,
      company: ctx.company,
      currency: ctx.companyCurrency,
      debit_to: ctx.receivableAcc,
      update_stock: 0,
      set_posting_time: 1,
    })
    if (doc?.name) await submit('Sales Invoice', doc.name)
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
}

// ── Stock Entries (Inventory) ─────────────────────────────────────────────────

async function seedStockEntries(ctx) {
  log('Stock Entries (inventory levels)...')
  if (!ctx.defaultWh) { console.warn('  ⚠ No warehouse found — skipping stock entries'); return }

  const makeItem = (item_code, qty, rate) => ({
    item_code, qty, uom: 'Nos',
    t_warehouse: ctx.defaultWh,
    basic_rate: rate,
    valuation_rate: rate,
  })

  const stock = [
    // Healthy
    makeItem('GROC-TIDE-100', 45000, 11.2),
    makeItem('GROC-PAMPERS-N4', 28000, 22.5),
    makeItem('GROC-DOVE-SOAP', 62000, 4.8),
    makeItem('GROC-PAPER-TOW', 38000, 14.5),
    makeItem('ELEC-PHONE-5G', 12000, 310),
    makeItem('PHRM-TYLENOL-500', 55000, 12.5),
    makeItem('PHRM-VITAMIN-D', 32000, 9.8),
    makeItem('APRL-HANES-TSHIRT', 40000, 9.5),
    makeItem('SPRT-YOGA-MAT', 8500, 18),
    // Critically low (triggers advisory)
    makeItem('ELEC-TV-65-4K', 85, 420),
    makeItem('ELEC-LAPTOP-15', 120, 580),
    makeItem('HOME-DYSON-V11', 45, 320),
    makeItem('HOME-INSTANT-POT', 210, 55),
    makeItem('APRL-NIKE-AIR', 380, 62),
    makeItem('GROC-PRINGLES', 1200, 6.2),
    makeItem('SPRT-DUMBBELL-20', 95, 42),
    makeItem('ELEC-TABLET-10', 160, 185),
    makeItem('APRL-LEVIS-501M', 290, 28),
    makeItem('ELEC-HEADPHONE', 420, 89),
  ]

  // Create in batches of 5 items per stock entry (ERPNext handles multi-item entries fine)
  const batches = []
  for (let i = 0; i < stock.length; i += 5) batches.push(stock.slice(i, i + 5))

  for (const batch of batches) {
    const doc = await create('Stock Entry', {
      stock_entry_type: 'Material Receipt',
      company: ctx.company,
      posting_date: daysAgo(30),
      items: batch,
    })
    if (doc?.name) await submit('Stock Entry', doc.name)
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
}

// ── Payment Entries (Cash Position) ──────────────────────────────────────────

async function seedPaymentEntries(ctx) {
  log('Payment Entries (cash position)...')
  const cashAcc = ctx.bankAcc ?? ctx.stockAcc ?? ctx.incomeAcc
  if (!cashAcc || !ctx.payableAcc) { console.warn('  ⚠ Missing accounts — skipping payment entries'); return }

  const payments = [
    { party_type: 'Supplier', party: 'Procter and Gamble Co',       payment_type: 'Pay',     paid_amount: 4_200_000, posting_date: daysAgo(5) },
    { party_type: 'Supplier', party: 'Samsung Electronics America',  payment_type: 'Pay',     paid_amount: 8_700_000, posting_date: daysAgo(8) },
    { party_type: 'Supplier', party: 'Nike Inc',                     payment_type: 'Pay',     paid_amount: 2_480_000, posting_date: daysAgo(12) },
    { party_type: 'Customer', party: 'Sams Club Corporate',          payment_type: 'Receive', paid_amount: 6_100_000, posting_date: daysAgo(3) },
    { party_type: 'Customer', party: 'Walmart eCommerce',            payment_type: 'Receive', paid_amount: 11_400_000, posting_date: daysAgo(7) },
    { party_type: 'Supplier', party: 'Dyson Inc',                    payment_type: 'Pay',     paid_amount: 3_840_000, posting_date: daysAgo(18) },
    { party_type: 'Supplier', party: 'Unilever US LLC',              payment_type: 'Pay',     paid_amount: 1_620_000, posting_date: daysAgo(20) },
    { party_type: 'Customer', party: 'Walmart Supercenter East',     payment_type: 'Receive', paid_amount: 4_950_000, posting_date: daysAgo(14) },
    { party_type: 'Supplier', party: 'Johnson and Johnson Consumer', payment_type: 'Pay',     paid_amount: 1_875_000, posting_date: daysAgo(25) },
    { party_type: 'Supplier', party: 'Kellogg Sales Company',        payment_type: 'Pay',     paid_amount: 930_000,  posting_date: daysAgo(22) },
  ]

  for (const p of payments) {
    const isPay = p.payment_type === 'Pay'
    const doc = await create('Payment Entry', {
      payment_type: p.payment_type,
      party_type: p.party_type,
      party: p.party,
      paid_amount: p.paid_amount,
      received_amount: p.paid_amount,
      posting_date: p.posting_date,
      company: ctx.company,
      mode_of_payment: ctx.mop,
      paid_from: isPay ? cashAcc : ctx.receivableAcc,
      paid_to: isPay ? ctx.payableAcc : cashAcc,
      paid_from_account_currency: ctx.companyCurrency,
      paid_to_account_currency: ctx.companyCurrency,
    })
    if (doc?.name) await submit('Payment Entry', doc.name)
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function seedPurchaseOrders(ctx) {
  log('Purchase Orders...')

  const makeItem = (item_code, qty, rate, schedule_date) => ({
    item_code, qty, rate, uom: 'Nos', schedule_date,
    warehouse: ctx.defaultWh,
  })

  const orders = [
    { supplier: 'Procter and Gamble Co',      date: daysAgo(5),  delivery: daysFromNow(25), items: [makeItem('GROC-TIDE-100', 8000, 11.2, daysFromNow(25)), makeItem('GROC-PAMPERS-N4', 5000, 22.5, daysFromNow(25))] },
    { supplier: 'Samsung Electronics America', date: daysAgo(3),  delivery: daysFromNow(45), items: [makeItem('ELEC-TV-65-4K', 2500, 420, daysFromNow(45)), makeItem('ELEC-PHONE-5G', 6000, 310, daysFromNow(45))] },
    { supplier: 'Nike Inc',                    date: daysAgo(8),  delivery: daysFromNow(30), items: [makeItem('APRL-NIKE-AIR', 10000, 62, daysFromNow(30))] },
    { supplier: 'Dyson Inc',                   date: daysAgo(2),  delivery: daysFromNow(60), items: [makeItem('HOME-DYSON-V11', 1200, 320, daysFromNow(60))] },
    { supplier: 'Unilever US LLC',             date: daysAgo(10), delivery: daysFromNow(20), items: [makeItem('GROC-PAPER-TOW', 9500, 14.5, daysFromNow(20))] },
    { supplier: 'Johnson and Johnson Consumer', date: daysAgo(1), delivery: daysFromNow(35), items: [makeItem('PHRM-TYLENOL-500', 15000, 12.5, daysFromNow(35))] },
    { supplier: 'Hanes Brands Inc',            date: daysAgo(6),  delivery: daysFromNow(28), items: [makeItem('APRL-HANES-TSHIRT', 20000, 9.5, daysFromNow(28))] },
  ]

  for (const o of orders) {
    const doc = await create('Purchase Order', {
      supplier: o.supplier,
      company: ctx.company,
      transaction_date: o.date,
      schedule_date: o.delivery,
      currency: 'USD',
      items: o.items,
    })
    if (doc?.name) await submit('Purchase Order', doc.name)
    process.stdout.write(doc ? '.' : 'x')
  }
  console.log()
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏪 Seeding ERPNext with Walmart US data`)
  console.log(`   Site: ${base}\n`)

  try {
    const whoami = await get('/api/method/frappe.auth.get_logged_user')
    console.log(`✓ Connected as: ${whoami.message}\n`)
  } catch {
    console.error('✗ Cannot connect — check your credentials'); process.exit(1)
  }

  const ctx = await probe()
  console.log()

  await seedSuppliers(ctx)
  await seedCustomers(ctx)
  await seedItems(ctx)
  await seedPurchaseOrders(ctx)
  await seedPurchaseInvoices(ctx)
  await seedSalesInvoices(ctx)
  await seedStockEntries(ctx)
  await seedPaymentEntries(ctx)

  console.log(`
✅ Done! Your ERPNext now has realistic Walmart US data.

Next steps:
  1. Go to Strike → Settings → ERP Integration
  2. Connect: ${base}
  3. Click Sync Now
  4. Ask Strike AI: "What should I be worried about today?"
`)
}

main().catch(e => { console.error('\n✗ Fatal:', e.message); process.exit(1) })
