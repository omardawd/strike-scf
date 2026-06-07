import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  const body = await req.json()
  if (body.action !== 'remove') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const { error } = await adminClient
    .from('room_messages')
    .update({ status: 'removed', moderated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Failed to remove message' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
