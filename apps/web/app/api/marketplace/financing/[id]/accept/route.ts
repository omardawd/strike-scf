import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ORG_ROLES = ['org_admin', 'org_member']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requestId } = await params

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
    return NextResponse.json({ error: 'Only organization members can accept financing offers' }, { status: 403 })
  }

  let body: { offer_id: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.offer_id) {
    return NextResponse.json({ error: 'offer_id is required' }, { status: 400 })
  }

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('*')
    .eq('id', requestId)
    .eq('requesting_org_id', me.org_id)
    .single()

  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })

  const { data: offer } = await adminClient
    .from('financing_request_offers')
    .select('*')
    .eq('id', body.offer_id)
    .eq('request_id', requestId)
    .single()

  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  if (offer.status !== 'pending') {
    return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 400 })
  }

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id, total_value, agreed_currency')
    .eq('id', financingReq.deal_id)
    .single()

  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 500 })

  // TC.4 — program linkage. Prefer the program the bank explicitly selected when
  // submitting the offer; fall back to auto-matching by financing type + currency.
  let matchedProgramId: string | null = (offer as any).program_id ?? null
  if (!matchedProgramId) {
    try {
      const offerCurrency = financingReq.currency ?? deal.agreed_currency ?? 'USD'
      const { data: bankPrograms } = await adminClient
        .from('programs')
        .select('id, financing_types, currency, status, created_at')
        .eq('bank_id', offer.bank_id)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })

      const match = (bankPrograms ?? []).find((p: any) =>
        Array.isArray(p.financing_types) &&
        p.financing_types.includes(offer.structure_type) &&
        (p.currency ?? 'USD') === offerCurrency
      )
      matchedProgramId = match?.id ?? null
    } catch (err) {
      console.error('Program match lookup failed (non-fatal):', err)
    }
  }

  // Accept the offer, reject all others
  await adminClient
    .from('financing_request_offers')
    .update({ status: 'accepted' })
    .eq('id', body.offer_id)

  await adminClient
    .from('financing_request_offers')
    .update({ status: 'rejected' })
    .eq('request_id', requestId)
    .neq('id', body.offer_id)

  const now = new Date().toISOString()

  // Update financing request
  await adminClient
    .from('financing_requests')
    .update({
      status:            'accepted',
      accepted_offer_id: body.offer_id,
      accepted_bank_id:  offer.bank_id,
      accepted_at:       now,
    })
    .eq('id', requestId)

  // Create a transaction row linking to SCF engine
  let transaction: any = null
  try {
    const { data: txn } = await adminClient
      .from('transactions')
      .insert({
        bank_id:                    offer.bank_id,
        program_id:                 matchedProgramId,
        deal_id:                    deal.id,
        anchor_id:                  deal.buyer_org_id,
        supplier_id:                deal.supplier_org_id,
        source:                     'marketplace',
        type:                       offer.structure_type,
        financing_amount_requested: financingReq.amount_requested,
        financing_amount_approved:  offer.offered_amount,
        financing_rate_apr:         offer.offered_rate_apr,
        tenor_days:                 offer.offered_tenor_days,
        status:                     'financing_approved',
        invoice_amount:             deal.total_value,
      })
      .select()
      .single()
    transaction = txn
  } catch (err) {
    console.error('Transaction creation failed (non-fatal):', err)
  }

  // Update deal status
  await adminClient
    .from('deals')
    .update({ status: 'financing_active' })
    .eq('id', financingReq.deal_id)

  // Notify the accepted bank
  try {
    const { data: bankUsers } = await adminClient
      .from('users')
      .select('id')
      .eq('bank_id', offer.bank_id)

    if (bankUsers && bankUsers.length > 0) {
      await adminClient.from('notifications').insert(
        bankUsers.map((u: any) => ({
          user_id:   u.id,
          event:     'financing_offer_accepted',
          title:     'Financing Offer Accepted',
          body:      `Your financing offer of ${offer.offered_amount} ${financingReq.currency} at ${offer.offered_rate_apr}% APR has been accepted.`,
          deep_link: `/marketplace/financing/${requestId}`,
          read:      false,
        }))
      )
    }

    // Notify rejected banks
    const { data: rejectedOffers } = await adminClient
      .from('financing_request_offers')
      .select('bank_id')
      .eq('request_id', requestId)
      .neq('id', body.offer_id)

    const rejectedBankIds = [...new Set((rejectedOffers ?? []).map((o: any) => o.bank_id as string))]

    if (rejectedBankIds.length > 0) {
      const { data: rejectedUsers } = await adminClient
        .from('users')
        .select('id')
        .in('bank_id', rejectedBankIds)

      if (rejectedUsers && rejectedUsers.length > 0) {
        await adminClient.from('notifications').insert(
          rejectedUsers.map((u: any) => ({
            user_id:   u.id,
            event:     'financing_offer_rejected',
            title:     'Financing Offer Not Selected',
            body:      'The borrower has selected another financing offer for this request.',
            deep_link: `/marketplace/financing/${requestId}`,
            read:      false,
          }))
        )
      }
    }
  } catch (err) {
    console.error('Notifications failed (non-fatal):', err)
  }

  const updatedRequest = { ...financingReq, status: 'accepted', accepted_offer_id: body.offer_id, accepted_bank_id: offer.bank_id, accepted_at: now }

  return NextResponse.json({ request: updatedRequest, transaction })
}
