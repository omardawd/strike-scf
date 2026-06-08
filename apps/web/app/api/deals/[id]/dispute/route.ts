// G6 — Dispute management: evidence submission (both parties) and admin resolution.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealDisputeResolvedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VALID_RESOLUTIONS = ['buyer_favor', 'seller_favor', 'mutual_settlement', 'escalated']

// POST — submit evidence or resolve dispute (admin only)
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

  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  const isAdmin = userData.role === 'strike_admin'
  if (!isParty && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action } = body as { action: 'submit_evidence' | 'resolve' }

  if (action === 'submit_evidence') {
    if (!['in_dispute', 'disputed'].includes(deal.status)) {
      return NextResponse.json({ error: 'Deal is not in dispute' }, { status: 400 })
    }
    if (!isParty) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { statement, document_id } = body as { statement?: string; document_id?: string }

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'evidence_submitted',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: statement ? `Evidence submitted: ${statement.slice(0, 200)}` : 'Evidence document submitted',
      metadata: { document_id: document_id ?? null },
    })

    // Notify counterparty
    const counterpartyOrgId = deal.buyer_org_id === userData.org_id ? deal.supplier_org_id : deal.buyer_org_id
    const [cpRes, actorRes] = await Promise.all([
      adminClient.from('organizations').select('primary_contact_email').eq('id', counterpartyOrgId).single(),
      adminClient.from('organizations').select('legal_name').eq('id', userData.org_id!).single(),
    ])
    if (cpRes.data?.primary_contact_email) {
      void sendEmail({
        to: cpRes.data.primary_contact_email,
        subject: `Evidence submitted on Deal #${id.slice(0, 8).toUpperCase()}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;color:#0f172a;">
          <div style="font-size:20px;font-weight:700;color:#1428CC;margin-bottom:24px;">Strike SCF</div>
          <h2>Evidence submitted on disputed deal #${id.slice(0, 8).toUpperCase()}</h2>
          <p style="color:#64748b;font-size:14px;line-height:1.7;"><strong>${actorRes.data?.legal_name ?? 'Counterparty'}</strong> has submitted evidence. Log in to view.</p>
        </div>`,
      })
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'resolve') {
    if (!isAdmin) return NextResponse.json({ error: 'Only Strike Admin can resolve disputes' }, { status: 403 })
    if (!['in_dispute', 'disputed'].includes(deal.status)) {
      return NextResponse.json({ error: 'Deal is not in dispute' }, { status: 400 })
    }

    const { resolution, resolution_notes } = body as { resolution: string; resolution_notes?: string }
    if (!resolution || !VALID_RESOLUTIONS.includes(resolution)) {
      return NextResponse.json({ error: `resolution must be one of: ${VALID_RESOLUTIONS.join(', ')}` }, { status: 400 })
    }

    const now = new Date().toISOString()
    let newStatus = 'in_dispute'
    if (resolution === 'buyer_favor') newStatus = 'cancelled'
    else if (resolution === 'seller_favor') newStatus = 'delivery_confirmed'
    else if (resolution === 'mutual_settlement') newStatus = 'completed'

    const { data: updated, error } = await adminClient
      .from('deals')
      .update({
        status: newStatus,
        dispute_resolved_at: now,
        dispute_resolved_by: userData.id,
        dispute_resolution: resolution,
        ...(newStatus === 'completed' ? { completed_at: now } : {}),
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()
    if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'dispute_resolved',
      actor_user_id: userData.id,
      description: `Dispute resolved: ${resolution}. ${resolution_notes ?? ''}`.trim(),
      metadata: { resolution, resolution_notes },
    })

    const shortId = id.slice(0, 8).toUpperCase()
    const [buyerRes, sellerRes] = await Promise.all([
      adminClient.from('organizations').select('primary_contact_email').eq('id', deal.buyer_org_id).single(),
      adminClient.from('organizations').select('primary_contact_email').eq('id', deal.supplier_org_id).single(),
    ])
    const resolvedHtml = dealDisputeResolvedEmailHtml({ recipientName: '', resolution, dealId: id, dealShortId: shortId })
    const subject = `Dispute resolved — Deal #${shortId}`
    if (buyerRes.data?.primary_contact_email) void sendEmail({ to: buyerRes.data.primary_contact_email, subject, html: resolvedHtml })
    if (sellerRes.data?.primary_contact_email) void sendEmail({ to: sellerRes.data.primary_contact_email, subject, html: resolvedHtml })

    return NextResponse.json({ deal: updated })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
