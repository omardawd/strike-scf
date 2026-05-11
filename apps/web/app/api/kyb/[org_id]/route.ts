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
    .select('role, bank_id')
    .eq('id', user.id)
    .single()

  if (!me || (me.role !== 'bank_admin' && me.role !== 'bank_credit_officer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', org_id)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (org.bank_id !== me.bank_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: rawDocs }, { data: credit_score }, { data: latest_decision }] = await Promise.all([
    adminClient
      .from('documents')
      .select('*')
      .eq('entity_type', 'kyb')
      .eq('entity_id', org_id)
      .order('created_at', { ascending: false }),
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

  const documents = await Promise.all(
    (rawDocs ?? []).map(async (doc: Record<string, unknown>) => {
      const { data: signed } = await adminClient.storage
        .from('kyb-documents')
        .createSignedUrl(doc.storage_path as string, 3600)
      return { ...doc, signed_url: signed?.signedUrl ?? null }
    })
  )

  return NextResponse.json({ organization: org, documents, credit_score, latest_decision })
}
