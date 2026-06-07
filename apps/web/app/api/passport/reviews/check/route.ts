import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/passport/reviews/check?deal_id={id}
// Returns { already_reviewed: boolean }
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ already_reviewed: false })

  const { searchParams } = new URL(request.url)
  const deal_id = searchParams.get('deal_id')
  if (!deal_id) {
    return NextResponse.json({ error: 'deal_id query parameter is required' }, { status: 400 })
  }

  const { data: existing } = await adminClient
    .from('passport_peer_reviews')
    .select('id')
    .eq('reviewing_org_id', me.org_id)
    .eq('deal_id', deal_id)
    .maybeSingle()

  return NextResponse.json({ already_reviewed: !!existing })
}
