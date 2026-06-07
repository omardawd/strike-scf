import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { KybStatus, OrgStatus, RiskTier } from '@strike-scf/types'

type CreditDecision = 'approved' | 'override_approved' | 'more_info_requested' | 'rejected' | 'pending_countersign'
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
    .select('id, role, bank_id, full_name')
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
    console.error('[KYB decision] body:', { decision, org_id, risk_tier, credit_score })

    // Resolve or create a credit_score row so credit_score_id is never null
    let creditScoreId: string | null = null
    let scoreValue = credit_score ?? org.credit_score ?? 0
    let tierValue: string = risk_tier ?? org.risk_tier ?? 'C'

    if (credit_score !== undefined) {
      const { data: newScore, error: scoreErr } = await adminClient
        .from('credit_scores')
        .insert({ org_id, total_score: credit_score, risk_tier: risk_tier ?? null })
        .select('id, total_score, risk_tier')
        .single()
      if (scoreErr || !newScore) {
        console.error('[KYB decision] credit_scores insert error:', scoreErr)
        return NextResponse.json({ error: scoreErr?.message ?? 'Failed to save credit score' }, { status: 500 })
      }
      creditScoreId = newScore.id
      scoreValue = newScore.total_score
      tierValue = newScore.risk_tier ?? tierValue
    } else {
      const { data: existing } = await adminClient
        .from('credit_scores')
        .select('id, total_score, risk_tier')
        .eq('org_id', org_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        creditScoreId = existing.id
        scoreValue = existing.total_score
        tierValue = existing.risk_tier ?? tierValue
      } else {
        // No score exists — create minimal placeholder for any decision type
        const { data: minScore, error: minScoreErr } = await adminClient
          .from('credit_scores')
          .insert({ org_id, total_score: 0, risk_tier: risk_tier ?? 'C' })
          .select('id, total_score, risk_tier')
          .single()
        if (minScoreErr) {
          console.error('[KYB decision] minimal credit_score insert error:', minScoreErr)
        } else if (minScore) {
          creditScoreId = minScore.id
          scoreValue = minScore.total_score
          tierValue = minScore.risk_tier ?? tierValue
        }
      }
    }

    console.error('[KYB decision] resolved creditScoreId:', creditScoreId, 'decision:', decision)

    // Insert decision record
    const decisionInsert: Record<string, unknown> = {
      org_id,
      decision,
      decided_by_user_id: user.id,
      decided_by_user_name: me.full_name ?? null,
      score_at_decision: scoreValue,
      risk_tier_at_decision: tierValue,
      override_reason: override_reason ?? null,
      rejection_reason: rejection_reason ?? null,
      info_request_message: info_request_message ?? null,
    }
    if (creditScoreId) decisionInsert.credit_score_id = creditScoreId

    const { error: decisionErr } = await adminClient
      .from('credit_decision_records')
      .insert(decisionInsert)

    if (decisionErr) {
      console.error('[KYB reject] credit_decision_records insert error:', decisionErr)
      return NextResponse.json({ error: decisionErr.message ?? 'Failed to record decision' }, { status: 500 })
    }

    // Derive org status updates
    let orgUpdate: Record<string, unknown> = {}
    if (decision === 'approved' || decision === 'override_approved') {
      orgUpdate = {
        status: 'active' satisfies OrgStatus,
        kyb_status: 'approved' satisfies KybStatus,
        credit_reviewed_at: new Date().toISOString(),
        ...(risk_tier !== undefined && { risk_tier }),
        ...(credit_score !== undefined && { credit_score }),
      }
    } else if (decision === 'rejected') {
      orgUpdate = {
        status: 'rejected' satisfies OrgStatus,
        kyb_status: 'rejected' satisfies KybStatus,
        credit_reviewed_at: new Date().toISOString(),
      }
    } else if (decision === 'more_info_requested') {
      orgUpdate = {
        kyb_status: 'more_info_requested' satisfies KybStatus,
      }
    } else if (decision === 'pending_countersign') {
      orgUpdate = {
        kyb_status: 'under_review' satisfies KybStatus,
      }
    }

    const { data: updatedOrg, error: updateErr } = await adminClient
      .from('organizations')
      .update(orgUpdate)
      .eq('id', org_id)
      .select()
      .single()

    if (updateErr) {
      console.error('[KYB reject] organizations update error:', updateErr)
      return NextResponse.json({ error: updateErr.message ?? 'Failed to update organization' }, { status: 500 })
    }

    const isApproved = decision === 'approved' || decision === 'override_approved'
    const isRejected = decision === 'rejected'

    // ── Enrollment creation (synchronous — must complete before returning) ──
    if (isApproved) {
      // Fetch users in this org; email is in public.users, fall back to auth if null
      const { data: orgUsersRaw } = await adminClient
        .from('users')
        .select('id, full_name, email')
        .eq('org_id', org_id)

      const usersWithEmail: Array<{ id: string; full_name: string | null; email: string }> = []
      await Promise.all(
        (orgUsersRaw ?? []).map(async (u) => {
          let email = u.email as string | null
          if (!email) {
            const { data: authUser } = await adminClient.auth.admin.getUserById(u.id)
            email = authUser?.user?.email ?? null
          }
          if (email) usersWithEmail.push({ id: u.id, full_name: u.full_name as string | null, email })
        })
      )

      const emails = usersWithEmail.map(u => u.email)
      if (emails.length > 0) {
        const { data: invitations } = await adminClient
          .from('invitations')
          .select('program_id, anchor_org_id, role')
          .in('status', ['accepted', 'pending'])
          .in('email', emails)

        for (const invitation of (invitations ?? [])) {
          if (!invitation.program_id) continue
          const anchorOrgId = invitation.role === 'anchor'
            ? org_id
            : (invitation.anchor_org_id ?? org_id)

          // Check if enrollment already exists to avoid relying on a unique constraint
          const { data: existingEnroll } = await adminClient
            .from('program_enrollments')
            .select('id')
            .eq('program_id', invitation.program_id)
            .eq('org_id', org_id)
            .maybeSingle()

          if (existingEnroll) {
            const { error: updateErr } = await adminClient
              .from('program_enrollments')
              .update({ status: 'active', anchor_org_id: anchorOrgId, enrolled_by_user_id: user.id })
              .eq('id', existingEnroll.id)
            if (updateErr) console.error('Enrollment update error:', updateErr)
          } else {
            const { error: insertErr } = await adminClient
              .from('program_enrollments')
              .insert({
                program_id:          invitation.program_id,
                org_id,
                anchor_org_id:       anchorOrgId,
                status:              'active',
                enrolled_by_user_id: user.id,
              })
            if (insertErr) console.error('Enrollment insert error:', insertErr)
          }
        }
      }
    }

    // ── Fire-and-forget: emails + rejection cleanup ────────────────────────
    if (isApproved || isRejected) {
      ;(async () => {
        const [{ data: orgUsers }, { data: orgData }] = await Promise.all([
          adminClient.from('users').select('id, full_name, email').eq('org_id', org_id),
          adminClient.from('organizations').select('legal_name, type').eq('id', org_id).single(),
        ])
        if (!orgUsers?.length) return

        const usersWithEmail: Array<{ id: string; full_name: string | null; email: string }> = []
        await Promise.all(
          orgUsers.map(async (u) => {
            let email = u.email as string | null
            if (!email) {
              const { data: authUser } = await adminClient.auth.admin.getUserById(u.id)
              email = authUser?.user?.email ?? null
            }
            if (email) usersWithEmail.push({ id: u.id, full_name: u.full_name as string | null, email })
          })
        )

        const orgName = (orgData?.legal_name as string | undefined) ?? 'your organization'

        if (isApproved) {
          for (const u of usersWithEmail) {
            await sendEmail({
              to:      u.email,
              subject: `Your application to Strike SCF has been approved`,
              html:    kybApprovalEmailHtml({ recipientName: u.full_name ?? u.email, orgName }),
            })
          }
        } else {
          for (const u of usersWithEmail) {
            await sendEmail({
              to:      u.email,
              subject: `Update on your Strike SCF application`,
              html:    kybRejectionEmailHtml({ recipientName: u.full_name ?? u.email, orgName, reason: rejection_reason }),
            })
          }
        }
      })().catch(err => console.error('KYB post-decision side-effects error:', err))
    }

    return NextResponse.json({ success: true, organization: updatedOrg })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Decision failed'
    console.error('[KYB decision] caught:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
