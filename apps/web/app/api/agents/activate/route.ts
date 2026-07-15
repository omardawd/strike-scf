import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
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

  const { active } = await req.json().catch(() => ({}))
  const isActive = typeof active === 'boolean' ? active : true

  const { data: existing } = await adminClient
    .from('org_agents')
    .select('id, is_active')
    .eq('org_id', userData.org_id)
    .maybeSingle()

  let agent
  if (existing) {
    const { data } = await adminClient
      .from('org_agents')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('org_id', userData.org_id)
      .select()
      .single()
    agent = data
  } else {
    const { data } = await adminClient
      .from('org_agents')
      .insert({ org_id: userData.org_id, is_active: isActive })
      .select()
      .single()
    agent = data
  }

  // Return the org's dispatch token so the user can reference it
  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('dispatch_token')
    .eq('org_id', userData.org_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    agent,
    dispatch_token: conn?.dispatch_token ?? null,
    message: isActive ? 'Agent activated.' : 'Agent deactivated.',
  })
}
