import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import type { ImportDealPayload } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const APP_URL = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.strikescf.com').trim()
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return raw.includes('localhost') ? `http://${raw}` : `https://${raw}`
})()

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, full_name')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!userData.org_id) return NextResponse.json({ error: 'Organization not set up' }, { status: 400 })

  let body: ImportDealPayload
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    initiating_side,
    counterparty_org_id,
    counterparty_name,
    counterparty_email,
    goods_description,
    total_value,
    currency,
    agreed_delivery_date,
    agreed_incoterms,
    agreed_payment_terms,
    po_number,
    import_notes,
  } = body

  if (!initiating_side || !goods_description || !total_value || !currency) {
    return NextResponse.json({ error: 'Missing required fields: initiating_side, goods_description, total_value, currency' }, { status: 400 })
  }

  const buyer_org_id    = initiating_side === 'buyer'    ? userData.org_id : (counterparty_org_id ?? null)
  const supplier_org_id = initiating_side === 'supplier' ? userData.org_id : (counterparty_org_id ?? null)

  const confirmationToken = crypto.randomUUID()

  const { data: deal, error: dealError } = await adminClient
    .from('deals')
    .insert({
      buyer_org_id,
      supplier_org_id,
      agreed_price: total_value,
      agreed_currency: currency,
      goods_description,
      agreed_delivery_date: agreed_delivery_date ?? null,
      agreed_incoterms: agreed_incoterms ?? null,
      agreed_payment_terms: agreed_payment_terms ?? null,
      deal_source: 'imported',
      status: 'agreed',
      counterparty_confirmed: false,
      counterparty_confirmation_token: confirmationToken,
      imported_by_org_id: userData.org_id,
      import_notes: import_notes ?? null,
      total_value,
      agreed_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (dealError || !deal) {
    console.error('[deals/import] insert error:', dealError)
    return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 })
  }

  // po_number goes into import_notes if provided and not stored separately
  if (po_number) {
    await adminClient.from('deals').update({ import_notes: `PO: ${po_number}${import_notes ? ` | ${import_notes}` : ''}` }).eq('id', deal.id)
  }

  // Notify counterparty
  if (counterparty_org_id) {
    const { data: cpOrg } = await adminClient
      .from('organizations')
      .select('primary_contact_email, primary_contact_name, legal_name')
      .eq('id', counterparty_org_id)
      .single()

    if (cpOrg?.primary_contact_email) {
      const confirmUrl = `${APP_URL}/deals/${deal.id}?confirm=${confirmationToken}`
      await sendEmail({
        to: cpOrg.primary_contact_email,
        subject: 'A deal has been imported involving your organization — review and confirm',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
            <div style="font-size:20px;font-weight:700;color:#1B3BE8;margin-bottom:24px;">Strike SCF</div>
            <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${cpOrg.primary_contact_name ?? 'there'},</h2>
            <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px;">
              A deal has been imported on Strike SCF that involves <strong>${cpOrg.legal_name ?? 'your organization'}</strong>.
              Please review the deal terms and confirm your participation.
            </p>
            <a href="${confirmUrl}" style="display:inline-block;background:#1B3BE8;color:white;text-decoration:none;padding:12px 28px;font-size:14px;font-weight:600;">
              Review &amp; Confirm Deal →
            </a>
          </div>
        `,
      })
    }

    // In-app notification to org admins
    const { data: cpUsers } = await adminClient
      .from('users')
      .select('id')
      .eq('org_id', counterparty_org_id)
      .in('role', ['anchor_admin', 'supplier_admin'])

    const notifs = (cpUsers ?? []).map(u => ({
      user_id: u.id,
      event: 'deal_imported',
      title: 'Deal import requires your confirmation',
      body: 'An imported deal involving your organization needs review and confirmation.',
      deep_link: `/deals/${deal.id}`,
      read: false,
    }))
    if (notifs.length > 0) await adminClient.from('notifications').insert(notifs)

  } else if (counterparty_email) {
    const joinUrl = `${APP_URL}/invite?deal=${deal.id}&token=${confirmationToken}`
    await sendEmail({
      to: counterparty_email,
      subject: 'You have been listed as a counterparty on a Strike SCF deal',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
          <div style="font-size:20px;font-weight:700;color:#1B3BE8;margin-bottom:24px;">Strike SCF</div>
          <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${counterparty_name ?? 'there'},</h2>
          <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px;">
            You've been listed as a counterparty on a trade deal on Strike SCF.
            Join Strike to review the deal terms and confirm your participation.
          </p>
          <a href="${joinUrl}" style="display:inline-block;background:#1B3BE8;color:white;text-decoration:none;padding:12px 28px;font-size:14px;font-weight:600;">
            Join Strike and Review Deal →
          </a>
        </div>
      `,
    })
  }

  return NextResponse.json({ deal_id: deal.id }, { status: 201 })
}
