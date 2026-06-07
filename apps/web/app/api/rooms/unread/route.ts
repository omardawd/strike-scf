import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/rooms/unread
// Returns { unread_rooms } — the number of rooms the current user has joined
// that contain at least one visible message newer than their last_read_at.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // Rooms this user participates in, with their personal last_read_at.
  const { data: parts } = await adminClient
    .from('room_participants')
    .select('room_id, last_read_at')
    .eq('user_id', user.id)

  const participations = parts ?? []
  if (participations.length === 0) {
    return NextResponse.json({ unread_rooms: 0 })
  }

  const roomIds = participations.map((p: any) => p.room_id)

  // Latest visible message timestamp per room (single scoped query, then reduce).
  const { data: msgs } = await adminClient
    .from('room_messages')
    .select('room_id, created_at')
    .in('room_id', roomIds)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })

  const latestByRoom: Record<string, string> = {}
  ;(msgs ?? []).forEach((m: any) => {
    if (!latestByRoom[m.room_id]) latestByRoom[m.room_id] = m.created_at
  })

  let unreadRooms = 0
  for (const p of participations) {
    const latest = latestByRoom[p.room_id]
    if (!latest) continue
    // No last_read_at yet → any message counts as unread.
    if (!p.last_read_at || new Date(latest).getTime() > new Date(p.last_read_at).getTime()) {
      unreadRooms += 1
    }
  }

  return NextResponse.json({ unread_rooms: unreadRooms })
}
