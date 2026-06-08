import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.3 — PATCH /api/networks/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (me.role !== 'org_admin' || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id')
    .eq('id', id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (network.anchor_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { name?: string; description?: string; visibility_default?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    if (body.name.trim().length > 60) return NextResponse.json({ error: 'name must be 60 chars or fewer' }, { status: 400 })
  }
  if (body.visibility_default && !['public', 'network_only'].includes(body.visibility_default)) {
    return NextResponse.json({ error: 'Invalid visibility_default' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if ('description' in body) updates.description = body.description ?? null
  if (body.visibility_default !== undefined) updates.visibility_default = body.visibility_default

  const { data: updated, error } = await adminClient
    .from('anchor_networks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ network: updated })
}

// G3.4 — DELETE /api/networks/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (me.role !== 'org_admin' || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, member_count')
    .eq('id', id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (network.anchor_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { count: activeCount } = await adminClient
    .from('anchor_network_members')
    .select('id', { count: 'exact', head: true })
    .eq('network_id', id)
    .eq('status', 'active')

  if ((activeCount ?? 0) > 0) {
    return NextResponse.json({
      error: 'Cannot delete a network with active members. Remove all members first.',
    }, { status: 409 })
  }

  const { error } = await adminClient
    .from('anchor_networks')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
