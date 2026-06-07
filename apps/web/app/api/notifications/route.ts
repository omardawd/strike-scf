import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const unreadOnly = searchParams.get('unread_only') === 'true'
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100)

  let query = adminClient
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) query = query.eq('read', false)

  const { data: notifications } = await query

  const all = notifications ?? []
  const unread_count = all.filter((n: Record<string, unknown>) => !n.read).length

  return NextResponse.json({ notifications: all, unread_count })
}
