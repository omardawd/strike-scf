import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, kybApprovalEmailHtml, kybRejectionEmailHtml, passportLiveEmailHtml } from '@/lib/email'
import { DOC_KIND_LABELS } from '@/lib/kyb-document-kinds'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/admin/kyb/[org_id] — full onboarding submission for Strike Admin review:
// every organizations column, uploaded KYB documents (signed URLs), bank accounts,
// and score/decision history. strike_admin only.
export async function GET(
  _req: Request,
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

  const [{ data: org }, { data: rawDocs }, { data: bankAccounts }, { data: creditScores }, { data: decisions }] = await Promise.all([
    adminClient.from('organizations').select('*').eq('id', org_id).single(),
    adminClient
      .from('documents')
      .select('id, name, document_kind, storage_path, mime_type, created_at')
      .eq('entity_type', 'organization')
      .eq('entity_id', org_id)
      .order('created_at', { ascending: false }),
    adminClient
      .from('bank_accounts')
      .select('*')
      .eq('entity_type', 'organization')
      .eq('entity_id', org_id)
      .order('is_primary', { ascending: false }),
    adminClient
      .from('credit_scores')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false })
      .limit(1),
    adminClient
      .from('credit_decision_records')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false }),
  ])

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const documents = await Promise.all(
    (rawDocs ?? []).map(async (doc) => {
      const { data: signed } = await adminClient.storage
        .from('kyb-documents')
        .createSignedUrl(doc.storage_path, 3600)
      return { ...doc, signed_url: signed?.signedUrl ?? null }
    })
  )

  let expertAnalysis: unknown = null
  if (org.passport_expert_analysis) {
    try { expertAnalysis = JSON.parse(org.passport_expert_analysis) } catch { /* leave null */ }
  }

  return NextResponse.json({
    organization: org,
    expert_analysis: expertAnalysis,
    documents,
    bank_accounts: bankAccounts ?? [],
    credit_score: creditScores?.[0] ?? null,
    decision_history: decisions ?? [],
  })
}

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
    .select('id, role, full_name')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (userData.role !== 'strike_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, primary_contact_email, primary_contact_name, network_visible, passport_score, risk_tier, status')
    .eq('id', org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  const orgRow = org

  const body = await req.json()
  const { action, reason, message, requested_documents } = body as {
    action: string
    reason?: string
    message?: string
    requested_documents?: string[]
  }
  const orgName = org.doing_business_as || org.legal_name || 'Your organization'
  const recipientName = org.primary_contact_name || 'there'
  const decidedByName = userData.full_name || 'Strike Admin'

  async function recordDecision(decision: string, extra?: { rejection_reason?: string; info_request_message?: string; requested_documents?: string[] }) {
    await adminClient.from('credit_decision_records').insert({
      org_id,
      decision,
      decided_by_user_id: user!.id,
      decided_by_user_name: decidedByName,
      score_at_decision: orgRow.passport_score,
      risk_tier_at_decision: orgRow.risk_tier,
      rejection_reason: extra?.rejection_reason ?? null,
      info_request_message: extra?.info_request_message ?? null,
      requested_documents: extra?.requested_documents ?? null,
    })
  }

  async function notifyOrg(event: string, title: string, notifBody: string, deepLink: string) {
    const { data: orgUsers } = await adminClient.from('users').select('id').eq('org_id', org_id)
    if (orgUsers?.length) {
      await adminClient.from('notifications').insert(
        orgUsers.map((u: { id: string }) => ({
          user_id: u.id,
          event,
          title,
          body: notifBody,
          deep_link: deepLink,
          read: false,
        }))
      )
    }
  }

  if (action === 'approve') {
    const updates: Record<string, any> = {
      kyb_status: 'approved',
      status: 'active',
    }
    if (org.network_visible) {
      updates.passport_published_at = new Date().toISOString()
    }

    await adminClient.from('organizations').update(updates).eq('id', org_id)
    await recordDecision('approved')

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

    await notifyOrg('kyb_approved', 'Your application has been approved', `${orgName} has been approved on Strike.`, '/passport')

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
    await recordDecision('rejected', { rejection_reason: reason })

    if (org.primary_contact_email) {
      sendEmail({
        to: org.primary_contact_email,
        subject: 'Update on your Strike application',
        html: kybRejectionEmailHtml({ recipientName, orgName, reason }),
      }).catch(() => {})
    }

    await notifyOrg('kyb_rejected', 'Application update', reason ? `Your application was not approved: ${reason}` : 'Your application was not approved.', '/dashboard')

    return NextResponse.json({ ok: true })
  }

  if (action === 'more_info') {
    await adminClient
      .from('organizations')
      .update({ kyb_status: 'more_info_requested' })
      .eq('id', org_id)
    await recordDecision('more_info_requested', { info_request_message: message, requested_documents })

    const docList = (requested_documents ?? []).length > 0
      ? `<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#92400e;margin-bottom:6px;">Documents requested</div>
          <ul style="margin:0;padding-left:18px;color:#475569;font-size:14px;">
            ${(requested_documents ?? []).map(d => `<li>${DOC_KIND_LABELS[d] ?? d}</li>`).join('')}
          </ul>
        </div>`
      : ''

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
            ${docList}
            <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">Sign in to Strike to respond and upload the requested information directly — no need to reply to this email.</p>
          </div>
        `,
      }).catch(() => {})
    }

    await notifyOrg(
      'kyb_more_info_requested',
      'Action required: more information needed',
      message || 'Strike needs additional information to continue reviewing your application.',
      '/dashboard'
    )

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
