import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q.length < 2) return NextResponse.json({ organizations: [] })

  const { data: orgs, error } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, country')
    .eq('network_visible', true)
    .eq('status', 'active')
    .or(`legal_name.ilike.%${q}%,doing_business_as.ilike.%${q}%`)
    .limit(8)

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ organizations: orgs ?? [] })
}
