import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sanitizeSearchTerm } from '@/lib/search'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isOrgAdmitted } from '@/lib/auth/admission'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limitResult = await rateLimit(`org-search:${user.id}`, 30, 60_000)
  if (!limitResult.allowed) {
    return rateLimitResponse(limitResult)
  }

  // Admission gate: a non-admitted org cannot discover other orgs either —
  // banks/strike_admin have no org_id and are unaffected.
  const { data: me } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  if (me?.org_id) {
    const { data: myOrg } = await adminClient
      .from('organizations')
      .select('status, kyb_status')
      .eq('id', me.org_id)
      .single()
    if (!isOrgAdmitted(myOrg)) {
      return NextResponse.json({ organizations: [] })
    }
  }

  const { searchParams } = new URL(request.url)
  const q = sanitizeSearchTerm(searchParams.get('q') ?? '')

  if (q.length < 2) return NextResponse.json({ organizations: [] })

  const { data: orgs, error } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, country')
    .eq('network_visible', true)
    .eq('status', 'active')
    .eq('kyb_status', 'approved')
    .or(`legal_name.ilike.%${q}%,doing_business_as.ilike.%${q}%`)
    .limit(8)

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ organizations: orgs ?? [] })
}
