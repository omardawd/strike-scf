// Quick Stats for the Strike Place sidebar — platform-wide marketplace
// activity (listings count is already computed client-side from the
// listings search response; this covers the other three).
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ count: activeDeals }, { count: orgCount }, { data: dealValues }] = await Promise.all([
    adminClient
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('deal_source', 'marketplace')
      .not('status', 'in', '(completed,cancelled)'),
    adminClient
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('network_visible', true),
    adminClient
      .from('deals')
      .select('total_value, agreed_price')
      .eq('deal_source', 'marketplace')
      .neq('status', 'cancelled'),
  ])

  const volume = (dealValues ?? []).reduce((sum, d) => sum + Number(d.total_value ?? d.agreed_price ?? 0), 0)

  return NextResponse.json({
    active_deals: activeDeals ?? 0,
    orgs: orgCount ?? 0,
    volume,
  })
}
