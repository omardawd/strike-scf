import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('bank_id')
    .eq('id', user.id)
    .single()

  if (!userRow?.bank_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: recs } = await adminClient
    .from('recommendations')
    .select('*')
    .eq('bank_id', userRow.bank_id)
    .eq('dismissed', false)
    .eq('actioned', false)

  const recommendations = (recs ?? []).sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 0
    const pb = PRIORITY_ORDER[b.priority] ?? 0
    if (pb !== pa) return pb - pa
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const counts = {
    high: recommendations.filter(r => r.priority === 'high').length,
    medium: recommendations.filter(r => r.priority === 'medium').length,
    low: recommendations.filter(r => r.priority === 'low').length,
    total: recommendations.length,
  }

  return NextResponse.json({ recommendations, counts })
}
