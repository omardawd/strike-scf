// G3.5 — Daily cron: flag overdue payments and apply grace period for pending financing.
// Vercel cron: 0 8 * * * (08:00 UTC daily)
// Auth: x-cron-secret header
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, dealPaymentOverdueEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  // Deals where payment is expected and due date has passed
  const { data: overdueDeals } = await adminClient
    .from('deals')
    .select('id, status, buyer_org_id, supplier_org_id, payment_due_date, financing_payment_active, financing_request_id, overdue_notified_at')
    .in('status', ['delivery_confirmed', 'payment_due'])
    .lt('payment_due_date', todayStr)
    .is('payment_confirmed_at', null)

  const results: { deal_id: string; action: string }[] = []

  for (const deal of overdueDeals ?? []) {
    try {
      // G9.1 — Check for pending financing request with grace period
      if (deal.financing_request_id) {
        const { data: fr } = await adminClient
          .from('financing_requests')
          .select('id, status')
          .eq('id', deal.financing_request_id)
          .single()
        if (fr && ['open', 'offers_received'].includes(fr.status)) {
          // Financing is still pending — apply 2 business day grace
          const graceDeadline = new Date(deal.payment_due_date)
          graceDeadline.setDate(graceDeadline.getDate() + 2)
          if (today <= graceDeadline) {
            results.push({ deal_id: deal.id, action: 'grace_period_active' })
            continue
          }
        }
      }

      const now = new Date().toISOString()

      await adminClient.from('deals').update({
        status: 'payment_overdue',
        overdue_notified_at: now,
        updated_at: now,
      }).eq('id', deal.id)

      await adminClient.from('deal_events').insert({
        deal_id: deal.id,
        event_type: 'payment_overdue',
        description: `Payment overdue — automated flag. Due date was ${deal.payment_due_date}`,
      })

      // Notify buyer and seller
      const [buyerRes, sellerRes] = await Promise.all([
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.buyer_org_id).single(),
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', deal.supplier_org_id).single(),
      ])
      const shortId = deal.id.slice(0, 8).toUpperCase()
      const dueDate = deal.payment_due_date ?? 'the due date'

      if (buyerRes.data?.primary_contact_email) {
        void sendEmail({
          to: buyerRes.data.primary_contact_email,
          subject: `Payment overdue — Deal #${shortId}`,
          html: dealPaymentOverdueEmailHtml({ recipientName: buyerRes.data.legal_name ?? 'Buyer', dealId: deal.id, dealShortId: shortId, dueDate, isBuyer: true }),
        })
      }
      if (sellerRes.data?.primary_contact_email) {
        void sendEmail({
          to: sellerRes.data.primary_contact_email,
          subject: `Payment overdue — Deal #${shortId}`,
          html: dealPaymentOverdueEmailHtml({ recipientName: sellerRes.data.legal_name ?? 'Seller', dealId: deal.id, dealShortId: shortId, dueDate, isBuyer: false }),
        })
      }

      // If financing active, notify bank and create admin alert
      if (deal.financing_payment_active) {
        // Notify Strike Admin as proxy for bank alert
        const { data: adminUsers } = await adminClient.from('users').select('email').eq('role', 'strike_admin').limit(5)
        for (const adminUser of adminUsers ?? []) {
          void sendEmail({
            to: adminUser.email,
            subject: `[URGENT] Overdue payment with active financing — Deal #${shortId}`,
            html: `<p>Deal #${shortId} has an active financing arrangement and payment is now overdue. Immediate attention required.</p>`,
          })
        }

        // Negative PassportScore signal for buyer
        await adminClient.from('agent_actions').insert({
          org_id: deal.buyer_org_id,
          action_type: 'passport_flagged',
          entity_type: 'deal',
          entity_id: deal.id,
          reasoning: 'Payment overdue on a deal with active financing',
          outcome: 'negative_signal_logged',
          requires_approval: false,
        })
      }

      // Alert Strike Admin
      const { data: adminUsers } = await adminClient.from('users').select('email').eq('role', 'strike_admin').limit(5)
      for (const adminUser of adminUsers ?? []) {
        void sendEmail({
          to: adminUser.email,
          subject: `[ADMIN] Payment overdue — Deal #${shortId}`,
          html: `<p>Deal #${shortId} (buyer: ${deal.buyer_org_id}, seller: ${deal.supplier_org_id}) payment overdue since ${dueDate}. Financing active: ${deal.financing_payment_active}.</p>`,
        })
      }

      results.push({ deal_id: deal.id, action: 'flagged_overdue' })
    } catch (err) {
      console.error(`[check-overdue] Failed for deal ${deal.id}:`, err)
      results.push({ deal_id: deal.id, action: 'error' })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
