import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { getPreset, deletePreset } from '@/lib/deals/flow-presets'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function actor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  return data?.org_id ? { userId: data.id, orgId: data.org_id } : null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    return NextResponse.json(await getPreset(id, currentActor.orgId))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: message === 'Template not found' ? 404 : 400 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    await deletePreset(id, currentActor.orgId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: message === 'Template not found' ? 404 : 400 })
  }
}
