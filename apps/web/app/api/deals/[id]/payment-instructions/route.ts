// G3.1 — Seller submits payment instructions.
// Transitions deal: agreed → documents_pending (if not already there).
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealPaymentInstructionsEmailHtml } from '@/lib/email'

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

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the supplier can submit payment instructions' }, { status: 403 })
  }

  if (!['agreed', 'documents_pending'].includes(deal.status)) {
    return NextResponse.json({ error: `Cannot set payment instructions at status: ${deal.status}` }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    payment_bank_name,
    payment_account_number,
    payment_routing_number,
    payment_swift_iban,
    payment_account_name,
    payment_reference,
    payment_currency,
  } = body as Record<string, string | undefined>

  if (!payment_bank_name || !payment_account_name) {
    return NextResponse.json({ error: 'Bank name and account name are required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    payment_bank_name,
    payment_account_number: payment_account_number ?? null,
    payment_routing_number: payment_routing_number ?? null,
    payment_swift_iban: payment_swift_iban ?? null,
    payment_account_name,
    payment_reference: payment_reference ?? null,
    payment_currency: payment_currency ?? null,
    payment_instructions_set_at: now,
    payment_instructions_set_by: userData.id,
    updated_at: now,
  }

  // Advance from agreed → documents_pending
  if (deal.status === 'agreed') {
    updates.status = 'documents_pending'
  }

  const { data: updated, error: updateError } = await adminClient
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (updateError || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  // Write deal event
  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'payment_instructions_set',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: 'Payment instructions submitted by seller',
  })

  // Notify buyer
  const [buyerOrgRes, sellerOrgRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('legal_name').eq('id', deal.supplier_org_id).single(),
  ])
  if (buyerOrgRes.data?.primary_contact_email) {
    void sendEmail({
      to: buyerOrgRes.data.primary_contact_email,
      subject: `Payment instructions received for Deal #${id.slice(0, 8).toUpperCase()}`,
      html: dealPaymentInstructionsEmailHtml({
        sellerName: sellerOrgRes.data?.legal_name ?? 'Seller',
        dealId: id,
        dealShortId: id.slice(0, 8).toUpperCase(),
      }),
    })
  }

  return NextResponse.json({ deal: updated })
}
