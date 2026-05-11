import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: notification } = await adminClient
    .from('notifications')
    .select('user_id')
    .eq('id', id)
    .single()

  if (!notification) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (notification.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await adminClient
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
