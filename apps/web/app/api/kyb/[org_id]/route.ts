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
  const ORG_ROLES  = ['anchor_admin', 'anchor_member', 'supplier_admin', 'supplier_member']

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
      // Anchors may view KYB for suppliers linked to them
      if (me.role === 'anchor_admin' || me.role === 'anchor_member') {
        const { data: enrollment } = await adminClient
          .from('program_enrollments')
          .select('id')
          .eq('anchor_org_id', me.org_id)
          .eq('org_id', org_id)
          .limit(1)
          .maybeSingle()

        if (!enrollment) {
          // Fall back to invitation link (supplier accepted but enrollment not yet created)
          const { data: orgUsers } = await adminClient
            .from('users')
            .select('email')
            .eq('org_id', org_id)

          const emails = (orgUsers ?? []).map((u: { email: string | null }) => u.email).filter(Boolean) as string[]
          let linked = false
          if (emails.length > 0) {
            const { data: inv } = await adminClient
              .from('invitations')
              .select('id')
              .eq('anchor_org_id', me.org_id)
              .in('email', emails)
              .in('status', ['pending', 'accepted'])
              .limit(1)
              .maybeSingle()
            linked = !!inv
          }
          if (!linked) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else if (me.role === 'supplier_admin' || me.role === 'supplier_member') {
        if (org.type !== 'anchor') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const { data: enrollment } = await adminClient
          .from('program_enrollments')
          .select('id')
          .eq('anchor_org_id', org_id)
          .eq('org_id', me.org_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()
        if (!enrollment) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        return NextResponse.json({
          organization: {
            id:                    org.id,
            legal_name:            org.legal_name,
            type:                  org.type,
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
      } else {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isBankCaller = BANK_ROLES.includes(me.role)

  const [{ data: rawDocs }, { data: credit_score }, { data: latest_decision }] = await Promise.all([
    isBankCaller
      ? adminClient
          .from('documents')
          .select('id, name, document_kind, storage_path, mime_type, size_bytes, created_at, uploaded_by_user_id')
          .eq('entity_type', 'kyb')
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
