// Contract management for deal procurement v2.
// POST /api/deals/[id]/contract — buyer submits contract (upload or AI-generated)
// PATCH /api/deals/[id]/contract — supplier signs contract
// POST with action=bank — bank submits financing contract
// PATCH with action=bank_sign — party signs bank contract
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude } from '@/lib/ai'
import { calcProcurementFees, calcBuyerTotalDue } from '@/lib/deals/fees'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function resolveActor(userId: string) {
  const { data } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', userId)
    .single()
  return data
}

// ── POST: buyer submits contract (or bank submits financing contract) ──────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient.from('deals').select('*').eq('id', id).single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const body = await req.json()
  const { action, generate, contract_document_id, content } = body

  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(actor.role)

  // ── Bank financing contract ─────────────────────────────────────────────────
  if (action === 'bank' || isBankUser) {
    if (!isBankUser) return NextResponse.json({ error: 'Only bank users can submit financing contracts' }, { status: 403 })
    if (!deal.financing_payment_active) {
      return NextResponse.json({ error: 'No active financing on this deal' }, { status: 400 })
    }

    let docId = contract_document_id ?? null
    let generatedContent: string | null = null

    if (generate) {
      // AI-generate the bank financing contract
      const [buyerRes, supplierRes] = await Promise.all([
        adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
        adminClient.from('organizations').select('legal_name').eq('id', deal.supplier_org_id).single(),
      ])
      const { data: bank } = await adminClient.from('banks').select('display_name, legal_name').eq('id', actor.bank_id).single()
      const totalValue = deal.total_value ?? deal.agreed_price ?? 0
      const currency = deal.agreed_currency ?? 'USD'
      const shortId = id.slice(0, 8).toUpperCase()
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      const result = await callClaude({
        system: 'You are a trade finance legal drafting assistant. Generate a concise, professional financing contract. Use plain English with standard legal formatting.',
        messages: [{
          role: 'user',
          content: `Generate a financing agreement for Deal #${shortId} dated ${today}.
Bank: ${bank?.display_name ?? bank?.legal_name ?? 'Bank'}
Buyer: ${buyerRes.data?.legal_name ?? 'Buyer'}
Supplier: ${supplierRes.data?.legal_name ?? 'Supplier'}
Deal value: ${currency} ${totalValue}
Financing structure: ${deal.financing_type ?? 'Supply Chain Finance'}

Include: parties, financing terms, obligations, payment routing, governing law. Keep under 800 words.`,
        }],
        max_tokens: 2048,
        model: 'claude-sonnet-4-6',
      })
      generatedContent = result.text

      const bankStoragePath = `deals/${id}/bank_contract.txt`
      const bankFileBytes = Buffer.from(generatedContent, 'utf-8')
      await adminClient.storage.from('deal-documents').upload(bankStoragePath, bankFileBytes, {
        contentType: 'text/plain',
        upsert: true,
      })

      const { data: doc } = await adminClient.from('documents').insert({
        name: `Financing Agreement - Deal #${shortId}`,
        storage_path: bankStoragePath,
        mime_type: 'text/plain',
        file_size_bytes: bankFileBytes.length,
        entity_type: 'deal',
        entity_id: id,
        document_kind: 'bank_contract',
      }).select().single()
      if (doc) docId = doc.id
    }

    await adminClient.from('deals').update({
      bank_contract_document_id: docId,
      bank_contract_submitted_at: new Date().toISOString(),
      bank_contract_submitted_by: user.id,
    }).eq('id', id)

    await adminClient.from('deal_events').insert({
      deal_id: id, event_type: 'bank_contract_submitted',
      actor_user_id: user.id, actor_org_id: null,
      description: 'Bank submitted financing contract for signature.',
    })

    return NextResponse.json({ success: true, generated_content: generatedContent })
  }

  // ── Buyer submits trade contract ────────────────────────────────────────────
  const isBuyer = deal.buyer_org_id === actor.org_id
  if (!isBuyer) return NextResponse.json({ error: 'Only the buyer can submit the contract' }, { status: 403 })
  if (deal.status !== 'agreed') return NextResponse.json({ error: 'Contract can only be submitted when deal is in agreed state' }, { status: 400 })

  const { preview } = body  // preview=true: generate + store draft without advancing status

  let docId = contract_document_id ?? null
  let generatedContent: string | null = null

  if (generate || preview) {
    // AI-generate the trade contract text
    const [buyerRes, supplierRes] = await Promise.all([
      adminClient.from('organizations').select('legal_name, doing_business_as, city, country_of_origin').eq('id', deal.buyer_org_id).single(),
      adminClient.from('organizations').select('legal_name, doing_business_as, city, country_of_origin').eq('id', deal.supplier_org_id).single(),
    ])
    const totalValue = deal.total_value ?? deal.agreed_price ?? 0
    const currency = deal.agreed_currency ?? 'USD'
    const shortId = id.slice(0, 8).toUpperCase()
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const buyerName = buyerRes.data?.doing_business_as || buyerRes.data?.legal_name || 'Buyer'
    const supplierName = supplierRes.data?.doing_business_as || supplierRes.data?.legal_name || 'Supplier'

    const result = await callClaude({
      system: 'You are a trade contract drafting assistant. Generate concise, professional commercial contracts. Use plain English with standard legal section headers in ALL CAPS followed by a colon. No asterisks, no markdown. End with typed signature lines.',
      messages: [{
        role: 'user',
        content: `Generate a commercial trade agreement for Deal #${shortId} dated ${today}.

BUYER: ${buyerName}${buyerRes.data?.city ? ` (${buyerRes.data.city}${buyerRes.data.country_of_origin ? ', ' + buyerRes.data.country_of_origin : ''})` : ''}
SELLER / SUPPLIER: ${supplierName}${supplierRes.data?.city ? ` (${supplierRes.data.city}${supplierRes.data.country_of_origin ? ', ' + supplierRes.data.country_of_origin : ''})` : ''}
DEAL VALUE: ${currency} ${new Intl.NumberFormat('en-US').format(totalValue)}
GOODS: ${deal.goods_description ?? 'As specified in the Purchase Order'}
PAYMENT TERMS: ${deal.agreed_payment_terms ?? 'Net 30'}
INCOTERMS: ${deal.agreed_incoterms ?? 'DAP'}
DELIVERY DATE: ${deal.agreed_delivery_date ?? 'As agreed'}
${deal.delivery_location ? `DELIVERY LOCATION: ${deal.delivery_location}` : ''}
${content ? `ADDITIONAL CONTEXT: ${content}` : ''}

Sections to include: PARTIES, GOODS AND SERVICES, PURCHASE PRICE AND PAYMENT, DELIVERY AND RISK, TITLE AND OWNERSHIP, WARRANTIES, DEFAULT AND REMEDIES, DISPUTE RESOLUTION, GOVERNING LAW. Keep under 900 words. End with two typed-signature blocks (Buyer / Seller).`,
      }],
      max_tokens: 2048,
      model: 'claude-sonnet-4-6',
    })
    generatedContent = result.text

    // Store text in deal-documents bucket
    const storagePath = `deals/${id}/contract.txt`
    const fileBytes = Buffer.from(generatedContent, 'utf-8')
    await adminClient.storage.from('deal-documents').upload(storagePath, fileBytes, {
      contentType: 'text/plain',
      upsert: true,
    })

    const { data: doc } = await adminClient.from('documents').insert({
      name: `Trade Agreement - Deal #${shortId}`,
      storage_path: storagePath,
      mime_type: 'text/plain',
      file_size_bytes: fileBytes.length,
      entity_type: 'deal',
      entity_id: id,
      document_kind: 'trade_contract',
    }).select().single()
    if (doc) docId = doc.id

    // preview-only: store the draft but do NOT advance status — let the buyer review first
    if (preview) {
      return NextResponse.json({ document_id: docId, content: generatedContent })
    }
  }

  if (!docId && !generatedContent) {
    return NextResponse.json({ error: 'Provide contract_document_id or set generate=true' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Update deal + transition to contract_pending
  await adminClient.from('deals').update({
    status: 'contract_pending',
    contract_document_id: docId,
    contract_generated_at: (generate || preview) ? now : null,
    contract_submitted_at: now,
    contract_submitted_by: user.id,
  }).eq('id', id)

  // Notify supplier
  const { data: supplierUsers } = await adminClient.from('users').select('id').eq('org_id', deal.supplier_org_id)
  if (supplierUsers?.length) {
    await adminClient.from('notifications').insert(
      supplierUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'contract_submitted',
        title: `Contract ready for signature — Deal #${id.slice(0, 8).toUpperCase()}`,
        body: 'The buyer has submitted the trade contract. Please review and sign.',
        deep_link: `/deals/${id}`, read: false,
      }))
    )
  }

  await adminClient.from('deal_events').insert({
    deal_id: id, event_type: 'contract_submitted',
    actor_user_id: user.id, actor_org_id: actor.org_id,
    description: `Buyer submitted ${generate ? 'AI-generated' : 'uploaded'} contract for supplier signature.`,
  })

  return NextResponse.json({ success: true, generated_content: generatedContent })
}

// ── PATCH: supplier signs contract (or party signs bank contract) ──────────────
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient.from('deals').select('*').eq('id', id).single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const body = await req.json()
  const { action, signature, bank_account_id } = body

  if (!signature?.trim()) return NextResponse.json({ error: 'Signature is required' }, { status: 400 })

  // ── Bank contract signing ───────────────────────────────────────────────────
  if (action === 'bank_sign') {
    const isParty = deal.buyer_org_id === actor.org_id || deal.supplier_org_id === actor.org_id
    if (!isParty) return NextResponse.json({ error: 'Only deal parties can sign the bank contract' }, { status: 403 })
    if (!deal.bank_contract_document_id) return NextResponse.json({ error: 'No bank contract to sign' }, { status: 400 })

    await adminClient.from('deals').update({
      bank_contract_signature: signature.trim(),
      bank_contract_signed_by: user.id,
      bank_contract_signed_at: new Date().toISOString(),
    }).eq('id', id)

    // Notify bank users
    const { data: txn } = await adminClient.from('transactions').select('bank_id').eq('deal_id', id).limit(1).maybeSingle()
    if (txn?.bank_id) {
      const { data: bankUsers } = await adminClient.from('users').select('id').eq('bank_id', txn.bank_id)
      if (bankUsers?.length) {
        await adminClient.from('notifications').insert(
          bankUsers.map((u: { id: string }) => ({
            user_id: u.id, event: 'bank_contract_signed',
            title: `Financing contract signed — Deal #${id.slice(0,8).toUpperCase()}`,
            body: 'A party has signed the financing agreement.',
            deep_link: `/deals/${id}`, read: false,
          }))
        )
      }
    }

    await adminClient.from('deal_events').insert({
      deal_id: id, event_type: 'bank_contract_signed',
      actor_user_id: user.id, actor_org_id: actor.org_id,
      description: 'Financing contract signed.',
    })

    return NextResponse.json({ success: true })
  }

  // ── Trade contract signing by supplier ─────────────────────────────────────
  const isSupplier = deal.supplier_org_id === actor.org_id
  if (!isSupplier) return NextResponse.json({ error: 'Only the supplier can sign the contract' }, { status: 403 })
  if (deal.status !== 'contract_pending') return NextResponse.json({ error: 'No contract pending signature' }, { status: 400 })

  const now = new Date().toISOString()

  // Sign and advance to confirmed
  await adminClient.from('deals').update({
    status: 'confirmed',
    contract_supplier_signature: signature.trim(),
    contract_supplier_signed_at: now,
    ...(bank_account_id ? { receiving_bank_account_id: bank_account_id } : {}),
  }).eq('id', id)

  // Auto-trigger AI invoice generation
  try {
    const [buyerRes, supplierRes] = await Promise.all([
      adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
      adminClient.from('organizations').select('legal_name').eq('id', deal.supplier_org_id).single(),
    ])
    const shortId = id.slice(0, 8).toUpperCase()
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const goodsValue = deal.total_value ?? deal.agreed_price ?? 0
    const currency = deal.agreed_currency ?? 'USD'
    const shippingCost: number | null = deal.shipping_cost ?? null
    const { buyerFee } = calcProcurementFees(goodsValue)
    const buyerTotalDue = calcBuyerTotalDue(goodsValue, shippingCost, buyerFee) ?? goodsValue

    const invoiceResult = await callClaude({
      system: 'You are a trade document assistant. Generate professional commercial invoices.',
      messages: [{
        role: 'user',
        content: `Generate a commercial invoice for Deal #${shortId} dated ${today}.
Seller: ${supplierRes.data?.legal_name ?? 'Supplier'}
Buyer: ${buyerRes.data?.legal_name ?? 'Buyer'}
Goods value: ${currency} ${goodsValue}
${shippingCost != null ? `Shipping cost: ${currency} ${shippingCost}\n` : ''}Strike Service Fee (0.3%): ${currency} ${buyerFee?.toFixed(2) ?? '0.00'}
Invoice amount (total payable by buyer): ${currency} ${buyerTotalDue.toFixed(2)}
Payment terms: ${deal.agreed_payment_terms ?? 'Net 30'}

Include: invoice number (INV-${shortId}), date, seller/buyer details, line items from deal, an itemized breakdown of goods value / shipping cost (if any) / Strike Service Fee, the total payable, payment instructions placeholder. Professional format.`,
      }],
      max_tokens: 800,
    })

    const invoiceContent = invoiceResult.text
    const { data: invoiceDoc } = await adminClient.from('documents').insert({
      name: `Commercial Invoice - Deal #${shortId}`,
      storage_path: `deals/${id}/invoice.txt`,
      mime_type: 'text/plain',
      file_size_bytes: invoiceContent.length,
      entity_type: 'deal',
      entity_id: id,
      document_kind: 'commercial_invoice',
    }).select().single()

    if (invoiceDoc) {
      await adminClient.from('deals').update({
        deal_invoice_document_id: invoiceDoc.id,
        deal_invoice_generated_at: now,
        deal_invoice_number: `INV-${shortId}`,
      }).eq('id', id)
    }
  } catch {
    // Invoice generation failure is non-fatal
  }

  // Notify buyer
  const { data: buyerUsers } = await adminClient.from('users').select('id').eq('org_id', deal.buyer_org_id)
  if (buyerUsers?.length) {
    await adminClient.from('notifications').insert(
      buyerUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'contract_signed',
        title: `Contract signed — Deal #${id.slice(0,8).toUpperCase()} is now in business`,
        body: 'The supplier has signed the contract. The deal is now active.',
        deep_link: `/deals/${id}`, read: false,
      }))
    )
  }

  await adminClient.from('deal_events').insert({
    deal_id: id, event_type: 'contract_signed',
    actor_user_id: user.id, actor_org_id: actor.org_id,
    description: `Supplier signed contract. Deal advanced to confirmed. Invoice auto-generated.`,
  })

  return NextResponse.json({ success: true })
}

// ── GET: fetch contract content (for display in deal page) ────────────────────
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('buyer_org_id, supplier_org_id, contract_document_id, contract_generated_at, contract_submitted_at, contract_supplier_signature, contract_supplier_signed_at, bank_contract_document_id, bank_contract_submitted_at, bank_contract_signature, bank_contract_signed_at, deal_invoice_document_id, deal_invoice_number, deal_invoice_generated_at, receiving_bank_account_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(actor.role)
  const isParty = deal.buyer_org_id === actor.org_id || deal.supplier_org_id === actor.org_id
  if (!isParty && !isBankUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch receiving bank account (visible to all parties once deal is in business)
  let receivingBankAccount = null
  if (deal.receiving_bank_account_id) {
    const { data: acct } = await adminClient
      .from('bank_accounts')
      .select('id, nickname, bank_name, account_holder_name, account_number, swift_iban, routing_number, account_type')
      .eq('id', deal.receiving_bank_account_id)
      .single()
    if (acct) receivingBankAccount = acct
  }

  return NextResponse.json({
    contract: {
      document_id: deal.contract_document_id,
      generated_at: deal.contract_generated_at,
      submitted_at: deal.contract_submitted_at,
      supplier_signature: deal.contract_supplier_signature,
      supplier_signed_at: deal.contract_supplier_signed_at,
    },
    bank_contract: {
      document_id: deal.bank_contract_document_id,
      submitted_at: deal.bank_contract_submitted_at,
      signature: deal.bank_contract_signature,
      signed_at: deal.bank_contract_signed_at,
    },
    invoice: {
      document_id: deal.deal_invoice_document_id,
      number: deal.deal_invoice_number,
      generated_at: deal.deal_invoice_generated_at,
    },
    receiving_bank_account: receivingBankAccount,
  })
}
