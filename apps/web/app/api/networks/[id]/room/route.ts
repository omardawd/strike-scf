import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { syncNetworkRoomParticipants } from '@/lib/networks/room-sync'
import { getNetworkAccess } from '@/lib/networks/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/networks/[id]/room — find-or-create this network's single
// persistent private room, sync its participants to current active
// membership, and return its id. Owner or active member only.
export async function POST(
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
  if (!me.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { network, hasAccess } = await getNetworkAccess(adminClient, id, me.org_id)
  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Find-or-create — the partial unique index on rooms.network_id means a
  // concurrent double-create would fail on the second insert; treat that as
  // "someone else just created it" and re-fetch rather than erroring.
  const { data: existing } = await adminClient
    .from('rooms')
    .select('id')
    .eq('network_id', id)
    .maybeSingle()

  let roomId = existing?.id as string | undefined

  if (!roomId) {
    const { data: created, error: createErr } = await adminClient
      .from('rooms')
      .insert({
        room_type: 'private',
        name: network.name,
        network_id: id,
        created_by_org_id: network.anchor_org_id,
        status: 'active',
        is_moderated: true,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      // Likely a concurrent create won the race — fetch the row it made.
      const { data: retry } = await adminClient
        .from('rooms')
        .select('id')
        .eq('network_id', id)
        .maybeSingle()
      if (!retry) return NextResponse.json({ error: 'Failed to create network room' }, { status: 500 })
      roomId = retry.id
    } else {
      roomId = created.id
    }
  }

  await syncNetworkRoomParticipants(adminClient, id)

  return NextResponse.json({ room_id: roomId })
}
