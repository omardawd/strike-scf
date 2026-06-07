import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/passport/[org_id]/view — record a passport view.
// Self-views (the org looking at its own passport) are not logged.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Skip self-views and viewers with no org/bank identity (e.g. strike_admin).
  if (me.org_id === org_id) {
    return NextResponse.json({ success: true, skipped: 'self' })
  }
  if (!me.org_id && !me.bank_id) {
    return NextResponse.json({ success: true, skipped: 'no_viewer_identity' })
  }

  const { error } = await adminClient
    .from('passport_views')
    .insert({
      viewed_org_id: org_id,
      viewer_org_id: me.org_id ?? null,
      viewer_bank_id: me.bank_id ?? null,
      context: 'general',
    })

  if (error) {
    // A failed view log should never break the page that triggered it.
    console.error('[passport/view] insert error:', error)
    return NextResponse.json({ success: false }, { status: 200 })
  }

  return NextResponse.json({ success: true })
}
