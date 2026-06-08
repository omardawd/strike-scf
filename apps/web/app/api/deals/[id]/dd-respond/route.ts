// G3.4 — Supplier responds to a Dynamic Discounting offer (accept or decline).
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
    .select('id, status, buyer_org_id, supplier_org_id, financing_payment_active, total_value, agreed_price, agreed_currency, payment_due_date, dd_offer_presented_at, dd_offer_accepted_at, dd_offer_declined_at')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the supplier can respond to a DD offer' }, { status: 403 })
  }

  if (!deal.dd_offer_presented_at) {
    return NextResponse.json({ error: 'No DD offer has been presented on this deal' }, { status: 400 })
  }

  if (deal.dd_offer_accepted_at || deal.dd_offer_declined_at) {
    return NextResponse.json({ error: 'DD offer already responded to' }, { status: 400 })
  }

  // Find the pending DD transaction
  const { data: txn } = await adminClient
    .from('transactions')
    .select('id, discount_rate, discount_amount, early_payment_date, invoice_amount')
    .eq('deal_id', id)
    .eq('type', 'dynamic_discounting')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!txn) return NextResponse.json({ error: 'DD offer transaction not found' }, { status: 404 })

  let body: { accepted: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const now = new Date().toISOString()
  const shortId = id.slice(0, 8).toUpperCase()
  const currency = deal.agreed_currency ?? 'USD'
  const invoiceAmount = txn.invoice_amount ?? deal.total_value ?? deal.agreed_price ?? 0
  const discountAmount = txn.discount_amount ?? 0
  const paymentAmount = invoiceAmount - discountAmount

  const [buyerRes, sellerRes] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
    adminClient.from('organizations').select('legal_name').eq('id', deal.supplier_org_id).single(),
  ])

  if (body.accepted) {
    // Accept: activate financing
    await adminClient
      .from('transactions')
      .update({ status: 'financing_approved', updated_at: now })
      .eq('id', txn.id)

    const { data: updated } = await adminClient
      .from('deals')
      .update({
        dd_offer_accepted_at: now,
        financing_payment_active: true,
        payment_amount: paymentAmount,
        payment_due_date: txn.early_payment_date,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'dd_offer_accepted',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: `Supplier accepted early payment offer. Payment of ${fmt(paymentAmount, currency)} due on ${txn.early_payment_date ?? '—'}.`,
      metadata: { payment_amount: paymentAmount, discount_amount: discountAmount, early_payment_date: txn.early_payment_date },
    }).then(undefined, console.error)

    if (buyerRes.data?.primary_contact_email) {
      void sendEmail({
        to: buyerRes.data.primary_contact_email,
        subject: `Early Payment Accepted — Deal #${shortId}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a">
          <p>${sellerRes.data?.legal_name ?? 'The supplier'} has accepted your early payment offer. Please pay ${fmt(paymentAmount, currency)} by ${txn.early_payment_date ?? '—'}.</p>
          <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${id}">View Deal →</a></p>
        </div>`,
      })
    }

    return NextResponse.json({ accepted: true, deal: updated, payment_amount: paymentAmount })
  } else {
    // Decline: cancel transaction, revert to direct payment
    await adminClient
      .from('transactions')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', txn.id)

    const { data: updated } = await adminClient
      .from('deals')
      .update({
        dd_offer_declined_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    await adminClient.from('deal_events').insert({
      deal_id: id,
      event_type: 'dd_offer_declined',
      actor_user_id: userData.id,
      actor_org_id: userData.org_id,
      description: 'Supplier declined early payment offer. Original payment terms apply.',
    }).then(undefined, console.error)

    if (buyerRes.data?.primary_contact_email) {
      void sendEmail({
        to: buyerRes.data.primary_contact_email,
        subject: `Early Payment Declined — Deal #${shortId}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a">
          <p>${sellerRes.data?.legal_name ?? 'The supplier'} has declined your early payment offer. Original payment terms apply — ${fmt(invoiceAmount, currency)} due on ${deal.payment_due_date ?? '—'}.</p>
          <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${id}">View Deal →</a></p>
        </div>`,
      })
    }

    return NextResponse.json({ accepted: false, deal: updated })
  }
}
