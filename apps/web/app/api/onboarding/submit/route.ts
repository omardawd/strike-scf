import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { KybStatus, OrgStatus, BankStatus } from '@strike-scf/types'
import { runKybAiReview } from '@/lib/kyb-review'
import { evaluateSupplierPassport } from '@/lib/ai/tools/handlers/evaluate-supplier-passport'

const adminClient = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface SubmitBody {
  org_id?: string
  bank_id?: string
  bank_account_last4?: string
  bank_routing_number?: string
  bank_account_type?: 'checking' | 'savings'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SubmitBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { org_id, bank_id, bank_account_last4, bank_routing_number, bank_account_type } = body

  // ── Bank flow ────────────────────────────────────────────────
  if (bank_id) {
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('bank_id')
      .eq('id', user.id)
      .single()

    if (userError) {
      return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
    }

    if (!userData || userData.bank_id !== bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: bankUpdateError } = await adminClient
      .from('banks')
      .update({ status: 'active' satisfies BankStatus })
      .eq('id', bank_id)

    if (bankUpdateError) {
      return NextResponse.json({ error: 'Failed to activate bank' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }

  // ── Supplier / Anchor flow ───────────────────────────────────
  if (!org_id) {
    return NextResponse.json({ error: 'org_id or bank_id is required' }, { status: 400 })
  }

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError) {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  if (userData.org_id !== org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── AUTH-CRITICAL: platform UNLOCK happens HERE, on SUBMISSION (TD.4) ──────────
  // The org becomes network-visible and gets an initial PassportScore the moment
  // it submits — NOT on later bank/AI approval. This removes the approval
  // bottleneck. We set these synchronously so the unlock is guaranteed even if the
  // async AI review below fails. Strike Admin can still flag/suspend later.
  //   kyb_status     -> 'submitted'  (gate checks kyb_status !== 'not_started')
  //   network_visible -> true        (org now appears in counterparty queries)
  const { error: updateError } = await adminClient
    .from('organizations')
    .update({
      kyb_status: 'submitted' satisfies KybStatus,
      kyb_submitted_at: new Date().toISOString(),
      status: 'kyb_submitted' satisfies OrgStatus,
      network_visible: true,
      ...(bank_account_last4 !== undefined && { bank_account_last4 }),
      ...(bank_routing_number !== undefined && { bank_routing_number }),
      ...(bank_account_type !== undefined && { bank_account_type }),
    })
    .eq('id', org_id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 })
  }

  // Compute the INITIAL PassportScore immediately via /api/risk/score. The risk
  // route writes `risk_score` on the org; we mirror it into `passport_score`. With
  // KYB just submitted (unverified) the score lands in the ~20–45 band — expected.
  // Best-effort: a failure here must not block submission (the async AI review
  // below also produces a score), so we swallow errors.
  try {
    const origin = new URL(request.url).origin
    const cookie = request.headers.get('cookie') ?? ''
    const scoreRes = await fetch(`${origin}/api/risk/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ org_id }),
    })
    if (scoreRes.ok) {
      const scoreData = await scoreRes.json() as { risk_score?: number }
      if (typeof scoreData.risk_score === 'number') {
        await adminClient
          .from('organizations')
          .update({
            passport_score: scoreData.risk_score,
            passport_score_updated_at: new Date().toISOString(),
          })
          .eq('id', org_id)
      }
    }
  } catch (err) {
    console.error('[onboarding/submit] initial risk/score failed (non-fatal):', err)
  }

  // Kick off the AI KYB review → enriches the Passport (refined score + narrative),
  // writes credit_scores / agent_actions, and emails the applicant. Fired
  // non-blocking so the applicant isn't held on the AI call. This NEVER reverts the
  // unlock above: it only sets network_visible (to true) on approval, and only ever
  // moves kyb_status forward to 'under_review'/'approved' — all unlocked states.
  runKybAiReview(org_id, { triggeredByUserId: user.id }).catch(err =>
    console.error('[onboarding/submit] KYB AI review failed:', err)
  )

  // After KYB review kicks off, fire the AI passport evaluation. This uses Claude
  // sonnet to holistically score the org and writes the result back to
  // organizations.passport_score. Runs non-blocking after a short delay so the
  // KYB review has a moment to write its credit_scores row first.
  setTimeout(() => {
    evaluateSupplierPassport({
      supplier_org_id: org_id,
      evaluation_purpose: 'network_onboarding',
    }).catch(err =>
      console.error('[onboarding/submit] AI passport evaluation failed:', err)
    )
  }, 3000)

  // Auto-enroll invited supplier in their program if not already enrolled
  const programId   = user.user_metadata?.program_id as string | undefined
  const anchorOrgId = user.user_metadata?.anchor_org_id as string | undefined
  if (programId && userData.org_id) {
    const { data: existingEnrollment } = await adminClient
      .from('program_enrollments')
      .select('id')
      .eq('program_id', programId)
      .eq('org_id', userData.org_id)
      .maybeSingle()

    if (!existingEnrollment) {
      let resolvedAnchorId = anchorOrgId
      if (!resolvedAnchorId) {
        const { data: inv } = await adminClient
          .from('invitations')
          .select('anchor_org_id')
          .eq('program_id', programId)
          .eq('email', user.email!)
          .in('status', ['accepted', 'pending'])
          .limit(1)
          .maybeSingle()
        resolvedAnchorId = inv?.anchor_org_id
      }
      if (resolvedAnchorId) {
        await adminClient
          .from('program_enrollments')
          .insert({
            program_id:          programId,
            org_id:              userData.org_id,
            anchor_org_id:       resolvedAnchorId,
            enrolled_by_user_id: user.id,
            status:              'active',
            enrolled_at:         new Date().toISOString(),
          })
      }
    }
  }

  return NextResponse.json({ success: true })
}
