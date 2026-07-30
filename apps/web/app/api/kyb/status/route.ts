import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/kyb/status — the signed-in org's own KYB/Passport status, org-scoped
// via the caller's own org_id. Backs the platform-access gate's status page:
// not_started/in_progress → prompt to complete onboarding; submitted/under_review →
// "reviewing" summary; more_info_requested → message + doc checklist; rejected →
// reason. Never accepts an org_id param — always the caller's own org.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'No organization' }, { status: 400 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type, business_type, country_of_incorporation, industry_naics, years_in_operation, primary_contact_name, primary_contact_email, kyb_status, kyb_submitted_at, passport_score')
    .eq('id', userData.org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  let moreInfo: { message: string | null; requested_documents: string[]; requested_at: string | null; uploaded_document_kinds: string[] } | null = null
  let rejection: { reason: string | null; decided_at: string } | null = null

  if (org.kyb_status === 'more_info_requested') {
    const [{ data: decision }, { data: existingDocs }] = await Promise.all([
      adminClient
        .from('credit_decision_records')
        .select('info_request_message, requested_documents, created_at')
        .eq('org_id', userData.org_id)
        .eq('decision', 'more_info_requested')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      adminClient
        .from('documents')
        .select('document_kind')
        .eq('entity_type', 'organization')
        .eq('entity_id', userData.org_id),
    ])
    moreInfo = {
      message: decision?.info_request_message ?? null,
      requested_documents: decision?.requested_documents ?? [],
      requested_at: decision?.created_at ?? null,
      uploaded_document_kinds: Array.from(new Set((existingDocs ?? []).map(d => d.document_kind).filter(Boolean))),
    }
  }

  if (org.kyb_status === 'rejected') {
    const { data: decision } = await adminClient
      .from('credit_decision_records')
      .select('rejection_reason, created_at')
      .eq('org_id', userData.org_id)
      .eq('decision', 'rejected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    rejection = { reason: decision?.rejection_reason ?? null, decided_at: decision?.created_at ?? new Date().toISOString() }
  }

  return NextResponse.json({ organization: org, more_info: moreInfo, rejection })
}

// POST /api/kyb/status — org resubmits after addressing a more-info request.
// Moves kyb_status back to 'under_review' so it re-enters the Strike Admin
// KYB Escalation Queue (which only ever queries kyb_status='under_review').
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'No organization' }, { status: 400 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, kyb_status')
    .eq('id', userData.org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  if (org.kyb_status !== 'more_info_requested') {
    return NextResponse.json({ error: 'No outstanding information request' }, { status: 400 })
  }

  await adminClient
    .from('organizations')
    .update({ kyb_status: 'under_review', kyb_submitted_at: new Date().toISOString() })
    .eq('id', userData.org_id)

  const { data: admins } = await adminClient.from('users').select('id').eq('role', 'strike_admin')
  if (admins?.length) {
    const orgName = org.doing_business_as || org.legal_name || 'An organization'
    await adminClient.from('notifications').insert(
      admins.map((a: { id: string }) => ({
        user_id: a.id,
        event: 'kyb_resubmitted',
        title: 'Application resubmitted',
        body: `${orgName} responded to your information request and is back in the KYB queue.`,
        deep_link: `/admin/kyb/${userData.org_id}`,
        read: false,
      }))
    )
  }

  return NextResponse.json({ ok: true })
}
