import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, kybApprovalEmailHtml, kybRejectionEmailHtml, passportLiveEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (userData.role !== 'strike_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, primary_contact_email, primary_contact_name, network_visible, passport_score, status')
    .eq('id', org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const body = await req.json()
  const { action, reason, message } = body
  const orgName = org.doing_business_as || org.legal_name || 'Your organization'
  const recipientName = org.primary_contact_name || 'there'

  if (action === 'approve') {
    const updates: Record<string, any> = {
      kyb_status: 'approved',
      status: 'active',
    }
    if (org.network_visible) {
      updates.passport_published_at = new Date().toISOString()
    }

    await adminClient.from('organizations').update(updates).eq('id', org_id)

    if (org.primary_contact_email) {
      if (org.network_visible) {
        sendEmail({
          to: org.primary_contact_email,
          subject: 'Your Strike Passport is live',
          html: passportLiveEmailHtml({ recipientName, orgName, score: org.passport_score }),
        }).catch(() => {})
      } else {
        sendEmail({
          to: org.primary_contact_email,
          subject: 'Your application has been approved',
          html: kybApprovalEmailHtml({ recipientName, orgName }),
        }).catch(() => {})
      }
    }

    // Fire-and-forget passport recalculate
    fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/passport/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id }),
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  }

  if (action === 'reject') {
    await adminClient
      .from('organizations')
      .update({ kyb_status: 'rejected', status: 'rejected' })
      .eq('id', org_id)

    if (org.primary_contact_email) {
      sendEmail({
        to: org.primary_contact_email,
        subject: 'Update on your Strike application',
        html: kybRejectionEmailHtml({ recipientName, orgName, reason }),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'more_info') {
    await adminClient
      .from('organizations')
      .update({ kyb_status: 'more_info_requested' })
      .eq('id', org_id)

    if (org.primary_contact_email && message) {
      sendEmail({
        to: org.primary_contact_email,
        subject: 'Action required: Additional information needed',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
            <div style="font-size:20px;font-weight:700;color:#1B3BE8;margin-bottom:24px;letter-spacing:-0.03em;">Strike SCF</div>
            <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;">Additional information needed</h2>
            <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 16px;">
              Hi <strong>${recipientName}</strong>, our team is reviewing <strong>${orgName}</strong>&apos;s application and needs some additional information.
            </p>
            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:6px;">Message from Strike</div>
              <div style="font-size:14px;color:#475569;">${message}</div>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">Please reply to this email with the requested information.</p>
          </div>
        `,
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
