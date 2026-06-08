import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!userData.org_id) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, status, kyb_status, network_visible')
    .eq('id', userData.org_id)
    .single()

  if (!org || !org.network_visible || org.kyb_status === 'not_started') {
    return NextResponse.json({ error: 'Activate your Passport to create rooms' }, { status: 403 })
  }

  const body = await req.json()
  const { name, description, category, tags, rules } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data: room, error } = await adminClient
    .from('rooms')
    .insert({
      room_type: 'public',
      is_moderated: true,
      status: 'active',
      name: name.trim(),
      description: description?.trim() || null,
      category: category || null,
      tags: tags || null,
      rules: rules?.trim() || null,
      created_by_user_id: user.id,
      created_by_org_id: userData.org_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })

  await adminClient
    .from('room_participants')
    .insert({
      room_id: room.id,
      user_id: user.id,
      org_id: userData.org_id,
      role: 'owner',
    })

  return NextResponse.json({ room })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: participations } = await adminClient
    .from('room_participants')
    .select('room_id, last_read_at')
    .eq('user_id', user.id)

  const roomIds = (participations ?? []).map((p: any) => p.room_id)
  if (roomIds.length === 0) {
    return NextResponse.json({ private: [], public: [] })
  }

  const lastReadByRoom: Record<string, string | null> = {}
  ;(participations ?? []).forEach((p: any) => { lastReadByRoom[p.room_id] = p.last_read_at })

  const { data: rooms, error } = await adminClient
    .from('rooms')
    .select('*')
    .in('id', roomIds)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  // Per-room last-message preview + unread count for the conversation panel.
  // One scoped query over visible messages in the user's rooms, reduced client-side.
  const { data: previewMsgs } = await adminClient
    .from('room_messages')
    .select('room_id, content, message_type, created_at')
    .in('room_id', roomIds)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })

  const previewByRoom: Record<string, { content: string | null; message_type: string; created_at: string }> = {}
  const unreadByRoom: Record<string, number> = {}
  ;(previewMsgs ?? []).forEach((m: any) => {
    if (!previewByRoom[m.room_id]) {
      previewByRoom[m.room_id] = {
        content: m.content ?? null,
        message_type: m.message_type,
        created_at: m.created_at,
      }
    }
    const lastRead = lastReadByRoom[m.room_id]
    if (!lastRead || new Date(m.created_at).getTime() > new Date(lastRead).getTime()) {
      unreadByRoom[m.room_id] = (unreadByRoom[m.room_id] ?? 0) + 1
    }
  })

  const withPreview = (r: any) => {
    const p = previewByRoom[r.id]
    let preview: string | null = null
    if (p) {
      if (p.message_type === 'system') preview = p.content
      else if (p.message_type === 'document_share') preview = '📎 Shared a document'
      else if (p.message_type === 'offer_update' || p.message_type === 'contract_draft') preview = 'Offer update'
      else if (p.message_type === 'ai_suggestion') preview = `Strike AI: ${p.content ?? ''}`.trim()
      else preview = p.content
    }
    return {
      ...r,
      last_message_preview: preview,
      unread_count: unreadByRoom[r.id] ?? 0,
    }
  }

  const privateRooms = (rooms ?? []).filter((r: any) => r.room_type === 'private').map(withPreview)
  const publicRooms  = (rooms ?? []).filter((r: any) => r.room_type === 'public').map(withPreview)

  // Enrich private rooms with deal summary
  const dealIds = privateRooms.filter((r: any) => r.deal_id).map((r: any) => r.deal_id)
  let dealMap: Record<string, any> = {}

  if (dealIds.length > 0) {
    const { data: deals } = await adminClient
      .from('deals')
      .select('id, status, total_value, agreed_currency, buyer_org_id, supplier_org_id')
      .in('id', dealIds)

    const orgIds = new Set<string>()
    ;(deals ?? []).forEach((d: any) => {
      if (d.buyer_org_id) orgIds.add(d.buyer_org_id)
      if (d.supplier_org_id) orgIds.add(d.supplier_org_id)
    })

    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as')
      .in('id', Array.from(orgIds))

    const orgMap: Record<string, string> = {}
    ;(orgs ?? []).forEach((o: any) => {
      orgMap[o.id] = o.doing_business_as || o.legal_name || 'Unknown'
    })

    ;(deals ?? []).forEach((d: any) => {
      const counterpartyId = d.buyer_org_id === userData.org_id
        ? d.supplier_org_id
        : d.buyer_org_id
      dealMap[d.id] = {
        id: d.id,
        status: d.status,
        total_value: d.total_value,
        agreed_currency: d.agreed_currency,
        counterparty_name: orgMap[counterpartyId] ?? 'Unknown',
      }
    })
  }

  const enrichedPrivate = privateRooms.map((r: any) => ({
    ...r,
    deal: r.deal_id ? (dealMap[r.deal_id] ?? null) : null,
  }))

  return NextResponse.json({ private: enrichedPrivate, public: publicRooms })
}
