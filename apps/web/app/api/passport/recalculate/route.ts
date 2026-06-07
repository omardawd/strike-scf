import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runPassportRecalculate } from '@/lib/passport'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/passport/recalculate  { org_id }
// Auth: x-strike-internal header OR the org user itself
export async function POST(request: Request) {
  const internalHeader = request.headers.get('x-strike-internal')
  const internalSecret = process.env.INTERNAL_SECRET
  const isInternal = Boolean(internalSecret && internalHeader === internalSecret)

  let body: { org_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  if (!isInternal) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: me } = await adminClient
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isOwnOrg = me.org_id === orgId
    const isStrikeAdmin = me.role === 'strike_admin'
    if (!isOwnOrg && !isStrikeAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const result = await runPassportRecalculate(orgId)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[passport/recalculate] failed:', e)
    return NextResponse.json({ error: 'Recalculation failed' }, { status: 500 })
  }
}
