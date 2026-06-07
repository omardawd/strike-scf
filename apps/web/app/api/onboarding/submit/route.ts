import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { KybStatus, OrgStatus, BankStatus } from '@strike-scf/types'
import { runKybAiReview } from '@/app/api/kyb/ai-review/route'

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

  const { error: updateError } = await adminClient
    .from('organizations')
    .update({
      kyb_status: 'submitted' satisfies KybStatus,
      kyb_submitted_at: new Date().toISOString(),
      status: 'kyb_submitted' satisfies OrgStatus,
      ...(bank_account_last4 !== undefined && { bank_account_last4 }),
      ...(bank_routing_number !== undefined && { bank_routing_number }),
      ...(bank_account_type !== undefined && { bank_account_type }),
    })
    .eq('id', org_id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 })
  }

  // Kick off the AI KYB review → generates the Passport (score + narrative),
  // writes credit_scores / agent_actions, and emails the applicant. Fired
  // non-blocking so the applicant isn't held on the AI call.
  runKybAiReview(org_id, { triggeredByUserId: user.id }).catch(err =>
    console.error('[onboarding/submit] KYB AI review failed:', err)
  )

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
