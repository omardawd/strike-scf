// G3.2 — Seller marks deal as shipped.
// Transitions: in_preparation → shipped.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealShippedEmailHtml } from '@/lib/email'

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
    .select('id, status, buyer_org_id, supplier_org_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the supplier can mark a deal as shipped' }, { status: 403 })
  }

  if (deal.status !== 'in_preparation') {
    return NextResponse.json({ error: `Cannot mark as shipped at status: ${deal.status}` }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    shipment_tracking_ref,
    shipment_carrier,
    shipment_estimated_delivery,
    commercial_invoice_id,
  } = body as Record<string, string | undefined>

  if (!shipment_tracking_ref || !shipment_carrier) {
    return NextResponse.json({ error: 'Tracking reference and carrier are required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: 'shipped',
    shipment_tracking_ref,
    shipment_carrier,
    shipment_estimated_delivery: shipment_estimated_delivery ?? null,
    shipped_at: now,
    commercial_invoice_id: commercial_invoice_id ?? null,
    commercial_invoice_issued_at: commercial_invoice_id ? now : null,
    updated_at: now,
  }

  const { data: updated, error: updateError } = await adminClient
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (updateError || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'shipped',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: `Order shipped. Tracking: ${shipment_tracking_ref}`,
    metadata: { shipment_tracking_ref, shipment_carrier, shipment_estimated_delivery },
  })

  // Notify buyer
  const [buyerOrgRes, sellerOrgRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('legal_name').eq('id', deal.supplier_org_id).single(),
  ])
  if (buyerOrgRes.data?.primary_contact_email) {
    void sendEmail({
      to: buyerOrgRes.data.primary_contact_email,
      subject: `Your order has been shipped — Deal #${id.slice(0, 8).toUpperCase()}`,
      html: dealShippedEmailHtml({
        sellerName: sellerOrgRes.data?.legal_name ?? 'Seller',
        trackingRef: shipment_tracking_ref,
        estimatedDelivery: shipment_estimated_delivery ?? null,
        dealId: id,
        dealShortId: id.slice(0, 8).toUpperCase(),
      }),
    })
  }

  return NextResponse.json({ deal: updated })
}
