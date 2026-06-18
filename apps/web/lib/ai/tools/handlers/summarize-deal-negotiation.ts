import { adminClient } from '../admin'

export interface SummarizeDealNegotiationInput {
  deal_id: string
  include_room_messages?: boolean
  max_messages?: number
}

export async function summarizeDealNegotiation(input: SummarizeDealNegotiationInput) {
  const includeMessages = input.include_room_messages !== false
  const maxMessages = input.max_messages ?? 100

  const [{ data: deal }, { data: events }] = await Promise.all([
    adminClient
      .from('deals')
      .select(
        'id, status, deal_source, created_at, buyer_org_id, supplier_org_id, ' +
        'amendment_history, payment_due_date, cancelled_by, dispute_reason, ' +
        'shipped_at, payment_confirmed_at, contract_submitted_at, contract_supplier_signed_at, confirmed_at'
      )
      .eq('id', input.deal_id)
      .single(),
    adminClient
      .from('deal_events')
      .select('id, event_type, actor_user_id, actor_org_id, description, metadata, created_at')
      .eq('deal_id', input.deal_id)
      .order('created_at', { ascending: true }),
  ])

  if (!deal) return { error: `Deal ${input.deal_id} not found` }

  const orgIds = [deal.buyer_org_id, deal.supplier_org_id].filter(Boolean)
  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type')
    .in('id', orgIds)

  const orgMap = Object.fromEntries((orgs ?? []).map((o: { id: string; legal_name: string }) => [o.id, o]))

  let messages: Array<{ sender_org_id: string | null; content: string; created_at: string }> = []
  if (includeMessages) {
    const { data: rooms } = await adminClient
      .from('rooms')
      .select('id')
      .eq('deal_id', input.deal_id)
      .limit(1)

    if (rooms && rooms.length > 0) {
      const { data: roomMessages } = await adminClient
        .from('room_messages')
        .select('content, created_at, sender_org_id')
        .eq('room_id', rooms[0].id)
        .order('created_at', { ascending: true })
        .limit(maxMessages)
      messages = roomMessages ?? []
    }
  }

  const amendments: unknown[] = Array.isArray(deal.amendment_history) ? deal.amendment_history : []

  const timeline = (events ?? []).map((e: { created_at: string; event_type: string; actor_org_id: string | null; description: string; metadata: unknown }) => ({
    timestamp: e.created_at,
    event_type: e.event_type,
    actor: e.actor_org_id ? (orgMap[e.actor_org_id]?.legal_name ?? e.actor_org_id) : 'System',
    description: e.description,
    metadata: e.metadata,
  }))

  const openIssues: string[] = []
  if (deal.status === 'in_dispute') openIssues.push('Deal is currently in dispute — resolution pending.')
  if (deal.status === 'payment_overdue') openIssues.push('Payment is overdue — buyer action required.')
  if (deal.status === 'negotiating' && timeline.length > 10) openIssues.push('Negotiation is lengthy — consider setting a deadline.')
  if (amendments.length > 0) openIssues.push(`${amendments.length} amendment(s) in history — verify final agreed terms.`)
  if (deal.status === 'contract_pending') openIssues.push('Contract submitted but not yet signed by supplier.')

  const statusNextSteps: Record<string, string> = {
    negotiating: 'Finalize terms and advance to "agreed" status.',
    agreed: 'Buyer should submit trade contract or advance to documents pending.',
    contract_pending: 'Supplier needs to review and sign the trade contract.',
    confirmed: 'Supplier should prepare goods and set up shipment.',
    in_preparation: 'Finalize production and prepare for shipping.',
    shipped: 'Buyer should confirm delivery once goods arrive.',
    delivery_confirmed: 'Buyer should initiate payment or request financing.',
    payment_due: 'Buyer must send payment now.',
    payment_overdue: 'Buyer must send payment immediately — overdue.',
    in_dispute: 'Both parties should submit evidence. Strike Admin will resolve.',
    payment_confirmed: 'Seller should confirm receipt of payment.',
    completed: 'Deal is complete. Consider submitting a peer review.',
  }

  return {
    deal_id: input.deal_id,
    current_status: deal.status,
    deal_source: deal.deal_source,
    parties: {
      buyer: orgMap[deal.buyer_org_id] ?? { id: deal.buyer_org_id },
      supplier: orgMap[deal.supplier_org_id] ?? { id: deal.supplier_org_id },
    },
    timeline,
    key_events: {
      status_transitions: (events ?? []).filter((e: { event_type: string }) => e.event_type?.includes('status') || e.event_type?.includes('transition')).length,
      disputes: (events ?? []).filter((e: { event_type: string }) => e.event_type?.includes('dispute')).length,
      payment_events: (events ?? []).filter((e: { event_type: string }) => e.event_type?.includes('payment')).length,
      amendments: amendments.length,
    },
    room_summary: includeMessages ? {
      total_messages: messages.length,
      buyer_messages: messages.filter((m) => m.sender_org_id === deal.buyer_org_id).length,
      supplier_messages: messages.filter((m) => m.sender_org_id === deal.supplier_org_id).length,
      last_message_at: messages.at(-1)?.created_at ?? null,
    } : null,
    important_dates: {
      deal_created: deal.created_at,
      contract_submitted: deal.contract_submitted_at ?? null,
      contract_signed: deal.contract_supplier_signed_at ?? null,
      confirmed_at: deal.confirmed_at ?? null,
      shipped_at: deal.shipped_at ?? null,
      payment_confirmed_at: deal.payment_confirmed_at ?? null,
      payment_due_date: deal.payment_due_date ?? null,
    },
    open_issues: openIssues,
    suggested_next_steps: [statusNextSteps[deal.status] ?? `Current status: ${deal.status}. Review and advance the deal.`],
    recent_messages: messages.slice(-10).map((m) => ({
      sender: m.sender_org_id ? (orgMap[m.sender_org_id]?.legal_name ?? m.sender_org_id) : 'Unknown',
      content: m.content,
      sent_at: m.created_at,
    })),
  }
}
