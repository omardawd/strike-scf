import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const search   = searchParams.get('search')
  const sort     = searchParams.get('sort') ?? 'newest'

  let query = adminClient
    .from('rooms')
    .select('id, name, description, category, tags, rules, participant_count, message_count, last_message_at, created_at, status')
    .eq('room_type', 'public')
    .eq('status', 'active')

  if (category) query = query.eq('category', category)
  if (search)   query = query.ilike('name', `%${search}%`)

  if (sort === 'members') {
    query = query.order('participant_count', { ascending: false })
  } else if (sort === 'active') {
    query = query.order('last_message_at', { ascending: false, nullsFirst: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data: rooms, error } = await query

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  return NextResponse.json({ rooms: rooms ?? [] })
}
