import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const { data: agent } = await adminClient
    .from('org_agents')
    .select('*')
    .eq('org_id', userData.org_id)
    .maybeSingle()

  return NextResponse.json({ agent: agent ?? null })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No org' }, { status: 400 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const allowed = ['name', 'persona', 'goals']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data: existing } = await adminClient
    .from('org_agents')
    .select('id')
    .eq('org_id', userData.org_id)
    .maybeSingle()

  let agent
  if (existing) {
    const { data } = await adminClient
      .from('org_agents')
      .update(updates)
      .eq('org_id', userData.org_id)
      .select()
      .single()
    agent = data
  } else {
    const { data } = await adminClient
      .from('org_agents')
      .insert({ org_id: userData.org_id, ...updates })
      .select()
      .single()
    agent = data
  }

  return NextResponse.json({ agent })
}
