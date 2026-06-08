// G8.1 — Financing request closed without activation.
// Called when the last bank offer is rejected or request is withdrawn.
// If financing_payment_active is false, revert deal to delivery_confirmed and notify both parties.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealFinancingRejectedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  const { data: fr } = await adminClient
    .from('financing_requests')
    .select('id, status, deal_id, currency, amount_requested')
    .eq('id', id)
    .single()
  if (!fr) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, payment_due_date, agreed_currency')
    .eq('id', fr.deal_id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  if (!isParty) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // G8.1: Only act if financing was never activated
  if (deal.financing_payment_active) {
    return NextResponse.json({ error: 'Financing is already active — cannot withdraw' }, { status: 400 })
  }

  if (!['open', 'offers_received'].includes(fr.status)) {
    return NextResponse.json({ error: 'Financing request is not in a state that can be closed' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Close the financing request
  await adminClient
    .from('financing_requests')
    .update({ status: 'closed', updated_at: now })
    .eq('id', id)

  // Revert deal to delivery_confirmed (removes financing_requested flag implicitly)
  const { data: updatedDeal, error: dealErr } = await adminClient
    .from('deals')
    .update({
      status: 'delivery_confirmed',
      financing_payment_active: false,
      updated_at: now,
    })
    .eq('id', fr.deal_id)
    .select()
    .single()
  if (dealErr) {
    console.error('[financing/reject] deal update failed:', dealErr)
  }

  await adminClient.from('deal_events').insert({
    deal_id: fr.deal_id,
    event_type: 'financing_rejected',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: 'Financing request closed without activation. Deal reverted to delivery_confirmed.',
  })

  // Notify both parties
  const [buyerRes, sellerRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.supplier_org_id).single(),
  ])

  const shortId = fr.deal_id.slice(0, 8).toUpperCase()
  const subject = `Financing not activated — Deal #${shortId} reverted`

  for (const [orgRes, role] of [[buyerRes, 'buyer'], [sellerRes, 'supplier']] as const) {
    if (orgRes.data?.primary_contact_email) {
      void sendEmail({
        to: orgRes.data.primary_contact_email,
        subject,
        html: dealFinancingRejectedEmailHtml({
          recipientName: orgRes.data.legal_name ?? role,
          sellerName: sellerRes.data?.legal_name ?? 'Seller',
          dealId: fr.deal_id,
          dealShortId: shortId,
          dueDate: deal.payment_due_date ?? null,
        }),
      })
    }
  }

  return NextResponse.json({ deal: updatedDeal ?? null, financing_request_id: id })
}
