import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
  const ORG_ROLES  = ['org_admin', 'org_member']

  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', org_id)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (BANK_ROLES.includes(me.role)) {
    if (org.bank_id !== me.bank_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (ORG_ROLES.includes(me.role)) {
    if (me.org_id !== org_id) {
      // Any org can be enrolled as the anchor over another org on one program
      // and as a member under a different anchor on another — check both
      // directions of the relationship rather than picking one via org-level
      // type, and preserve the original asymmetric response shape (an anchor
      // viewing its supplier gets the full downstream view below; a member
      // viewing its anchor gets a restricted summary with no documents/credit
      // score).

      // Direction A: target org is enrolled under the caller as anchor —
      // caller is viewing "their" supplier's KYB.
      const { data: enrollmentAsAnchor } = await adminClient
        .from('program_enrollments')
        .select('id')
        .eq('anchor_org_id', me.org_id)
        .eq('org_id', org_id)
        .limit(1)
        .maybeSingle()

      let callerIsAnchorOfTarget = !!enrollmentAsAnchor
      if (!callerIsAnchorOfTarget) {
        // Fall back to invitation link (supplier accepted but enrollment not yet created)
        const { data: orgUsers } = await adminClient
          .from('users')
          .select('email')
          .eq('org_id', org_id)

        const emails = (orgUsers ?? []).map((u: { email: string | null }) => u.email).filter(Boolean) as string[]
        if (emails.length > 0) {
          const { data: inv } = await adminClient
            .from('invitations')
            .select('id')
            .eq('anchor_org_id', me.org_id)
            .in('email', emails)
            .in('status', ['pending', 'accepted'])
            .limit(1)
            .maybeSingle()
          callerIsAnchorOfTarget = !!inv
        }
      }

      if (!callerIsAnchorOfTarget) {
        // Direction B: caller is enrolled under the target org as anchor —
        // caller is viewing "their" anchor's KYB (restricted view).
        const { data: enrollmentAsMember } = await adminClient
          .from('program_enrollments')
          .select('id')
          .eq('anchor_org_id', org_id)
          .eq('org_id', me.org_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()

        if (!enrollmentAsMember) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        return NextResponse.json({
          organization: {
            id:                    org.id,
            legal_name:            org.legal_name,
            city:                  org.city ?? null,
            state:                 org.state ?? null,
            primary_contact_name:  org.primary_contact_name ?? null,
            primary_contact_email: org.primary_contact_email ?? null,
            kyb_status:            org.kyb_status,
            created_at:            org.created_at,
            doing_business_as:     org.doing_business_as ?? null,
            industry_naics:        org.industry_naics ?? null,
          },
          documents:    [],
          credit_score: null,
        })
      }
      // else: callerIsAnchorOfTarget — fall through to the shared full-view logic below.
    }
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isBankCaller = BANK_ROLES.includes(me.role)

  const [{ data: rawDocs }, { data: credit_score }, { data: latest_decision }] = await Promise.all([
    isBankCaller
      ? adminClient
          .from('documents')
          .select('id, name, document_kind, storage_path, mime_type, created_at')
          .eq('entity_type', 'organization')
          .eq('entity_id', org_id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    adminClient
      .from('credit_scores')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('credit_decision_records')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const documents = isBankCaller
    ? await Promise.all(
        (rawDocs ?? []).map(async (doc: Record<string, unknown>) => {
          const { data: signed } = await adminClient.storage
            .from('kyb-documents')
            .createSignedUrl(doc.storage_path as string, 3600)
          return { ...doc, signed_url: signed?.signedUrl ?? null }
        })
      )
    : []

  return NextResponse.json({ organization: org, documents, credit_score, latest_decision })
}
