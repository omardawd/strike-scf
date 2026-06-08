// G3.3 — Buyer confirms delivery or raises dispute.
// action=confirm → shipped → delivery_confirmed
// action=dispute → shipped → in_dispute
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealDeliveryConfirmedEmailHtml, dealDisputeRaisedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VALID_DISPUTE_CATEGORIES = [
  'non_delivery', 'wrong_goods', 'quality_issue',
  'payment_dispute', 'document_dispute', 'other',
]

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

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id, agreed_payment_terms, agreed_delivery_date')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the buyer can confirm delivery or raise a dispute' }, { status: 403 })
  }

  if (deal.status !== 'shipped') {
    return NextResponse.json({ error: `Cannot confirm delivery at status: ${deal.status}` }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, dispute_category, dispute_reason } = body as {
    action: 'confirm' | 'dispute'
    dispute_category?: string
    dispute_reason?: string
  }

  if (!action || !['confirm', 'dispute'].includes(action)) {
    return NextResponse.json({ error: 'action must be confirm or dispute' }, { status: 400 })
  }

  const now = new Date().toISOString()

  if (action === 'confirm') {
    // Calculate payment due date from agreed_payment_terms (e.g. "Net 30")
    let paymentDueDate: string | null = null
    const netMatch = String(deal.agreed_payment_terms ?? '').match(/net\s*(\d+)/i)
    if (netMatch?.[1]) {
      const daysOut = parseInt(netMatch[1], 10)
      const due = new Date()
      due.setDate(due.getDate() + daysOut)
      paymentDueDate = due.toISOString().split('T')[0] ?? null
    }

    const { data: updated, error } = await adminClient
      .from('deals')
      .update({
        status: 'delivery_confirmed',
        payment_due_date: paymentDueDate,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()
    if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'delivery_confirmed',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: 'Buyer confirmed receipt of goods',
    })

    const [sellerOrgRes, buyerOrgRes] = await Promise.all([
      adminClient.from('organizations').select('primary_contact_email').eq('id', deal.supplier_org_id).single(),
      adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
    ])
    if (sellerOrgRes.data?.primary_contact_email) {
      void sendEmail({
        to: sellerOrgRes.data.primary_contact_email,
        subject: `Delivery confirmed — Deal #${id.slice(0, 8).toUpperCase()}`,
        html: dealDeliveryConfirmedEmailHtml({
          buyerName: buyerOrgRes.data?.legal_name ?? 'Buyer',
          dealId: id,
          dealShortId: id.slice(0, 8).toUpperCase(),
        }),
      })
    }

    return NextResponse.json({ deal: updated })
  }

  // action === 'dispute'
  if (!dispute_category || !VALID_DISPUTE_CATEGORIES.includes(dispute_category)) {
    return NextResponse.json({ error: `dispute_category must be one of: ${VALID_DISPUTE_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  if (!dispute_reason) {
    return NextResponse.json({ error: 'dispute_reason is required' }, { status: 400 })
  }

  const { data: updated, error } = await adminClient
    .from('deals')
    .update({
      status: 'in_dispute',
      disputed_at: now,
      disputed_by: userData.id,
      dispute_category,
      dispute_reason,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'dispute_raised',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: `Dispute raised: ${dispute_category}`,
    metadata: { dispute_category, dispute_reason },
  })

  // Notify both parties and Strike Admin
  const [sellerOrgRes, buyerOrgRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email').eq('id', deal.supplier_org_id).single(),
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
  ])
  const disputeHtml = dealDisputeRaisedEmailHtml({
    raisingPartyName: buyerOrgRes.data?.legal_name ?? 'Buyer',
    category: dispute_category,
    dealId: id,
    dealShortId: id.slice(0, 8).toUpperCase(),
  })
  const subject = `Dispute raised on Deal #${id.slice(0, 8).toUpperCase()}`
  if (sellerOrgRes.data?.primary_contact_email) {
    void sendEmail({ to: sellerOrgRes.data.primary_contact_email, subject, html: disputeHtml })
  }
  if (buyerOrgRes.data?.primary_contact_email) {
    void sendEmail({ to: buyerOrgRes.data.primary_contact_email, subject, html: disputeHtml })
  }

  // Notify Strike Admin
  const { data: adminUsers } = await adminClient
    .from('users')
    .select('email')
    .eq('role', 'strike_admin')
    .limit(5)
  for (const adminUser of adminUsers ?? []) {
    void sendEmail({ to: adminUser.email, subject: `[ADMIN] ${subject}`, html: disputeHtml })
  }

  return NextResponse.json({ deal: updated })
}
