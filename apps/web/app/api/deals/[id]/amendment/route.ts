// G4 — Amendment proposal and response.
// POST — propose an amendment
// PATCH — respond to a pending amendment (accept/reject)
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealAmendmentProposedEmailHtml, dealAmendmentRespondedEmailHtml } from '@/lib/email'
import type { AmendmentRecord } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const AMENDABLE_FIELDS = ['agreed_quantity', 'agreed_price', 'agreed_delivery_date', 'agreed_payment_terms', 'import_notes']

// G4.1 — Propose amendment
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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, amendment_history, agreed_quantity, agreed_price, agreed_delivery_date, agreed_payment_terms, import_notes')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  if (!isParty) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // G4.3 — Block amendments when financing active
  if (deal.financing_payment_active) {
    return NextResponse.json({ error: 'Amendments are not permitted after financing has been activated on this deal.' }, { status: 403 })
  }

  if (!['confirmed', 'in_preparation', 'active'].includes(deal.status)) {
    return NextResponse.json({ error: `Amendments are only available at confirmed or in_preparation status. Current: ${deal.status}` }, { status: 400 })
  }

  // Block if there's already a pending amendment
  const history: AmendmentRecord[] = Array.isArray(deal.amendment_history) ? deal.amendment_history : []
  if (history.some(a => a.status === 'pending')) {
    return NextResponse.json({ error: 'There is already a pending amendment. The counterparty must respond before you can propose another.' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { field, proposed_value, reason } = body as { field: string; proposed_value: string | number; reason: string }

  if (!field || !AMENDABLE_FIELDS.includes(field)) {
    return NextResponse.json({ error: `field must be one of: ${AMENDABLE_FIELDS.join(', ')}` }, { status: 400 })
  }
  if (proposed_value == null) return NextResponse.json({ error: 'proposed_value required' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'reason required' }, { status: 400 })

  const currentValue = (deal as Record<string, unknown>)[field] as string | number | null

  const record: AmendmentRecord = {
    id: crypto.randomUUID(),
    proposed_by: userData.id,
    proposed_at: new Date().toISOString(),
    field,
    current_value: currentValue,
    proposed_value,
    reason,
    status: 'pending',
    responded_at: null,
    response: null,
  }

  const updatedHistory = [...history, record]
  const { data: updated, error } = await adminClient
    .from('deals')
    .update({ amendment_history: updatedHistory, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'amendment_proposed',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: `Amendment proposed: ${field} from "${currentValue}" to "${proposed_value}". Reason: ${reason}`,
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
      subject: `Amendment proposed on Deal #${id.slice(0, 8).toUpperCase()}`,
      html: dealAmendmentProposedEmailHtml({
        proposerName: actorRes.data?.legal_name ?? 'Counterparty',
        field,
        currentValue: String(currentValue ?? '—'),
        proposedValue: String(proposed_value),
        dealId: id,
        dealShortId: id.slice(0, 8).toUpperCase(),
      }),
    })
  }

  return NextResponse.json({ deal: updated, amendment_id: record.id })
}

// G4.2 — Respond to a pending amendment
export async function PATCH(
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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, amendment_history')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  if (!isParty) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (deal.financing_payment_active) {
    return NextResponse.json({ error: 'Amendments are locked while financing is active.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { amendment_id, response } = body as { amendment_id: string; response: 'accepted' | 'rejected' }
  if (!amendment_id) return NextResponse.json({ error: 'amendment_id required' }, { status: 400 })
  if (!['accepted', 'rejected'].includes(response)) return NextResponse.json({ error: 'response must be accepted or rejected' }, { status: 400 })

  const history: AmendmentRecord[] = Array.isArray(deal.amendment_history) ? deal.amendment_history : []
  const amendIdx = history.findIndex(a => a.id === amendment_id)
  if (amendIdx === -1) return NextResponse.json({ error: 'Amendment not found' }, { status: 404 })

  const amendment = history[amendIdx]
  if (!amendment) return NextResponse.json({ error: 'Amendment not found' }, { status: 404 })
  if (amendment.status !== 'pending') return NextResponse.json({ error: 'Amendment is not pending' }, { status: 400 })

  // Proposer cannot respond to their own amendment
  if (amendment.proposed_by === userData.id) {
    return NextResponse.json({ error: 'You cannot respond to your own amendment proposal' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const updatedRecord: AmendmentRecord = {
    id: amendment.id,
    proposed_by: amendment.proposed_by,
    proposed_at: amendment.proposed_at,
    field: amendment.field,
    current_value: amendment.current_value,
    proposed_value: amendment.proposed_value,
    reason: amendment.reason,
    status: response,
    responded_at: now,
    response: response === 'accepted' ? 'accepted' : 'rejected',
  }
  history[amendIdx] = updatedRecord

  const dealUpdates: Record<string, unknown> = {
    amendment_history: history,
    updated_at: now,
  }

  // If accepted, apply the field change to the deal
  if (response === 'accepted') {
    dealUpdates[amendment.field] = amendment.proposed_value
  }

  const { data: updated, error } = await adminClient
    .from('deals')
    .update(dealUpdates)
    .eq('id', id)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: `amendment_${response}`,
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: `Amendment ${response}: ${updatedRecord.field} ${response === 'accepted' ? `updated to "${updatedRecord.proposed_value}"` : 'rejected, deal continues with original terms'}`,
  })

  // Notify the proposer
  const proposerOrgId = deal.buyer_org_id === userData.org_id ? deal.supplier_org_id : deal.buyer_org_id
  const { data: proposerRes } = await adminClient.from('organizations').select('primary_contact_email').eq('id', proposerOrgId).single()
  if (proposerRes?.primary_contact_email) {
    void sendEmail({
      to: proposerRes.primary_contact_email,
      subject: `Your amendment was ${response} — Deal #${id.slice(0, 8).toUpperCase()}`,
      html: dealAmendmentRespondedEmailHtml({ accepted: response === 'accepted', dealId: id, dealShortId: id.slice(0, 8).toUpperCase() }),
    })
  }

  return NextResponse.json({ deal: updated })
}
