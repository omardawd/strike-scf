import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: room } = await adminClient
    .from('rooms')
    .select('id, room_type, status')
    .eq('id', id)
    .single()

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.room_type !== 'public') return NextResponse.json({ error: 'Room is not public' }, { status: 403 })
  if (room.status !== 'active') return NextResponse.json({ error: 'Room is archived' }, { status: 403 })

  const { data: existing } = await adminClient
    .from('room_participants')
    .select('id')
    .eq('room_id', id)
    .eq('user_id', user.id)
    .single()

  if (existing) return NextResponse.json({ error: 'Already a participant' }, { status: 409 })

  const { error } = await adminClient
    .from('room_participants')
    .insert({
      room_id: id,
      user_id: user.id,
      org_id: userData.org_id || null,
      bank_id: userData.bank_id || null,
      role: 'participant',
    })

  if (error) return NextResponse.json({ error: 'Failed to join room' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
