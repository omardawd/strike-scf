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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('bank_id')
    .eq('id', user.id)
    .single()

  if (!userRow?.bank_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { action } = await req.json()

  const { data: rec } = await adminClient
    .from('recommendations')
    .select('id, bank_id')
    .eq('id', id)
    .single()

  if (!rec || rec.bank_id !== userRow.bank_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update = action === 'dismiss'
    ? { dismissed: true }
    : action === 'action'
      ? { actioned: true }
      : null

  if (!update) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  await adminClient.from('recommendations').update(update).eq('id', id)

  return NextResponse.json({ success: true })
}
