import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtAddr(org: Record<string, unknown>): string {
  const parts = [org.address_line1, org.city, org.state, org.zip, org.country].filter(Boolean)
  return parts.join(', ') || (org.country as string) || ''
}

function paymentDueDate(paymentTerms: string | null | undefined): string {
  if (!paymentTerms) return today()
  const match = paymentTerms.match(/(\d+)/)
  const days = match?.[1] ? parseInt(match[1], 10) : 30
  const due = new Date()
  due.setDate(due.getDate() + days)
  return due.toISOString().slice(0, 10)
}

export async function POST(
  _request: Request,
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

  const { data: deal } = await adminClient
    .from('deals')
    .select('*')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (deal.status !== 'agreed') {
    return NextResponse.json({ error: 'Documents can only be generated when deal status is agreed' }, { status: 400 })
  }

  if (deal.documents_generated_at) {
    return NextResponse.json({ error: 'Documents already generated' }, { status: 409 })
  }

  const [buyerRes, supplierRes] = await Promise.all([
    adminClient.from('organizations').select('*').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('*').eq('id', deal.supplier_org_id).single(),
  ])

  const buyer = buyerRes.data as Record<string, unknown>
  const supplier = supplierRes.data as Record<string, unknown>
  if (!buyer || !supplier) {
    return NextResponse.json({ error: 'Organization data not found' }, { status: 500 })
  }

  const dealId8 = id.slice(0, 8).toUpperCase()
  const dateToday = today()
  const totalValue = deal.total_value ?? deal.agreed_price ?? 0
  const unitPrice = deal.agreed_quantity && deal.agreed_quantity > 0
    ? (deal.agreed_price / deal.agreed_quantity).toFixed(2)
    : deal.agreed_price

  const buyerName    = (buyer.legal_name || buyer.doing_business_as) as string
  const buyerAddr    = fmtAddr(buyer)
  const buyerCountry = (buyer.country_of_incorporation || buyer.country) as string

  const supplierName    = (supplier.legal_name || supplier.doing_business_as) as string
  const supplierAddr    = fmtAddr(supplier)
  const supplierCountry = (supplier.country_of_incorporation || supplier.country) as string

  const now = performance.now()

  const [poResult, invoiceResult, contractResult] = await Promise.all([
    callClaude({
      system:
        'You are Strike AI generating a professional Purchase Order for a verified trade deal on the Strike SCF platform. ' +
        'Output clean, structured plain text formatted for easy reading. Use proper PO conventions.',
      messages: [{
        role: 'user',
        content:
          `Generate a complete Purchase Order with these details:\n` +
          `PO Number: STRIKE-PO-${dealId8}\n` +
          `Date: ${dateToday}\n` +
          `Buyer: ${buyerName}, ${buyerAddr}\n` +
          `Supplier: ${supplierName}, ${supplierAddr}\n` +
          `Goods/Services: ${deal.goods_description ?? 'Trade Goods'}\n` +
          (deal.agreed_quantity != null ? `Quantity: ${deal.agreed_quantity} ${deal.agreed_unit ?? 'units'}\n` : '') +
          `Unit Price: ${unitPrice} ${deal.agreed_currency ?? 'USD'}\n` +
          `Total Value: ${totalValue} ${deal.agreed_currency ?? 'USD'}\n` +
          (deal.agreed_delivery_date ? `Delivery Date: ${deal.agreed_delivery_date}\n` : '') +
          (deal.delivery_location ? `Delivery Location: ${deal.delivery_location}\n` : '') +
          `Incoterms: ${deal.agreed_incoterms ?? 'CIF'}\n` +
          `Payment Terms: ${deal.agreed_payment_terms ?? 'Net 30'}\n` +
          `Include: PO header, itemized line items, delivery terms, payment terms, signature blocks for both parties.`,
      }],
      max_tokens: 1500,
    }),
    callClaude({
      system:
        'You are Strike AI generating a professional Commercial Invoice for a verified trade deal.',
      messages: [{
        role: 'user',
        content:
          `Generate a complete Commercial Invoice:\n` +
          `Invoice Number: STRIKE-INV-${dealId8}\n` +
          `Invoice Date: ${dateToday}\n` +
          `Due Date: ${paymentDueDate(deal.agreed_payment_terms)}\n` +
          `Seller: ${supplierName}, ${supplierAddr}, ${supplierCountry}\n` +
          `Buyer: ${buyerName}, ${buyerAddr}, ${buyerCountry}\n` +
          `Goods/Services: ${deal.goods_description ?? 'Trade Goods'}\n` +
          (deal.agreed_quantity != null ? `Quantity: ${deal.agreed_quantity} ${deal.agreed_unit ?? 'units'}\n` : '') +
          `Unit Price: ${unitPrice} ${deal.agreed_currency ?? 'USD'}\n` +
          `Total Value: ${totalValue} ${deal.agreed_currency ?? 'USD'}\n` +
          `Incoterms: ${deal.agreed_incoterms ?? 'CIF'}\n` +
          `Payment Terms: ${deal.agreed_payment_terms ?? 'Net 30'}\n` +
          `Include: invoice header, line items, subtotal, any applicable notes, banking details placeholder, signature block.`,
      }],
      max_tokens: 1500,
    }),
    callClaude({
      system:
        'You are Strike AI generating a professional Trade Agreement for a verified deal. This is a binding commercial document.',
      messages: [{
        role: 'user',
        content:
          `Generate a Trade Agreement between:\n` +
          `Party A (Buyer): ${buyerName}, incorporated in ${buyerCountry}\n` +
          `Party B (Supplier): ${supplierName}, incorporated in ${supplierCountry}\n` +
          `For the supply of: ${deal.goods_description ?? 'Trade Goods'}\n` +
          (deal.agreed_quantity != null ? `Quantity: ${deal.agreed_quantity} ${deal.agreed_unit ?? 'units'}\n` : '') +
          `Total Contract Value: ${totalValue} ${deal.agreed_currency ?? 'USD'}\n` +
          `Delivery Date: ${deal.agreed_delivery_date ?? 'As agreed'}\n` +
          `Incoterms: ${deal.agreed_incoterms ?? 'CIF'}\n` +
          `Payment Terms: ${deal.agreed_payment_terms ?? 'Net 30'}\n` +
          `Include: recitals, definitions, supply obligations, delivery terms, payment obligations, inspection rights, warranties, dispute resolution (arbitration), governing law, signature blocks. Keep clauses concise but legally complete.`,
      }],
      max_tokens: 1500,
    }),
  ])

  const latencyMs = Math.round(performance.now() - now)
  const nowTs = new Date().toISOString()

  const poText       = poResult.text
  const invoiceText  = invoiceResult.text
  const contractText = contractResult.text

  await adminClient.from('deals').update({
    ai_po_draft:              poText,
    ai_invoice_draft:         invoiceText,
    ai_contract_draft:        contractText,
    documents_generated_at:   nowTs,
    updated_at:               nowTs,
  }).eq('id', id)

  await Promise.all([
    adminClient.from('documents').insert([
      {
        name: `Purchase Order — STRIKE-PO-${dealId8}`,
        storage_path: null,
        mime_type: 'text/plain',
        entity_type: 'deal',
        entity_id: id,
        document_kind: 'ai_po',
        created_at: nowTs,
      },
      {
        name: `Commercial Invoice — STRIKE-INV-${dealId8}`,
        storage_path: null,
        mime_type: 'text/plain',
        entity_type: 'deal',
        entity_id: id,
        document_kind: 'ai_invoice',
        created_at: nowTs,
      },
      {
        name: `Trade Agreement — ${dealId8}`,
        storage_path: null,
        mime_type: 'text/plain',
        entity_type: 'deal',
        entity_id: id,
        document_kind: 'ai_contract',
        created_at: nowTs,
      },
    ]),
    adminClient.from('ai_usage').insert([
      {
        user_id: user.id,
        org_id: userData.org_id,
        feature: 'document',
        tokens_input: poResult.usage.input_tokens ?? 0,
        tokens_output: poResult.usage.output_tokens ?? 0,
        tokens_total: (poResult.usage.input_tokens ?? 0) + (poResult.usage.output_tokens ?? 0),
        model: AI_MODEL,
        created_at: nowTs,
      },
      {
        user_id: user.id,
        org_id: userData.org_id,
        feature: 'document',
        tokens_input: invoiceResult.usage.input_tokens ?? 0,
        tokens_output: invoiceResult.usage.output_tokens ?? 0,
        tokens_total: (invoiceResult.usage.input_tokens ?? 0) + (invoiceResult.usage.output_tokens ?? 0),
        model: AI_MODEL,
        created_at: nowTs,
      },
      {
        user_id: user.id,
        org_id: userData.org_id,
        feature: 'document',
        tokens_input: contractResult.usage.input_tokens ?? 0,
        tokens_output: contractResult.usage.output_tokens ?? 0,
        tokens_total: (contractResult.usage.input_tokens ?? 0) + (contractResult.usage.output_tokens ?? 0),
        model: AI_MODEL,
        created_at: nowTs,
      },
    ]),
    adminClient.from('agent_actions').insert({
      org_id: userData.org_id,
      bank_id: null,
      action_type: 'contract_drafted',
      entity_type: 'deal',
      entity_id: id,
      reasoning: 'Deal reached agreed status — auto-generating trade documents.',
      input_summary: `Deal ${dealId8}: ${deal.goods_description ?? 'trade goods'}, value ${totalValue} ${deal.agreed_currency ?? 'USD'}`,
      output_summary: 'Generated Purchase Order, Commercial Invoice, and Trade Agreement.',
      outcome: 'success',
      requires_approval: false,
      human_approved: null,
      model: AI_MODEL,
      tokens_used: (poResult.usage.input_tokens ?? 0) + (poResult.usage.output_tokens ?? 0) +
                   (invoiceResult.usage.input_tokens ?? 0) + (invoiceResult.usage.output_tokens ?? 0) +
                   (contractResult.usage.input_tokens ?? 0) + (contractResult.usage.output_tokens ?? 0),
      latency_ms: latencyMs,
      created_at: nowTs,
    }),
  ])

  if (deal.room_id) {
    await adminClient.from('room_messages').insert({
      room_id: deal.room_id,
      content: 'Strike AI has generated your deal documents — Purchase Order, Commercial Invoice, and Trade Agreement. Review them in the Documents section.',
      message_type: 'system',
      status: 'visible',
      created_at: nowTs,
    })
  }

  return NextResponse.json({ po: poText, invoice: invoiceText, contract: contractText })
}
