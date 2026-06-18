import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function today(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function paymentDueDate(paymentTerms: string | null | undefined): string {
  if (!paymentTerms) return today()
  const match = paymentTerms.match(/(\d+)/)
  const days = match?.[1] ? parseInt(match[1], 10) : 30
  const due = new Date()
  due.setDate(due.getDate() + days)
  return due.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

const STRIKE_LOGO_SVG = `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="36" height="36" rx="9" fill="#1428CC"/>
  <path d="M10 13.5C10 12.1193 11.1193 11 12.5 11H20C22.2091 11 24 12.7909 24 15C24 16.1046 23.5523 17.1046 22.8284 17.8284C23.5523 18.5523 24 19.5523 24 20.6569C24 22.9526 22.2091 24.7435 20 24.7435H12.5C11.1193 24.7435 10 23.624 10 22.2435V13.5Z" fill="white" opacity="0.15"/>
  <path d="M11 14C11 12.8954 11.8954 12 13 12H20.5C21.8807 12 23 13.1193 23 14.5C23 15.8807 21.8807 17 20.5 17H15.5C14.1193 17 13 18.1193 13 19.5C13 20.8807 14.1193 22 15.5 22H23" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
</svg>`

function buildHtml({
  docType,
  refNumber,
  content,
  buyerName,
  supplierName,
  generatedAt,
}: {
  docType: string
  refNumber: string
  content: string
  buyerName: string
  supplierName: string
  generatedAt: string
}): string {
  // Escape HTML in the AI-generated content to prevent injection, then re-render as pre
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docType} — ${refNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13.5px;
      line-height: 1.65;
      color: #0D0D0D;
      background: #ffffff;
      padding: 56px 64px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 44px;
      padding-bottom: 28px;
      border-bottom: 2.5px solid #1428CC;
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .wordmark {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.04em;
      color: #0D0D0D;
      line-height: 1;
    }
    .wordmark span { color: #1428CC; }
    .doc-meta { text-align: right; }
    .doc-type {
      font-size: 20px;
      font-weight: 700;
      color: #0D0D0D;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .doc-ref {
      font-size: 12px;
      font-weight: 600;
      color: #1428CC;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .doc-date {
      font-size: 12px;
      color: #6B7280;
    }

    /* ── Parties banner ── */
    .parties {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 16px;
      align-items: center;
      background: #F5F4F0;
      border-radius: 12px;
      padding: 18px 24px;
      margin-bottom: 36px;
    }
    .party-block { }
    .party-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6B7280;
      margin-bottom: 4px;
    }
    .party-name {
      font-size: 15px;
      font-weight: 700;
      color: #0D0D0D;
    }
    .arrow {
      font-size: 20px;
      color: #1428CC;
      font-weight: 700;
      text-align: center;
    }

    /* ── AI badge ── */
    .ai-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #EEF0FF;
      border: 1px solid rgba(20,40,204,0.15);
      border-radius: 8px;
      padding: 10px 16px;
      margin-bottom: 28px;
    }
    .ai-dot {
      font-size: 14px;
      color: #1428CC;
    }
    .ai-text {
      font-size: 12px;
      color: #1428CC;
      font-weight: 500;
    }
    .ai-text strong { font-weight: 700; }

    /* ── Document body ── */
    .doc-content {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      line-height: 1.75;
      color: #1a1a1a;
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #fafafa;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 28px 32px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 44px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .footer-left {
      font-size: 11px;
      color: #9CA3AF;
    }
    .footer-left strong { color: #6B7280; }
    .footer-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #EEF0FF;
      color: #1428CC;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .footer-right {
      font-size: 11px;
      color: #9CA3AF;
    }

    /* ── Print ── */
    @media print {
      body { padding: 24px 32px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo-row">
      ${STRIKE_LOGO_SVG}
      <span class="wordmark">Strike<span>SCF</span></span>
    </div>
    <div class="doc-meta">
      <div class="doc-type">${docType}</div>
      <div class="doc-ref">${refNumber}</div>
      <div class="doc-date">${generatedAt}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party-block">
      <div class="party-label">Buyer</div>
      <div class="party-name">${buyerName}</div>
    </div>
    <div class="arrow">→</div>
    <div class="party-block" style="text-align:right">
      <div class="party-label">Supplier</div>
      <div class="party-name">${supplierName}</div>
    </div>
  </div>

  <div class="ai-banner">
    <span class="ai-dot">✦</span>
    <span class="ai-text"><strong>Strike AI</strong> — This document was generated by Strike's AI engine based on verified deal data on the Strike SCF platform. Review before executing.</span>
  </div>

  <div class="doc-content">${escaped}</div>

  <div class="footer">
    <span class="footer-left">Generated by <strong>Strike SCF</strong> · strikescf.com</span>
    <span class="footer-badge">✦ Strike AI</span>
    <span class="footer-right">${generatedAt}</span>
  </div>

</body>
</html>`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  let body: { type: 'po' | 'invoice' }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { type } = body
  if (type !== 'po' && type !== 'invoice') {
    return NextResponse.json({ error: 'type must be po or invoice' }, { status: 400 })
  }

  const { data: deal } = await adminClient
    .from('deals')
    .select('*')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(userData.role)
  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  if (!isParty && !isBankUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [buyerRes, supplierRes, lineItemsRes] = await Promise.all([
    adminClient.from('organizations').select('legal_name, doing_business_as, address_line1, city, state, zip, country_of_origin').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('legal_name, doing_business_as, address_line1, city, state, zip, country_of_origin').eq('id', deal.supplier_org_id).single(),
    deal.listing_id
      ? adminClient.from('listing_line_items').select('name, description, quantity, unit, unit_price, currency').eq('listing_id', deal.listing_id)
      : Promise.resolve({ data: [] }),
  ])

  const buyer = buyerRes.data
  const supplier = supplierRes.data
  const lineItems: any[] = (lineItemsRes as any).data ?? []

  const buyerName = buyer?.doing_business_as || buyer?.legal_name || 'Buyer'
  const supplierName = supplier?.doing_business_as || supplier?.legal_name || 'Supplier'
  const dealId8 = id.slice(0, 8).toUpperCase()
  const currency = deal.agreed_currency ?? 'USD'
  const totalValue = deal.total_value ?? deal.agreed_price ?? 0

  const lineItemsText = lineItems.length > 0
    ? lineItems.map((li: any, i: number) =>
        `${i + 1}. ${li.name ?? li.description ?? 'Item'} — Qty: ${li.quantity ?? '—'} ${li.unit ?? ''} @ ${fmt(li.unit_price, li.currency ?? currency)} = ${li.quantity && li.unit_price ? fmt(li.quantity * li.unit_price, li.currency ?? currency) : '—'}`
      ).join('\n')
    : `${deal.goods_description ?? 'Trade Goods'} — Total: ${fmt(totalValue, currency)}`

  // Use stored AI draft if available, otherwise generate fresh
  const storedDraft = type === 'po' ? (deal as any).ai_po_draft : (deal as any).ai_invoice_draft

  let docContent: string

  if (storedDraft) {
    docContent = storedDraft
  } else {
    const prompt = type === 'po'
      ? `Generate a complete, professional Purchase Order document for a verified trade on the Strike SCF platform.

PO Number: STRIKE-PO-${dealId8}
Date: ${today()}
Buyer: ${buyerName}${buyer?.city ? `, ${buyer.city}` : ''}${buyer?.country_of_origin ? `, ${buyer.country_of_origin}` : ''}
Supplier: ${supplierName}${supplier?.city ? `, ${supplier.city}` : ''}${supplier?.country_of_origin ? `, ${supplier.country_of_origin}` : ''}
Line Items:
${lineItemsText}
Total Value: ${fmt(totalValue, currency)}
Delivery Date: ${deal.agreed_delivery_date ?? 'As agreed'}
Incoterms: ${deal.agreed_incoterms ?? 'CIF'}
Payment Terms: ${deal.agreed_payment_terms ?? 'Net 30'}
${deal.delivery_location ? `Delivery Location: ${deal.delivery_location}` : ''}

Include: PO header, itemized line items with quantities and prices, delivery terms, payment terms, special conditions if any, and signature blocks for both parties. Format as a formal trade document.`
      : `Generate a complete, professional Commercial Invoice for a verified trade on the Strike SCF platform.

Invoice Number: STRIKE-INV-${dealId8}
Invoice Date: ${today()}
Due Date: ${paymentDueDate(deal.agreed_payment_terms)}
Seller (Supplier): ${supplierName}${supplier?.city ? `, ${supplier.city}` : ''}${supplier?.country_of_origin ? `, ${supplier.country_of_origin}` : ''}
Buyer: ${buyerName}${buyer?.city ? `, ${buyer.city}` : ''}${buyer?.country_of_origin ? `, ${buyer.country_of_origin}` : ''}
Line Items:
${lineItemsText}
Total Amount: ${fmt(totalValue, currency)}
Incoterms: ${deal.agreed_incoterms ?? 'CIF'}
Payment Terms: ${deal.agreed_payment_terms ?? 'Net 30'}
Delivery Date: ${deal.agreed_delivery_date ?? 'As agreed'}

Include: invoice header, line items table with unit prices and totals, subtotal, any taxes (mark as 0 if not applicable), grand total, bank details placeholder, payment instructions, and signature block.`

    const result = await callClaude({
      system: 'You are Strike AI, the document generation engine of the Strike SCF supply chain finance platform. Generate professional, legally-structured trade documents. Output plain text only — no markdown, no asterisks, no pound signs. Use clear section headers with ALL CAPS or dashes. Structure the document as a real trade professional would.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
    })

    docContent = result.text

    // Log AI usage (fire-and-forget)
    adminClient.from('ai_usage').insert({
      user_id: userData.id,
      org_id: userData.org_id,
      feature: 'document',
      tokens_input: result.usage.input_tokens ?? 0,
      tokens_output: result.usage.output_tokens ?? 0,
      tokens_total: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
      model: AI_MODEL,
    })
  }

  const refNumber = type === 'po' ? `STRIKE-PO-${dealId8}` : `STRIKE-INV-${dealId8}`
  const docType = type === 'po' ? 'Purchase Order' : 'Commercial Invoice'
  const generatedAt = today()

  const html = buildHtml({ docType, refNumber, content: docContent, buyerName, supplierName, generatedAt })

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${type === 'po' ? 'purchase-order' : 'commercial-invoice'}-${dealId8}.html"`,
    },
  })
}
