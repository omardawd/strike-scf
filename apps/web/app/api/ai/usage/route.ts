import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DAILY_LIMITS: Record<string, number> = {
  chat: 50,
  insight: 200,
  document: 20,
  scoring: 500,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, bank_id, role')
    .eq('id', user.id)
    .single()

  if (!userRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isBank = userRow.role === 'bank_admin'

  const { data } = await adminClient
    .from('ai_usage')
    .select('feature, tokens_total, created_at')
    .eq(isBank ? 'bank_id' : 'user_id', isBank ? userRow.bank_id : userRow.id)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  const byFeature = (data ?? []).reduce(
    (acc, row) => {
      acc[row.feature] = acc[row.feature] ?? 0
      acc[row.feature] += row.tokens_total
      return acc
    }, {} as Record<string, number>)

  const total_tokens = Object.values(byFeature).reduce((a, b) => a + b, 0)

  return NextResponse.json({
    total_tokens,
    by_feature: byFeature,
    daily_limits: DAILY_LIMITS,
    period: '30d',
  })
}
