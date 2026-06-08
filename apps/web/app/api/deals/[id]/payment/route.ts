// G3.4 — Payment confirmation.
// POST action=buyer_confirm: buyer confirms payment sent → payment_confirmed
// POST action=seller_confirm: seller confirms payment received → completed
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runPassportRecalculate } from '@/lib/passport'
import {
  sendEmail,
  dealPaymentConfirmedEmailHtml,
  dealCompletedEmailHtml,
} from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function updateSupplierPerformance(supplierOrgId: string): Promise<void> {
  const { data: deals } = await adminClient
    .from('deals')
    .select('total_value, agreed_price, payment_days_actual')
    .eq('supplier_org_id', supplierOrgId)
    .eq('status', 'completed')
  const completed = deals ?? []
  const totalVolume = completed.reduce((s, d) => s + Number(d.total_value ?? d.agreed_price ?? 0), 0)
  const withPay = completed.filter((d) => d.payment_days_actual != null)
  const onTimeRate = withPay.length > 0 ? withPay.filter((d) => (d.payment_days_actual ?? 999) <= 30).length / withPay.length : null
  const now = new Date().toISOString()
  const { data: existing } = await adminClient.from('supplier_performance').select('id').eq('org_id', supplierOrgId).limit(1).maybeSingle()
  const payload = { org_id: supplierOrgId, total_transactions: completed.length, total_financed: totalVolume, on_time_payment_rate: onTimeRate, last_calculated_at: now, updated_at: now }
  if (existing?.id) {
    await adminClient.from('supplier_performance').update(payload).eq('id', existing.id)
  } else {
    await adminClient.from('supplier_performance').insert({ ...payload, created_at: now })
  }
}

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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, agreed_at, payment_confirmed_at')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, payment_date, payment_external_reference, payment_amount, note } = body as {
    action: 'buyer_confirm' | 'seller_confirm'
    payment_date?: string
    payment_external_reference?: string
    payment_amount?: number
    note?: string
  }

  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const now = new Date().toISOString()
  const shortId = id.slice(0, 8).toUpperCase()

  if (action === 'buyer_confirm') {
    if (deal.buyer_org_id !== userData.org_id) {
      return NextResponse.json({ error: 'Only the buyer can confirm payment sent' }, { status: 403 })
    }
    if (!['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(deal.status)) {
      return NextResponse.json({ error: `Cannot confirm payment at status: ${deal.status}` }, { status: 400 })
    }

    const { data: updated, error } = await adminClient
      .from('deals')
      .update({
        status: 'payment_confirmed',
        payment_confirmed_at: now,
        payment_confirmed_by: userData.id,
        payment_external_reference: payment_external_reference ?? null,
        payment_amount: payment_amount ?? null,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()
    if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'payment_confirmed_by_buyer',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: `Buyer confirmed payment sent. Reference: ${payment_external_reference ?? '—'}`,
      metadata: { payment_external_reference, payment_amount, note },
    })

    // Notify seller
    const [sellerOrgRes, buyerOrgRes] = await Promise.all([
      adminClient.from('organizations').select('primary_contact_email').eq('id', deal.supplier_org_id).single(),
      adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
    ])
    if (sellerOrgRes.data?.primary_contact_email) {
      void sendEmail({
        to: sellerOrgRes.data.primary_contact_email,
        subject: `Payment confirmed by buyer — Deal #${shortId}`,
        html: dealPaymentConfirmedEmailHtml({
          buyerName: buyerOrgRes.data?.legal_name ?? 'Buyer',
          paymentRef: payment_external_reference ?? '—',
          dealId: id,
          dealShortId: shortId,
        }),
      })
    }

    return NextResponse.json({ deal: updated })
  }

  if (action === 'seller_confirm') {
    if (deal.supplier_org_id !== userData.org_id) {
      return NextResponse.json({ error: 'Only the supplier can confirm payment received' }, { status: 403 })
    }
    if (deal.status !== 'payment_confirmed') {
      return NextResponse.json({ error: `Cannot confirm payment receipt at status: ${deal.status}` }, { status: 400 })
    }

    // Calculate actual payment days
    let paymentDaysActual: number | null = null
    if (deal.agreed_at) {
      const agreedDate = new Date(deal.agreed_at)
      const paidDate = new Date(deal.payment_confirmed_at ?? now)
      paymentDaysActual = Math.round((paidDate.getTime() - agreedDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    const { data: updated, error } = await adminClient
      .from('deals')
      .update({
        status: 'completed',
        completed_at: now,
        payment_days_actual: paymentDaysActual,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()
    if (error || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'completed',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: 'Seller confirmed payment received. Deal completed.',
    })

    // Passport + supplier performance
    void updateSupplierPerformance(deal.supplier_org_id).catch(console.error)
    void runPassportRecalculate(deal.buyer_org_id).catch(console.error)
    void runPassportRecalculate(deal.supplier_org_id).catch(console.error)

    // Completion emails to both parties
    const [buyerOrgRes, sellerOrgRes] = await Promise.all([
      adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
      adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.supplier_org_id).single(),
    ])
    if (buyerOrgRes.data?.primary_contact_email) {
      void sendEmail({
        to: buyerOrgRes.data.primary_contact_email,
        subject: `Deal #${shortId} completed`,
        html: dealCompletedEmailHtml({ recipientName: 'Buyer', dealId: id, dealShortId: shortId }),
      })
    }
    if (sellerOrgRes.data?.primary_contact_email) {
      void sendEmail({
        to: sellerOrgRes.data.primary_contact_email,
        subject: `Deal #${shortId} completed`,
        html: dealCompletedEmailHtml({ recipientName: 'Seller', dealId: id, dealShortId: shortId }),
      })
    }

    return NextResponse.json({ deal: updated })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
