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

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (userData.role !== 'strike_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: reports, error } = await adminClient
    .from('room_reports')
    .select('id, room_id, message_id, reason, reported_by_user_id, created_at, resolved')
    .eq('resolved', false)
    .order('created_at', { ascending: true })

  if (error) {
    // Table may not exist yet — return empty array gracefully
    return NextResponse.json({ reports: [] })
  }

  if (!reports || reports.length === 0) {
    return NextResponse.json({ reports: [] })
  }

  // Enrich with room names, message content, reporter name
  const roomIds    = [...new Set(reports.map((r: any) => r.room_id).filter(Boolean))]
  const messageIds = [...new Set(reports.map((r: any) => r.message_id).filter(Boolean))]
  const userIds    = [...new Set(reports.map((r: any) => r.reported_by_user_id).filter(Boolean))]

  const [roomsRes, messagesRes, usersRes] = await Promise.all([
    roomIds.length > 0
      ? adminClient.from('rooms').select('id, name').in('id', roomIds)
      : Promise.resolve({ data: [] }),
    messageIds.length > 0
      ? adminClient.from('room_messages').select('id, content').in('id', messageIds)
      : Promise.resolve({ data: [] }),
    userIds.length > 0
      ? adminClient.from('users').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] }),
  ])

  const roomMap: Record<string, string> = {}
  ;(roomsRes.data ?? []).forEach((r: any) => { roomMap[r.id] = r.name })

  const msgMap: Record<string, string> = {}
  ;(messagesRes.data ?? []).forEach((m: any) => { msgMap[m.id] = m.content })

  const userMap: Record<string, string> = {}
  ;(usersRes.data ?? []).forEach((u: any) => { userMap[u.id] = u.full_name || u.email || u.id })

  const enriched = reports.map((r: any) => ({
    ...r,
    room_name: r.room_id ? (roomMap[r.room_id] ?? 'Unknown Room') : 'Unknown Room',
    message_content: r.message_id ? (msgMap[r.message_id] ?? '') : '',
    reported_by_name: r.reported_by_user_id ? (userMap[r.reported_by_user_id] ?? 'Unknown') : 'Unknown',
  }))

  return NextResponse.json({ reports: enriched })
}
