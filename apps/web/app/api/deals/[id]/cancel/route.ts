// G5 — Cancellation with strict status/role rules enforced server-side.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G5.1 — cancellation rules
const CANCELLABLE_STATUSES = ['negotiating', 'agreed', 'documents_pending', 'confirmed', 'in_preparation', 'active', 'goods_received', 'payment_info_sent']
const REASON_REQUIRED_STATUSES = ['in_preparation', 'goods_received', 'payment_info_sent']
const BLOCKED_STATUSES = ['shipped', 'delivery_confirmed', 'payment_due', 'payment_overdue', 'payment_confirmed', 'completed', 'cancelled', 'in_dispute', 'disputed']

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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, financing_request_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Financing active: no cancellation allowed
  if (deal.financing_payment_active) {
    return NextResponse.json({
      error: 'Cancellation is not permitted after financing has been activated on this deal. A bank obligation exists.',
    }, { status: 400 })
  }

  if (BLOCKED_STATUSES.includes(deal.status)) {
    return NextResponse.json({
      error: `Cancellation is not permitted at status: ${deal.status}. Use the dispute flow instead.`,
    }, { status: 400 })
  }

  if (!CANCELLABLE_STATUSES.includes(deal.status)) {
    return NextResponse.json({ error: `Cannot cancel deal at status: ${deal.status}` }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { cancellation_reason, confirmed } = body as { cancellation_reason?: string; confirmed?: boolean }

  if (!confirmed) {
    return NextResponse.json({ error: 'confirmed must be true to cancel a deal' }, { status: 400 })
  }

  if (REASON_REQUIRED_STATUSES.includes(deal.status) && !cancellation_reason) {
    return NextResponse.json({ error: 'cancellation_reason is required at this stage' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data: updated, error } = await adminClient
    .from('deals')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: userData.id,
      cancellation_reason: cancellation_reason ?? null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'cancelled',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: cancellation_reason ? `Deal cancelled. Reason: ${cancellation_reason}` : 'Deal cancelled.',
  })

  // If a pending financing request exists, cancel it
  if (deal.financing_request_id) {
    const { data: fr } = await adminClient
      .from('financing_requests')
      .select('id, status')
      .eq('id', deal.financing_request_id)
      .single()
    if (fr && ['open', 'offers_received'].includes(fr.status)) {
      await adminClient.from('financing_requests').update({ status: 'cancelled', updated_at: now }).eq('id', fr.id)
    }
  }

  // Notify counterparty
  const cancellingOrgId = userData.org_id
  const counterpartyOrgId = deal.buyer_org_id === cancellingOrgId ? deal.supplier_org_id : deal.buyer_org_id
  const [counterpartyRes, actorOrgRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email').eq('id', counterpartyOrgId).single(),
    adminClient.from('organizations').select('legal_name').eq('id', cancellingOrgId).single(),
  ])
  const shortId = id.slice(0, 8).toUpperCase()
  if (counterpartyRes.data?.primary_contact_email) {
    void sendEmail({
      to: counterpartyRes.data.primary_contact_email,
      subject: `Deal #${shortId} has been cancelled`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;color:#0f172a;">
        <div style="font-size:20px;font-weight:700;color:#1428CC;margin-bottom:24px;">Strike SCF</div>
        <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Deal #${shortId} cancelled</h2>
        <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 16px;"><strong>${actorOrgRes.data?.legal_name ?? 'Your counterparty'}</strong> has cancelled Deal #${shortId}.${cancellation_reason ? ` Reason: ${cancellation_reason}` : ''}</p>
      </div>`,
    })
  }

  return NextResponse.json({ deal: updated })
}
