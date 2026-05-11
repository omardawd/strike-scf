import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const adminClient = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError) {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  if (!userData.org_id) {
    return NextResponse.json({ org_id: null, kyb_status: null, org_status: null })
  }

  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    .select('kyb_status, status')
    .eq('id', userData.org_id)
    .single()

  if (orgError) {
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 })
  }

  return NextResponse.json({
    org_id: userData.org_id,
    kyb_status: org.kyb_status,
    org_status: org.status,
  })
}
