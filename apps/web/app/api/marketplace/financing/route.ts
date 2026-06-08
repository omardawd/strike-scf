import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'
import type { CreateFinancingRequestPayload } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (BANK_ROLES.includes(me.role)) {
    const { data: rawRequests, error } = await adminClient
      .from('financing_requests')
      .select('*')
      .in('status', ['open', 'offers_received'])
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

    // TD.5 — ghost enforcement: NEVER surface a financing request whose REQUESTOR
    // org is a ghost (network_visible=false) to a bank. Service role bypasses RLS,
    // so this manual filter is required.
    const requestorIds = [...new Set((rawRequests ?? []).map((r: any) => r.requesting_org_id as string).filter(Boolean))]
    const visibleRequestorIds = new Set<string>()
    if (requestorIds.length > 0) {
      const { data: requestorOrgs } = await adminClient
        .from('organizations')
        .select('id, network_visible')
        .in('id', requestorIds)
      for (const o of requestorOrgs ?? []) {
        if (o.network_visible === true) visibleRequestorIds.add(o.id)
      }
    }
    const requests = (rawRequests ?? []).filter((r: any) => visibleRequestorIds.has(r.requesting_org_id))

    const dealIds = [...new Set((requests ?? []).map((r: any) => r.deal_id as string))]
    const dealsMap: Record<string, any> = {}
    const buyerOrgsMap: Record<string, any> = {}
    const supplierOrgsMap: Record<string, any> = {}

    if (dealIds.length > 0) {
      const { data: deals } = await adminClient
        .from('deals')
        .select('id, buyer_org_id, supplier_org_id, agreed_price, agreed_currency, goods_description, agreed_delivery_date, agreed_incoterms, total_value')
        .in('id', dealIds)

      for (const d of deals ?? []) dealsMap[d.id] = d

      const buyerIds   = [...new Set((deals ?? []).map((d: any) => d.buyer_org_id as string))]
      const supplierIds = [...new Set((deals ?? []).map((d: any) => d.supplier_org_id as string))]
      const allOrgIds = [...new Set([...buyerIds, ...supplierIds])]

      if (allOrgIds.length > 0) {
        const { data: orgs } = await adminClient
          .from('organizations')
          .select('id, legal_name, passport_score, risk_tier, trade_count_total, avg_payment_days, dispute_rate_network')
          .in('id', allOrgIds)

        for (const org of orgs ?? []) {
          if (buyerIds.includes(org.id))    buyerOrgsMap[org.id]    = org
          if (supplierIds.includes(org.id)) supplierOrgsMap[org.id] = org
        }
      }
    }

    // Batch fetch bank's own offers
    const requestIds = (requests ?? []).map((r: any) => r.id as string)
    const myOffersMap: Record<string, any> = {}
    const offerCountsMap: Record<string, number> = {}

    if (requestIds.length > 0 && me.bank_id) {
      const { data: myOffers } = await adminClient
        .from('financing_request_offers')
        .select('*')
        .in('request_id', requestIds)
        .eq('bank_id', me.bank_id)

      for (const o of myOffers ?? []) myOffersMap[o.request_id] = o

      const { data: allOffers } = await adminClient
        .from('financing_request_offers')
        .select('request_id')
        .in('request_id', requestIds)

      for (const o of allOffers ?? []) {
        offerCountsMap[o.request_id] = (offerCountsMap[o.request_id] ?? 0) + 1
      }
    }

    const results = (requests ?? []).map((req: any) => {
      const deal = dealsMap[req.deal_id] ?? null
      return {
        request: req,
        deal: deal ? {
          id: deal.id,
          agreed_price: deal.agreed_price,
          agreed_currency: deal.agreed_currency,
          goods_description: deal.goods_description,
          agreed_delivery_date: deal.agreed_delivery_date,
          agreed_incoterms: deal.agreed_incoterms,
        } : null,
        buyer_passport:    deal ? (buyerOrgsMap[deal.buyer_org_id] ?? null) : null,
        supplier_passport: deal ? (supplierOrgsMap[deal.supplier_org_id] ?? null) : null,
        my_offer:          myOffersMap[req.id] ?? null,
        all_offers_count:  offerCountsMap[req.id] ?? 0,
      }
    })

    return NextResponse.json({ requests: results })
  }

  if (ORG_ROLES.includes(me.role)) {
    const { data: requests, error } = await adminClient
      .from('financing_requests')
      .select('*')
      .eq('requesting_org_id', me.org_id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

    const dealIds = (requests ?? []).map((r: any) => r.deal_id as string)
    const dealsMap: Record<string, any> = {}

    if (dealIds.length > 0) {
      const { data: deals } = await adminClient
        .from('deals')
        .select('id, agreed_price, agreed_currency, goods_description, agreed_delivery_date, total_value')
        .in('id', dealIds)
      for (const d of deals ?? []) dealsMap[d.id] = d
    }

    const results = (requests ?? []).map((req: any) => ({
      ...req,
      deal: dealsMap[req.deal_id] ?? null,
    }))

    return NextResponse.json({ requests: results })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!ORG_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Only organization members can request financing' }, { status: 403 })
  }

  let body: CreateFinancingRequestPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.deal_id || !body.structure_type || !body.amount_requested) {
    return NextResponse.json({ error: 'deal_id, structure_type, and amount_requested are required' }, { status: 400 })
  }

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id, status, financing_requested, total_value, agreed_currency, goods_description, agreed_delivery_date')
    .eq('id', body.deal_id)
    .single()

  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  if (deal.financing_requested) {
    return NextResponse.json({ error: 'Financing already requested for this deal' }, { status: 400 })
  }
  if (deal.buyer_org_id !== me.org_id && deal.supplier_org_id !== me.org_id) {
    return NextResponse.json({ error: 'You must be a party to this deal' }, { status: 403 })
  }

  // G3.1 — G3.2: Financing structure gates
  const financingType = body.financing_type ?? null
  const VALID_POST_SHIPMENT = ['shipped', 'delivery_confirmed', 'payment_due', 'payment_overdue']
  const VALID_ALL_STAGES = ['agreed', 'active', 'confirmed', 'in_preparation', ...VALID_POST_SHIPMENT]

  if (!VALID_ALL_STAGES.includes(deal.status)) {
    return NextResponse.json({ error: 'Deal must be active to request financing' }, { status: 400 })
  }

  if (financingType === 'reverse_factoring') {
    if (!VALID_POST_SHIPMENT.includes(deal.status)) {
      return NextResponse.json({
        error: 'Reverse Factoring requires delivery confirmation before financing can be requested.',
        current_status: deal.status,
        required_status: 'delivery_confirmed',
      }, { status: 400 })
    }
  }

  if (financingType === 'po_financing') {
    if (!['confirmed', 'in_preparation'].includes(deal.status)) {
      return NextResponse.json({
        error: 'PO Financing must be requested before shipment. Use Invoice Factoring or Reverse Factoring for post-shipment financing.',
        current_status: deal.status,
      }, { status: 400 })
    }
  }

  const [{ data: buyerOrg }, { data: supplierOrg }] = await Promise.all([
    adminClient.from('organizations').select('id, legal_name, passport_score').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('id, legal_name, passport_score').eq('id', deal.supplier_org_id).single(),
  ])

  const buyerScore    = buyerOrg?.passport_score ?? 'N/A'
  const supplierScore = supplierOrg?.passport_score ?? 'N/A'
  const currency      = body.currency ?? deal.agreed_currency ?? 'USD'
  const tenor         = body.preferred_tenor_days ?? 90

  let ai_market_context: string | null = null
  let ai_risk_assessment: string | null = null

  try {
    const [ctxResult, riskResult] = await Promise.all([
      callClaude({
        system: 'You are Strike AI, the intelligence layer of Strike SCF. You are generating market context for a financing request that will be shown to competing banks.',
        messages: [{
          role: 'user',
          content: `Deal value: ${deal.total_value ?? body.amount_requested} ${currency}. Financing requested: ${body.amount_requested}. Structure preference: ${body.structure_type}. Buyer PassportScore: ${buyerScore}. Supplier PassportScore: ${supplierScore}. Preferred tenor: ${tenor} days. Write 2 sentences: (1) a factual market context statement on typical rates and structures for this trade size, (2) a risk summary based on the PassportScores. Be direct. No fluff.`,
        }],
        max_tokens: 400,
      }),
      callClaude({
        system: 'You are Strike AI, the intelligence layer of Strike SCF.',
        messages: [{
          role: 'user',
          content: `In one sentence, assess the credit risk of financing this trade between a ${buyerScore}-score buyer and ${supplierScore}-score supplier. Reference the PassportScore tiers (green ≥70, amber 45–69, red <45).`,
        }],
        max_tokens: 200,
      }),
    ])

    ai_market_context  = ctxResult.text.trim()
    ai_risk_assessment = riskResult.text.trim()

    await adminClient.from('ai_usage').insert([
      {
        user_id: user.id, org_id: me.org_id, feature: 'insight',
        tokens_input: ctxResult.usage.input_tokens ?? 0,
        tokens_output: ctxResult.usage.output_tokens ?? 0,
        tokens_total: (ctxResult.usage.input_tokens ?? 0) + (ctxResult.usage.output_tokens ?? 0),
        model: AI_MODEL,
      },
      {
        user_id: user.id, org_id: me.org_id, feature: 'insight',
        tokens_input: riskResult.usage.input_tokens ?? 0,
        tokens_output: riskResult.usage.output_tokens ?? 0,
        tokens_total: (riskResult.usage.input_tokens ?? 0) + (riskResult.usage.output_tokens ?? 0),
        model: AI_MODEL,
      },
    ])
  } catch (err) {
    console.error('AI generation failed (non-fatal):', err)
  }

  const { data: financingRequest, error: insertError } = await adminClient
    .from('financing_requests')
    .insert({
      deal_id:              body.deal_id,
      requesting_org_id:   me.org_id,
      structure_type:      body.structure_type,
      financing_type:      body.financing_type ?? null,
      amount_requested:    body.amount_requested,
      preferred_tenor_days: body.preferred_tenor_days ?? null,
      preferred_rate_max:  body.preferred_rate_max ?? null,
      currency,
      custom_terms:        body.custom_terms ?? null,
      status:              'open',
      ai_market_context,
      ai_risk_assessment,
    })
    .select()
    .single()

  if (insertError || !financingRequest) {
    console.error('Financing request insert error:', insertError)
    return NextResponse.json({ error: 'Failed to create financing request' }, { status: 500 })
  }

  await adminClient
    .from('deals')
    .update({
      financing_requested:    true,
      financing_requested_at: new Date().toISOString(),
      financing_request_id:   financingRequest.id,
      status:                 'financing_requested',
    })
    .eq('id', body.deal_id)

  return NextResponse.json({ financing_request: financingRequest }, { status: 201 })
}
