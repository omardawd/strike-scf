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
    .select('id, email, full_name, job_title, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({ user: userData })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.full_name  !== undefined) update.full_name  = String(body.full_name)
  if (body.job_title  !== undefined) update.job_title  = String(body.job_title)
  update.updated_at = new Date().toISOString()

  if (!body.full_name && body.job_title === undefined && Object.keys(update).length <= 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: userData, error } = await adminClient
    .from('users')
    .update(update)
    .eq('id', user.id)
    .select('id, email, full_name, job_title, role, bank_id, org_id')
    .single()

  if (error) {
    console.error('Profile update error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  return NextResponse.json({ user: userData })
}
