import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: room, error: roomError } = await adminClient
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single()

  if (roomError || !room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // Auth: user must be a participant, or room is public.
  // Check by user_id first; fall back to org_id so any org member can enter a
  // private room even if they weren't the specific user added when the room was created.
  if (room.room_type !== 'public') {
    let hasAccess = false

    const { data: byUser } = await adminClient
      .from('room_participants')
      .select('id')
      .eq('room_id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (byUser) {
      hasAccess = true
    } else if (userData.org_id) {
      const { data: byOrg } = await adminClient
        .from('room_participants')
        .select('id')
        .eq('room_id', id)
        .eq('org_id', userData.org_id)
        .maybeSingle()

      if (byOrg) {
        hasAccess = true
        // Add this user so they appear in the participant list going forward
        await adminClient
          .from('room_participants')
          .insert({ room_id: id, user_id: user.id, org_id: userData.org_id, role: 'participant' })
          .select()
          .maybeSingle()
      }
    } else if (userData.bank_id) {
      const { data: byBank } = await adminClient
        .from('room_participants')
        .select('id')
        .eq('room_id', id)
        .eq('bank_id', userData.bank_id)
        .maybeSingle()
      if (byBank) hasAccess = true
    }

    if (!hasAccess) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch participants with org/bank names
  const { data: rawParticipants } = await adminClient
    .from('room_participants')
    .select('id, room_id, org_id, bank_id, user_id, role, joined_at, last_read_at')
    .eq('room_id', id)

  const participants = rawParticipants ?? []

  // Collect org and user IDs for enrichment
  const userIds = participants.map((p: any) => p.user_id).filter(Boolean)
  const orgIds  = [...new Set(participants.map((p: any) => p.org_id).filter(Boolean))]

  const [usersRes, orgsRes] = await Promise.all([
    userIds.length > 0
      ? adminClient.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] }),
    orgIds.length > 0
      ? adminClient.from('organizations').select('id, legal_name, doing_business_as').in('id', orgIds)
      : Promise.resolve({ data: [] }),
  ])

  const userMap: Record<string, string> = {}
  ;(usersRes.data ?? []).forEach((u: any) => {
    userMap[u.id] = u.full_name || ''
  })

  const orgMap: Record<string, string> = {}
  ;(orgsRes.data ?? []).forEach((o: any) => {
    orgMap[o.id] = o.doing_business_as || o.legal_name || ''
  })

  const enrichedParticipants = participants.map((p: any) => ({
    ...p,
    user_name: userMap[p.user_id] ?? null,
    org_name: p.org_id ? (orgMap[p.org_id] ?? null) : null,
  }))

  // Fetch last 100 visible messages
  const { data: messages } = await adminClient
    .from('room_messages')
    .select('id, room_id, user_id, org_id, bank_id, content, message_type, status, moderation_reason, metadata, reply_to_id, created_at')
    .eq('room_id', id)
    .eq('status', 'visible')
    .order('created_at', { ascending: true })
    .limit(100)

  const msgUserIds = [...new Set((messages ?? []).map((m: any) => m.user_id).filter(Boolean))]
  const msgOrgIds  = [...new Set((messages ?? []).map((m: any) => m.org_id).filter(Boolean))]

  const [msgUsersRes, msgOrgsRes] = await Promise.all([
    msgUserIds.length > 0
      ? adminClient.from('users').select('id, full_name').in('id', msgUserIds)
      : Promise.resolve({ data: [] }),
    msgOrgIds.length > 0
      ? adminClient.from('organizations').select('id, legal_name, doing_business_as').in('id', msgOrgIds)
      : Promise.resolve({ data: [] }),
  ])

  const msgUserMap: Record<string, string> = {}
  ;(msgUsersRes.data ?? []).forEach((u: any) => {
    msgUserMap[u.id] = u.full_name || ''
  })

  const msgOrgMap: Record<string, string> = {}
  ;(msgOrgsRes.data ?? []).forEach((o: any) => {
    msgOrgMap[o.id] = o.doing_business_as || o.legal_name || ''
  })

  const enrichedMessages = (messages ?? []).map((m: any) => ({
    ...m,
    sender_name: m.user_id ? (msgUserMap[m.user_id] ?? null) : null,
    sender_org_name: m.org_id ? (msgOrgMap[m.org_id] ?? null) : null,
  }))

  // Deal summary for private rooms
  let deal = null
  let listingId: string | null = null
  if (room.room_type === 'private' && room.deal_id) {
    const { data: dealRow } = await adminClient
      .from('deals')
      .select('id, status, total_value, agreed_currency, buyer_org_id, supplier_org_id, goods_description, listing_id')
      .eq('id', room.deal_id)
      .single()

    if (dealRow) {
      const counterpartyId = dealRow.buyer_org_id === userData.org_id
        ? dealRow.supplier_org_id
        : dealRow.buyer_org_id

      const { data: cpOrg } = await adminClient
        .from('organizations')
        .select('legal_name, doing_business_as')
        .eq('id', counterpartyId)
        .single()

      deal = {
        ...dealRow,
        counterparty_name: cpOrg
          ? (cpOrg.doing_business_as || cpOrg.legal_name)
          : 'Unknown',
      }
      listingId = dealRow.listing_id ?? null
    }
  }

  // A negotiation room created before any deal exists (first counter-offer)
  // isn't linked via deals.listing_id yet — resolve it via the offer that
  // points at this room instead.
  if (!listingId) {
    const { data: linkedOffer } = await adminClient
      .from('marketplace_offers')
      .select('listing_id')
      .eq('room_id', id)
      .maybeSingle()
    listingId = linkedOffer?.listing_id ?? null
  }

  let listing = null
  if (listingId) {
    const { data: listingRow } = await adminClient
      .from('marketplace_listings')
      .select('id, title, listing_type, status, currency, target_price')
      .eq('id', listingId)
      .maybeSingle()
    listing = listingRow ?? null
  }

  return NextResponse.json({ room, participants: enrichedParticipants, messages: enrichedMessages, deal, listing })
}
