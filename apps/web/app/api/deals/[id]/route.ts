import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runPassportRecalculate } from '@/lib/passport'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PASSPORT_FIELDS = 'id, legal_name, doing_business_as, passport_score, risk_tier, trade_count_total, trade_volume_total, avg_payment_days, dispute_rate_network, country'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal, error } = await adminClient
    .from('deals')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
  const isOrgParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  const isBankUser = BANK_ROLES.includes(userData.role)

  if (!isOrgParty && !isBankUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Bank users must have a transaction (accepted offer) for this deal
  if (isBankUser) {
    const { data: txCheck } = await adminClient
      .from('transactions')
      .select('id')
      .eq('deal_id', id)
      .eq('bank_id', userData.bank_id)
      .limit(1)
      .maybeSingle()
    if (!txCheck) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const [buyerOrgRes, supplierOrgRes, documentsRes] = await Promise.all([
    adminClient.from('organizations').select(PASSPORT_FIELDS).eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select(PASSPORT_FIELDS).eq('id', deal.supplier_org_id).single(),
    adminClient.from('documents').select('id, name, document_kind, mime_type, created_at').eq('entity_type', 'deal').eq('entity_id', id),
  ])

  let room = null
  if (deal.room_id) {
    const { data: r } = await adminClient.from('rooms').select('id, name').eq('id', deal.room_id).single()
    room = r
  }

  let financingRequest = null
  if (deal.financing_request_id) {
    const { data: fr } = await adminClient
      .from('financing_requests')
      .select('id, status, amount_requested, structure_type, financing_type, currency, offer_count, created_at')
      .eq('id', deal.financing_request_id)
      .single()
    financingRequest = fr
  }

  // Fetch linked transaction when financing is active or a DD offer is pending
  let linkedTransaction = null
  const needsTxn = deal.financing_payment_active
    || deal.status === 'financing_active'
    || deal.dd_offer_presented_at != null
  if (needsTxn) {
    const { data: txn } = await adminClient
      .from('transactions')
      .select('id, type, status, financing_amount_approved, repayment_due_date, bank_id, tenor_days, financing_rate_apr, discount_rate, discount_amount, early_payment_date, repayment_routing')
      .eq('deal_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (txn) {
      linkedTransaction = txn
      if (txn.bank_id) {
        const { data: bank } = await adminClient
          .from('banks')
          .select('id, display_name, legal_name')
          .eq('id', txn.bank_id)
          .single()
        linkedTransaction = { ...txn, bank }
      }
    }
  }

  return NextResponse.json({
    deal,
    buyer_org: buyerOrgRes.data,
    supplier_org: supplierOrgRes.data,
    room,
    financing_request: financingRequest,
    linked_transaction: linkedTransaction,
    documents: documentsRes.data ?? [],
    user_role: isBankUser ? 'bank' : deal.buyer_org_id === userData.org_id ? 'buyer' : 'supplier',
  })
}

// Simple status transitions via PATCH. Complex operations (ship, delivery, payment, cancel)
// have dedicated endpoints with additional validation and side-effects.
const ALLOWED_TRANSITIONS: Record<string, Record<string, string[]>> = {
  buyer: {
    // New flow
    documents_pending: ['confirmed'],       // buyer uploads PO and confirms
    // Legacy
    agreed: ['active'],
    active: ['financing_requested'],
    financing_requested: [],
  },
  supplier: {
    // New flow
    negotiating: ['agreed'],
    agreed: ['documents_pending'],          // seller advances after uploading proforma
    documents_pending: ['confirmed'],       // seller confirms docs are complete
    confirmed: ['in_preparation'],          // seller starts preparation
    payment_confirmed: ['completed'],       // seller confirms payment received
    // Legacy
    active: ['completed'],
    financing_active: [],
  },
}

// Recompute supplier_performance metrics from completed deals
async function updateSupplierPerformance(supplierOrgId: string): Promise<void> {
  const { data: deals } = await adminClient
    .from('deals')
    .select('total_value, agreed_price, payment_days_actual')
    .eq('supplier_org_id', supplierOrgId)
    .eq('status', 'completed')

  const completed = deals ?? []
  const totalDeals = completed.length
  const totalVolume = completed.reduce(
    (sum, d) => sum + Number(d.total_value ?? d.agreed_price ?? 0),
    0
  )

  const withPayData = completed.filter((d) => d.payment_days_actual != null)
  const onTimeCount = withPayData.filter((d) => (d.payment_days_actual ?? 999) <= 30).length
  const onTimeRate = withPayData.length > 0 ? onTimeCount / withPayData.length : null

  const now = new Date().toISOString()
  const { data: existing } = await adminClient
    .from('supplier_performance')
    .select('id')
    .eq('org_id', supplierOrgId)
    .limit(1)
    .maybeSingle()

  const payload: Record<string, unknown> = {
    org_id: supplierOrgId,
    total_transactions: totalDeals,
    total_financed: totalVolume,
    on_time_payment_rate: onTimeRate,
    last_calculated_at: now,
    updated_at: now,
  }

  if (existing?.id) {
    await adminClient.from('supplier_performance').update(payload).eq('id', existing.id)
  } else {
    await adminClient.from('supplier_performance').insert({ ...payload, created_at: now })
  }
}

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
    .select('id, status, buyer_org_id, supplier_org_id, room_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { status, cancellation_reason } = body as { status?: string; cancellation_reason?: string }
  if (!status) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const userRole = deal.buyer_org_id === userData.org_id ? 'buyer' : 'supplier'
  const allowed = ALLOWED_TRANSITIONS[userRole]?.[deal.status] ?? []
  if (!allowed.includes(status)) {
    return NextResponse.json(
      { error: `Transition ${deal.status} → ${status} not allowed for ${userRole}` },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { status, updated_at: now }
  if (status === 'cancelled' && cancellation_reason) updates.cancellation_reason = cancellation_reason
  if (status === 'active')         updates.active_at         = now
  if (status === 'confirmed')      updates.confirmed_at      = now
  if (status === 'in_preparation') updates.in_preparation_at = now
  if (status === 'completed')      updates.completed_at      = now

  const { data: updated, error: updateError } = await adminClient
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (updateError || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  if (deal.room_id) {
    await adminClient.from('room_messages').insert({
      room_id: deal.room_id,
      content: `Deal status updated to ${status}`,
      message_type: 'system',
      status: 'visible',
    })
  }

  if (status === 'agreed') {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `${new URL(request.url).origin}`
    fetch(`${baseUrl}/api/deals/${id}/generate-documents`, {
      method: 'POST',
      headers: { Cookie: request.headers.get('cookie') ?? '' },
    }).catch(() => {})
  }

  // On deal completion: update supplier performance, then recalculate PassportScores
  if (status === 'completed') {
    void updateSupplierPerformance(deal.supplier_org_id).catch((e) =>
      console.error('[deals/complete] supplier_performance update failed:', e)
    )
    void runPassportRecalculate(deal.buyer_org_id).catch((e) =>
      console.error('[deals/complete] buyer passport recalculate failed:', e)
    )
    void runPassportRecalculate(deal.supplier_org_id).catch((e) =>
      console.error('[deals/complete] supplier passport recalculate failed:', e)
    )
  }

  return NextResponse.json({ deal: updated })
}
