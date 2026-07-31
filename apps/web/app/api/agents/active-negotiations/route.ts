// Lightweight, org-scoped read for the global "background activity" widget
// (components/activity-widget.tsx) — just what's needed to render a "Negotiation
// in progress" chip that links straight to the Strike Room, polled on an interval.
// Deliberately separate from /api/agents/tasks (the Agent tab's full thread view)
// so this stays a cheap, narrow query.
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
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ negotiations: [] })

  const { data: rows } = await adminClient
    .from('agent_negotiations')
    .select('id, status, current_round, listing_id, offer_id, deal_id, updated_at')
    .eq('org_id', userData.org_id)
    .in('status', ['active', 'awaiting_finalization'])
    .order('updated_at', { ascending: false })
    .limit(10)

  if (!rows?.length) return NextResponse.json({ negotiations: [] })

  const listingIds = [...new Set(rows.map(r => r.listing_id).filter(Boolean))]
  const offerIds = [...new Set(rows.map(r => r.offer_id).filter(Boolean))]

  const [{ data: listings }, { data: offers }] = await Promise.all([
    listingIds.length ? adminClient.from('marketplace_listings').select('id, title').in('id', listingIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    offerIds.length ? adminClient.from('marketplace_offers').select('id, room_id').in('id', offerIds) : Promise.resolve({ data: [] as { id: string; room_id: string | null }[] }),
  ])

  const listingMap = new Map((listings ?? []).map(l => [l.id, l.title]))
  const roomMap = new Map((offers ?? []).map(o => [o.id, o.room_id]))

  const negotiations = rows.map(r => ({
    id: r.id,
    status: r.status,
    current_round: r.current_round,
    listing_title: r.listing_id ? (listingMap.get(r.listing_id) ?? null) : null,
    room_id: r.offer_id ? (roomMap.get(r.offer_id) ?? null) : null,
    deal_id: r.deal_id,
    updated_at: r.updated_at,
  }))

  return NextResponse.json({ negotiations })
}
