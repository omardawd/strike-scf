import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { listPresets, createPreset } from '@/lib/deals/flow-presets'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function actor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  return data?.org_id ? { userId: data.id, orgId: data.org_id } : null
}

export async function GET() {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ presets: await listPresets(currentActor.orgId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const detail = await createPreset({
      actor: currentActor,
      name: body.name ?? '',
      description: body.description,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : undefined,
    })
    return NextResponse.json(detail, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 400 })
  }
}
