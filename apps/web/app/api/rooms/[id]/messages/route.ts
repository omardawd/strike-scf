import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  req: Request,
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

  // Must be a participant — check user_id then fall back to org_id
  const { data: byUser } = await adminClient
    .from('room_participants')
    .select('id')
    .eq('room_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  let hasAccess = !!byUser
  if (!hasAccess && userData.org_id) {
    const { data: byOrg } = await adminClient
      .from('room_participants')
      .select('id')
      .eq('room_id', id)
      .eq('org_id', userData.org_id)
      .maybeSingle()
    if (byOrg) hasAccess = true
  }

  if (!hasAccess) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { data: room } = await adminClient
    .from('rooms')
    .select('id, room_type, status')
    .eq('id', id)
    .single()

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.status !== 'active') return NextResponse.json({ error: 'Room is archived' }, { status: 400 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { content, message_type = 'message', reply_to_id } = body
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: 'Content exceeds 2000 characters' }, { status: 400 })
  }

  // Insert with pending_review initially
  const insertPayload: any = {
    room_id: id,
    user_id: user.id,
    org_id: userData.org_id,
    bank_id: userData.bank_id,
    content: content.trim(),
    message_type,
    status: 'pending_review',
    reply_to_id: reply_to_id ?? null,
  }

  const { data: message, error: insertError } = await adminClient
    .from('room_messages')
    .insert(insertPayload)
    .select()
    .single()

  if (insertError || !message) {
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 })
  }

  let finalStatus: string
  let moderation_reason: string | null = null

  if (room.room_type === 'private') {
    // Private rooms: visible immediately, no moderation
    finalStatus = 'visible'
  } else {
    // Public rooms: AI moderation
    try {
      const result = await callClaude({
        system: 'You are a content moderator for a professional trade finance marketplace.',
        messages: [
          {
            role: 'user',
            content: `Is this message appropriate for a professional trade finance marketplace? Reply with only: APPROVE or FLAG: [brief reason]\n\nMessage: ${content.trim()}`,
          },
        ],
        max_tokens: 100,
      })

      const verdict = result.text.trim()
      if (verdict.startsWith('APPROVE')) {
        finalStatus = 'visible'
      } else {
        finalStatus = 'flagged'
        const colonIdx = verdict.indexOf(':')
        moderation_reason = colonIdx >= 0 ? verdict.slice(colonIdx + 1).trim() : verdict
      }
    } catch {
      // On AI failure, default to visible so the message isn't silently lost
      finalStatus = 'visible'
    }
  }

  // Update message status
  const updatePayload: any = {
    status: finalStatus,
    moderated_at: finalStatus !== 'pending_review' ? new Date().toISOString() : null,
  }
  if (moderation_reason) updatePayload.moderation_reason = moderation_reason

  const { data: updatedMessage } = await adminClient
    .from('room_messages')
    .update(updatePayload)
    .eq('id', message.id)
    .select()
    .single()

  // Update room last_message_at
  await adminClient
    .from('rooms')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', id)

  // Agreement detection: for private rooms only, check every 5th message whether
  // parties are converging on a deal. If so, inject an AI system message.
  if (room.room_type === 'private' && finalStatus === 'visible') {
    const { count: msgCount } = await adminClient
      .from('room_messages')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', id)
      .eq('status', 'visible')

    if ((msgCount ?? 0) % 5 === 0) {
      const { data: recentMsgs } = await adminClient
        .from('room_messages')
        .select('content, user_id')
        .eq('room_id', id)
        .eq('status', 'visible')
        .order('created_at', { ascending: false })
        .limit(15)

      void (async () => {
        try {
          const transcript = (recentMsgs ?? [])
            .reverse()
            .map((m: { content: string; user_id: string }) =>
              `[${m.user_id === user.id ? 'You' : 'Counterparty'}]: ${m.content}`
            )
            .join('\n')

          const detectionResult = await callClaude({
            system:
              'You are monitoring a trade negotiation room. Analyze the last messages and determine if both parties have reached — or are very close to reaching — a deal agreement. ' +
              'Respond with only: AGREEMENT_DETECTED or NO_AGREEMENT',
            messages: [
              {
                role: 'user',
                content: `Recent messages:\n${transcript}\n\nHas an agreement been reached or are parties clearly converging on one?`,
              },
            ],
            max_tokens: 20,
          })

          if (detectionResult.text.trim().startsWith('AGREEMENT_DETECTED')) {
            await adminClient.from('room_messages').insert({
              room_id: id,
              user_id: null,
              org_id: null,
              bank_id: null,
              content:
                'Strike AI has detected that both parties appear to be reaching an agreement. ' +
                'When ready, head to your Deal page to finalize terms, sign the trade contract, and move to confirmed status.',
              message_type: 'ai_insight',
              status: 'visible',
              reply_to_id: null,
            })
          }
        } catch {
          // Never block message delivery on agreement detection failures
        }
      })()
    }
  }

  return NextResponse.json({ message: updatedMessage ?? message }, { status: 201 })
}
