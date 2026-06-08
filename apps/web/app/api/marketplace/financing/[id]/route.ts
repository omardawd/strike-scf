import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const isBank = BANK_ROLES.includes(me.role)
  const isOrg  = ORG_ROLES.includes(me.role)
  if (!isBank && !isOrg) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: request, error: reqError } = await adminClient
    .from('financing_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (reqError || !request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Org: must be party to the deal
  if (isOrg) {
    const { data: deal } = await adminClient
      .from('deals')
      .select('buyer_org_id, supplier_org_id')
      .eq('id', request.deal_id)
      .single()

    if (!deal || (deal.buyer_org_id !== me.org_id && deal.supplier_org_id !== me.org_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Bank: only open requests
  if (isBank && !['open', 'offers_received', 'accepted', 'funded'].includes(request.status)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id, agreed_price, agreed_currency, goods_description, agreed_delivery_date, agreed_incoterms, total_value')
    .eq('id', request.deal_id)
    .single()

  let buyer_passport = null
  let supplier_passport = null

  if (deal) {
    const [{ data: buyer }, { data: supplier }] = await Promise.all([
      adminClient.from('organizations')
        .select('id, legal_name, passport_score, risk_tier, trade_count_total, avg_payment_days, dispute_rate_network')
        .eq('id', deal.buyer_org_id)
        .single(),
      adminClient.from('organizations')
        .select('id, legal_name, passport_score, risk_tier, trade_count_total, avg_payment_days, dispute_rate_network')
        .eq('id', deal.supplier_org_id)
        .single(),
    ])
    buyer_passport    = buyer
    supplier_passport = supplier
  }

  // Fetch offers
  let offersQuery = adminClient
    .from('financing_request_offers')
    .select('*')
    .eq('request_id', id)
    .order('ai_score', { ascending: false, nullsFirst: false })

  const { data: allOffers } = await offersQuery

  let offersForCaller: any[]
  let my_offer: any | null = null

  if (isOrg) {
    // Org sees all offer details
    offersForCaller = allOffers ?? []
    // Enrich with bank names
    const bankIds = [...new Set((allOffers ?? []).map((o: any) => o.bank_id as string))]
    const banksMap: Record<string, any> = {}
    if (bankIds.length > 0) {
      const { data: banks } = await adminClient
        .from('banks')
        .select('id, display_name, legal_name')
        .in('id', bankIds)
      for (const b of banks ?? []) banksMap[b.id] = b
    }
    offersForCaller = (allOffers ?? []).map((o: any) => ({
      ...o,
      bank: banksMap[o.bank_id] ?? null,
    }))
  } else {
    // Bank sees their own offer in full, others as count only
    my_offer = (allOffers ?? []).find((o: any) => o.bank_id === me.bank_id) ?? null
    offersForCaller = my_offer ? [my_offer] : []
  }

  const all_offers_count = (allOffers ?? []).length

  return NextResponse.json({
    request,
    deal: deal
      ? {
          id:                  deal.id,
          agreed_price:        deal.agreed_price,
          agreed_currency:     deal.agreed_currency,
          goods_description:   deal.goods_description,
          agreed_delivery_date: deal.agreed_delivery_date,
          agreed_incoterms:    deal.agreed_incoterms,
          total_value:         deal.total_value,
          buyer_org_id:        deal.buyer_org_id,
          supplier_org_id:     deal.supplier_org_id,
        }
      : null,
    buyer_passport,
    supplier_passport,
    offers:            offersForCaller,
    my_offer:          isBank ? my_offer : undefined,
    all_offers_count,
  })
}
