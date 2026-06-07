import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getOrgUser(request?: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: me } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()
  return me ?? null
}

// GET /api/settings/agent — returns all agent_preferences for current org
export async function GET() {
  const me = await getOrgUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ error: 'Org users only' }, { status: 403 })

  const { data: preferences, error } = await adminClient
    .from('agent_preferences')
    .select('*')
    .eq('org_id', me.org_id)
    .order('preference_type')

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ preferences: preferences ?? [] })
}

// POST /api/settings/agent — upsert a single preference
export async function POST(request: Request) {
  const me = await getOrgUser(request)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ error: 'Org users only' }, { status: 403 })

  let body: { preference_type?: string; value?: unknown; is_active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { preference_type, value, is_active } = body
  if (!preference_type) {
    return NextResponse.json({ error: 'preference_type is required' }, { status: 400 })
  }
  if (value === undefined) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Check if a preference of this type already exists for this org
  const { data: existing } = await adminClient
    .from('agent_preferences')
    .select('id')
    .eq('org_id', me.org_id)
    .eq('preference_type', preference_type)
    .maybeSingle()

  let preference: unknown
  if (existing?.id) {
    const { data: updated, error } = await adminClient
      .from('agent_preferences')
      .update({
        value,
        is_active: is_active !== false,
        set_by_user_id: me.id,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    preference = updated
  } else {
    const { data: created, error } = await adminClient
      .from('agent_preferences')
      .insert({
        org_id: me.org_id,
        preference_type,
        value,
        is_active: is_active !== false,
        set_by_user_id: me.id,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
    preference = created
  }

  return NextResponse.json({ preference })
}
