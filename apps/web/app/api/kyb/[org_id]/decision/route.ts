import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { KYBStatus, OrgStatus, RiskTier, CreditDecision } from '@strike-scf/types'
import { sendEmail, kybApprovalEmailHtml, kybRejectionEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface DecisionBody {
  decision: CreditDecision
  override_reason?: string
  rejection_reason?: string
  info_request_message?: string
  risk_tier?: RiskTier
  credit_score?: number
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, bank_id')
    .eq('id', user.id)
    .single()

  if (!me || (me.role !== 'bank_admin' && me.role !== 'bank_credit_officer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, bank_id, credit_score, risk_tier')
    .eq('id', org_id)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (org.bank_id !== me.bank_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: DecisionBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { decision, override_reason, rejection_reason, info_request_message, risk_tier, credit_score } = body

  if (!decision) return NextResponse.json({ error: 'decision is required' }, { status: 400 })

  try {
    // Optionally insert a new credit score record
    let creditScoreId: string | null = null
    if (credit_score !== undefined) {
      const { data: newScore, error: scoreErr } = await adminClient
        .from('credit_scores')
        .insert({
          org_id,
          total_score: credit_score,
          risk_tier: risk_tier ?? null,
        })
        .select('id')
        .single()

      if (scoreErr || !newScore) {
        console.error('KYB decision error — credit_scores insert:', scoreErr)
        return NextResponse.json({ error: scoreErr?.message ?? 'Failed to save credit score' }, { status: 500 })
      }
      creditScoreId = newScore.id
    } else {
      // Use latest existing score
      const { data: existing } = await adminClient
        .from('credit_scores')
        .select('id, total_score')
        .eq('org_id', org_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      creditScoreId = existing?.id ?? null
    }

    // Insert decision record
    const decisionInsert: Record<string, unknown> = {
      org_id,
      decision,
      decided_by_user_id: user.id,
      score_at_decision: credit_score ?? org.credit_score ?? 0,
      risk_tier_at_decision: risk_tier ?? org.risk_tier ?? 'C',
      override_reason: override_reason ?? null,
      rejection_reason: rejection_reason ?? null,
      info_request_message: info_request_message ?? null,
    }
    if (creditScoreId) decisionInsert.credit_score_id = creditScoreId

    const { error: decisionErr } = await adminClient
      .from('credit_decision_records')
      .insert(decisionInsert)

    if (decisionErr) {
      console.error('KYB decision error — credit_decision_records insert:', decisionErr)
      return NextResponse.json({ error: decisionErr.message ?? 'Failed to record decision' }, { status: 500 })
    }

    // Derive org status updates
    let orgUpdate: Record<string, unknown> = {}
    if (decision === 'approved' || decision === 'override_approved') {
      orgUpdate = {
        status: 'approved' satisfies OrgStatus,
        kyb_status: 'approved' satisfies KYBStatus,
        credit_reviewed_at: new Date().toISOString(),
        ...(risk_tier !== undefined && { risk_tier }),
        ...(credit_score !== undefined && { credit_score }),
      }
    } else if (decision === 'rejected') {
      orgUpdate = {
        status: 'rejected' satisfies OrgStatus,
        kyb_status: 'rejected' satisfies KYBStatus,
        credit_reviewed_at: new Date().toISOString(),
      }
    } else if (decision === 'more_info_requested') {
      orgUpdate = {
        kyb_status: 'more_info_requested' satisfies KYBStatus,
      }
    } else if (decision === 'pending_countersign') {
      orgUpdate = {
        kyb_status: 'under_review' satisfies KYBStatus,
      }
    }

    const { data: updatedOrg, error: updateErr } = await adminClient
      .from('organizations')
      .update(orgUpdate)
      .eq('id', org_id)
      .select()
      .single()

    if (updateErr) {
      console.error('KYB decision error — organizations update:', updateErr)
      return NextResponse.json({ error: updateErr.message ?? 'Failed to update organization' }, { status: 500 })
    }

    // Fire-and-forget post-decision side-effects
    const isApproved = decision === 'approved' || decision === 'override_approved'
    const isRejected = decision === 'rejected'
    if (isApproved || isRejected) {
      ;(async () => {
        // Fetch all users in this org
        const { data: orgUsers } = await adminClient
          .from('users')
          .select('id, full_name')
          .eq('org_id', org_id)
        if (!orgUsers?.length) return

        // Fetch org name + type
        const { data: orgData } = await adminClient
          .from('organizations')
          .select('legal_name, org_type')
          .eq('id', org_id)
          .single()

        // Resolve each user's email via auth
        const authLookups = await Promise.all(
          orgUsers.map(u => adminClient.auth.admin.getUserById(u.id))
        )
        const usersWithEmail = orgUsers.map((u, i) => ({
          id:        u.id,
          full_name: u.full_name as string | null,
          email:     authLookups[i]?.data?.user?.email ?? '',
        })).filter(u => u.email)

        const orgName = (orgData?.legal_name as string | undefined) ?? 'your organization'

        if (isApproved) {
          // Find the accepted invitation to get program_id + anchor_org_id
          const emails = usersWithEmail.map(u => u.email)
          const { data: invitation } = await adminClient
            .from('invitations')
            .select('program_id, anchor_org_id, role')
            .eq('status', 'accepted')
            .in('email', emails)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (invitation?.program_id) {
            const anchorOrgId = invitation.role === 'anchor' ? org_id : (invitation.anchor_org_id ?? org_id)
            await adminClient
              .from('program_enrollments')
              .upsert(
                { program_id: invitation.program_id, org_id, anchor_org_id: anchorOrgId, status: 'active' },
                { onConflict: 'program_id,org_id' }
              )
          }

          // Send approval email to all users
          for (const u of usersWithEmail) {
            await sendEmail({
              to:      u.email,
              subject: `Your application to Strike SCF has been approved`,
              html:    kybApprovalEmailHtml({
                recipientName: u.full_name ?? u.email,
                orgName,
              }),
            })
          }
        } else {
          // Send rejection email to all users first
          for (const u of usersWithEmail) {
            await sendEmail({
              to:      u.email,
              subject: `Update on your Strike SCF application`,
              html:    kybRejectionEmailHtml({
                recipientName: u.full_name ?? u.email,
                orgName,
                reason: rejection_reason,
              }),
            })
          }

          // Delete all org-related records in dependency order
          await adminClient.from('credit_decision_records').delete().eq('org_id', org_id)
          await adminClient.from('credit_scores').delete().eq('org_id', org_id)
          await adminClient.from('documents').delete().eq('org_id', org_id)
          await adminClient.from('program_enrollments').delete().eq('org_id', org_id)
          await adminClient.from('users').delete().eq('org_id', org_id)

          // Delete auth users
          for (const u of orgUsers) {
            await adminClient.auth.admin.deleteUser(u.id)
          }

          // Delete the organization last
          await adminClient.from('organizations').delete().eq('id', org_id)
        }
      })().catch(err => console.error('KYB post-decision side-effects error:', err))
    }

    return NextResponse.json({ success: true, organization: updatedOrg })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    console.error('KYB decision error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
