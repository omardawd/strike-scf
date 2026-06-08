import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ORG_ROLES = ['org_admin', 'org_member']

// G3.1 — GET /api/networks — returns anchor's own networks
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!ORG_ROLES.includes(me.role) || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, type')
    .eq('id', me.org_id)
    .single()

  if (!org || (org.type !== 'anchor' && org.type !== 'both')) {
    return NextResponse.json({ error: 'Only anchor organizations can manage networks' }, { status: 403 })
  }

  const { data: networks, error } = await adminClient
    .from('anchor_networks')
    .select('*')
    .eq('anchor_org_id', me.org_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ networks: networks ?? [] })
}

// G3.2 — POST /api/networks — creates a new network
export async function POST(request: Request) {
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
    return NextResponse.json({ error: 'Only org admins can create networks' }, { status: 403 })
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, type')
    .eq('id', me.org_id)
    .single()

  if (!org || (org.type !== 'anchor' && org.type !== 'both')) {
    return NextResponse.json({ error: 'Only anchor organizations can create networks' }, { status: 403 })
  }

  let body: { name?: string; description?: string; visibility_default?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (body.name.trim().length > 60) {
    return NextResponse.json({ error: 'name must be 60 characters or fewer' }, { status: 400 })
  }
  if (body.visibility_default && !['public', 'network_only'].includes(body.visibility_default)) {
    return NextResponse.json({ error: 'Invalid visibility_default' }, { status: 400 })
  }

  const { data: network, error } = await adminClient
    .from('anchor_networks')
    .insert({
      anchor_org_id:      me.org_id,
      name:               body.name.trim(),
      description:        body.description ?? null,
      visibility_default: body.visibility_default ?? 'public',
    })
    .select()
    .single()

  if (error || !network) {
    return NextResponse.json({ error: 'Failed to create network' }, { status: 500 })
  }

  return NextResponse.json({ network }, { status: 201 })
}
