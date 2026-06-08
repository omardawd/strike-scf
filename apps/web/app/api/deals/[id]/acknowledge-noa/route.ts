// G3.3 — Buyer acknowledges the Notice of Assignment for Invoice Factoring.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, noa_acknowledged_at, noa_document_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the buyer can acknowledge the NOA' }, { status: 403 })
  }

  if (!deal.financing_payment_active) {
    return NextResponse.json({ error: 'No active financing on this deal' }, { status: 400 })
  }

  if (deal.noa_acknowledged_at) {
    return NextResponse.json({ error: 'NOA already acknowledged' }, { status: 400 })
  }

  let body: { acknowledged?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.acknowledged) {
    return NextResponse.json({ error: 'acknowledged must be true' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const shortId = id.slice(0, 8).toUpperCase()

  const { data: updated, error } = await adminClient
    .from('deals')
    .update({
      noa_acknowledged_at: now,
      noa_acknowledged_by: userData.id,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'noa_acknowledged',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: 'Buyer acknowledged the Notice of Assignment.',
  }).then(undefined, console.error)

  // Notify supplier and bank
  const [sellerRes, txnRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.supplier_org_id).single(),
    adminClient.from('transactions').select('bank_id').eq('deal_id', id).limit(1).maybeSingle(),
  ])

  if (sellerRes.data?.primary_contact_email) {
    void sendEmail({
      to: sellerRes.data.primary_contact_email,
      subject: `NOA Acknowledged — Deal #${shortId}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a">
        <p>The buyer has acknowledged the Notice of Assignment for Deal #${shortId}. Payment instructions are now unlocked.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${id}">View Deal →</a></p>
      </div>`,
    })
  }

  if (txnRes.data?.bank_id) {
    const { data: bankUsers } = await adminClient
      .from('users')
      .select('id')
      .eq('bank_id', txnRes.data.bank_id)
    if (bankUsers?.length) {
      await adminClient.from('notifications').insert(
        bankUsers.map((u: any) => ({
          user_id: u.id,
          event: 'noa_acknowledged',
          title: `NOA Acknowledged — Deal #${shortId}`,
          body: 'Buyer has acknowledged the Notice of Assignment.',
          deep_link: `/deals/${id}`,
          read: false,
        }))
      ).then(undefined, console.error)
    }
  }

  return NextResponse.json({ deal: updated })
}
