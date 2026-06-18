import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isListingVisibleToOrg } from '@/lib/networks/visibility'

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

  // Ghost mode check: ghost orgs see nothing
  if (isOrg && me.org_id) {
    const { data: requesterOrg } = await adminClient
      .from('organizations')
      .select('network_visible')
      .eq('id', me.org_id)
      .single()
    if (requesterOrg && requesterOrg.network_visible === false) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Network-only financing request: return 404 if org is not a member
  if (isOrg && me.org_id && request.visibility === 'network_only' && request.network_id) {
    const syntheticListing = { visibility: 'network_only', network_id: request.network_id, org_id: request.requesting_org_id }
    const visible = await isListingVisibleToOrg(adminClient, syntheticListing, me.org_id)
    if (!visible) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

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
    .select('id, buyer_org_id, supplier_org_id, agreed_price, agreed_currency, goods_description, agreed_delivery_date, agreed_incoterms, total_value, listing_id')
    .eq('id', request.deal_id)
    .single()

  let buyer_passport = null
  let supplier_passport = null
  let listingTitle: string | null = null
  let listingDescription: string | null = null

  let lineItems: unknown[] = []

  if (deal) {
    if (deal.listing_id) {
      const [listingRes, lineItemsRes] = await Promise.all([
        adminClient
          .from('marketplace_listings')
          .select('title, description')
          .eq('id', deal.listing_id)
          .maybeSingle(),
        adminClient
          .from('listing_line_items')
          .select('id, name, description, quantity, unit, unit_price, currency, sort_order')
          .eq('listing_id', deal.listing_id)
          .order('sort_order', { ascending: true }),
      ])
      listingTitle = listingRes.data?.title ?? null
      listingDescription = listingRes.data?.description ?? null
      lineItems = lineItemsRes.data ?? []
    }

    const [{ data: buyer }, { data: supplier }] = await Promise.all([
      adminClient.from('organizations')
        .select('id, legal_name, passport_score, risk_tier, kyb_status, avg_payment_days, dispute_rate_network, performance_tier, years_in_operation, annual_revenue_range')
        .eq('id', deal.buyer_org_id)
        .single(),
      adminClient.from('organizations')
        .select('id, legal_name, passport_score, risk_tier, kyb_status, avg_payment_days, dispute_rate_network, performance_tier, years_in_operation, annual_revenue_range')
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

  // Management state (contract, disbursement) — only relevant once a bank's
  // offer has been accepted. Scoped to this financing_request's own transaction
  // so two concurrent requests on the same deal never collide.
  let managementTransaction: any = null
  let requesterBankAccount: any = null
  if (['accepted', 'funded'].includes(request.status)) {
    const { data: txn } = await adminClient
      .from('transactions')
      .select('id, status, bank_id, financing_amount_approved, financing_rate_apr, tenor_days, esign_document_id, bank_signed_at, anchor_signed_at, supplier_signed_at, esign_completed_at, disbursed_at, disbursed_by_user_id, disbursement_reference, supplier_paid_at')
      .eq('financing_request_id', id)
      .maybeSingle()
    managementTransaction = txn ?? null

    // The bank automatically sees the requester's own bank account — no manual entry.
    if (isBank) {
      const { data: acct } = await adminClient
        .from('bank_accounts')
        .select('nickname, bank_name, account_holder_name, account_number, routing_number, swift_iban, account_type')
        .eq('entity_type', 'organization')
        .eq('entity_id', request.requesting_org_id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle()
      requesterBankAccount = acct ?? null
    }
  }

  return NextResponse.json({
    request,
    deal: deal
      ? {
          id:                  deal.id,
          agreed_price:        deal.agreed_price,
          agreed_currency:     deal.agreed_currency,
          goods_description:   deal.goods_description ?? null,
          listing_title:       listingTitle,
          listing_description: listingDescription,
          agreed_delivery_date: deal.agreed_delivery_date,
          agreed_incoterms:    deal.agreed_incoterms,
          total_value:         deal.total_value,
          buyer_org_id:        deal.buyer_org_id,
          supplier_org_id:     deal.supplier_org_id,
          line_items:          lineItems,
        }
      : null,
    buyer_passport,
    supplier_passport,
    offers:            offersForCaller,
    my_offer:          isBank ? my_offer : undefined,
    all_offers_count,
    transaction:           managementTransaction,
    requester_bank_account: requesterBankAccount,
    is_requester:           isOrg && request.requesting_org_id === me.org_id,
  })
}
