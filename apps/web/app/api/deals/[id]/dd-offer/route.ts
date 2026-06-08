// G3.4 — Anchor presents a Dynamic Discounting early payment offer to supplier.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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

  if (!['org_admin', 'org_member'].includes(userData.role)) {
    return NextResponse.json({ error: 'Only organization members can present DD offers' }, { status: 403 })
  }

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, total_value, agreed_price, agreed_currency, payment_due_date')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the buyer (anchor) can present a DD offer' }, { status: 403 })
  }

  if (deal.financing_payment_active) {
    return NextResponse.json({ error: 'Financing is already active on this deal' }, { status: 400 })
  }

  if (!['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(deal.status)) {
    return NextResponse.json({ error: 'DD offer can only be presented after delivery is confirmed' }, { status: 400 })
  }

  let body: { discount_rate: number; early_payment_date: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.discount_rate || !body.early_payment_date) {
    return NextResponse.json({ error: 'discount_rate and early_payment_date are required' }, { status: 400 })
  }

  const invoiceAmount = deal.total_value ?? deal.agreed_price ?? 0
  const currency = deal.agreed_currency ?? 'USD'
  const originalDue = deal.payment_due_date

  if (!originalDue) {
    return NextResponse.json({ error: 'Deal has no payment_due_date set — cannot calculate discount' }, { status: 400 })
  }

  const daysEarly = Math.max(
    0,
    Math.ceil((new Date(originalDue).getTime() - new Date(body.early_payment_date).getTime()) / (1000 * 60 * 60 * 24))
  )
  const discountAmount = invoiceAmount * (body.discount_rate / 100) * (daysEarly / 360)
  const paymentAmount = invoiceAmount - discountAmount

  const now = new Date().toISOString()
  const shortId = id.slice(0, 8).toUpperCase()

  // Create transaction record for the DD offer
  const { data: txn, error: txnError } = await adminClient
    .from('transactions')
    .insert({
      deal_id: id,
      anchor_id: deal.buyer_org_id,
      supplier_id: deal.supplier_org_id,
      type: 'dynamic_discounting',
      status: 'draft',
      invoice_amount: invoiceAmount,
      discount_rate: body.discount_rate,
      discount_amount: discountAmount,
      early_payment_date: body.early_payment_date,
      repayment_routing: 'direct',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (txnError || !txn) {
    console.error('DD transaction insert error:', txnError)
    return NextResponse.json({ error: 'Failed to create DD offer' }, { status: 500 })
  }

  // Mark deal as having a DD offer pending
  const { data: updated } = await adminClient
    .from('deals')
    .update({ dd_offer_presented_at: now, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  await adminClient.from('deal_events').insert({
    deal_id: id,
    event_type: 'dd_offer_presented',
    actor_user_id: userData.id,
    actor_org_id: userData.org_id,
    description: `Early payment offer presented: ${fmt(paymentAmount, currency)} on ${fmtDate(body.early_payment_date)} (${body.discount_rate}% annualized discount).`,
    metadata: { discount_rate: body.discount_rate, early_payment_date: body.early_payment_date, discount_amount: discountAmount, payment_amount: paymentAmount },
  }).then(undefined, console.error)

  // Notify supplier
  const [buyerRes, sellerRes] = await Promise.all([
    adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.supplier_org_id).single(),
  ])

  if (sellerRes.data?.primary_contact_email) {
    const anchorName = buyerRes.data?.legal_name ?? 'Your buyer'
    void sendEmail({
      to: sellerRes.data.primary_contact_email,
      subject: `Early Payment Offer — Deal #${shortId}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 16px">Early Payment Offer from ${anchorName}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b">Invoice amount</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmt(invoiceAmount, currency)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Early payment date</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmtDate(body.early_payment_date)} (${daysEarly} days early)</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Discount rate</td><td style="padding:8px 0;text-align:right">${body.discount_rate}% annualized</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Discount amount</td><td style="padding:8px 0;text-align:right;color:#ef4444">-${fmt(discountAmount, currency)}</td></tr>
          <tr style="border-top:2px solid #e2e8f0"><td style="padding:12px 0;font-weight:700">You receive</td><td style="padding:12px 0;text-align:right;font-weight:700;color:#10b981">${fmt(paymentAmount, currency)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Original due date</td><td style="padding:8px 0;text-align:right">${fmtDate(originalDue)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">If you wait</td><td style="padding:8px 0;text-align:right">${fmt(invoiceAmount, currency)}</td></tr>
        </table>
        <p style="margin-top:24px"><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${id}" style="background:#1428CC;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review Offer →</a></p>
      </div>`,
    })
  }

  return NextResponse.json({ transaction: txn, deal: updated, payment_amount: paymentAmount, discount_amount: discountAmount }, { status: 201 })
}
