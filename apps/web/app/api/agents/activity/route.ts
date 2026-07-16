// Live agent activity feed for the dashboard ticker — turns raw agent_actions
// rows into short, human-readable sentences ("Countered Rocket Corp at
// $447.50 on ..."). Read-only, org-scoped.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ACTION_VERBS: Record<string, string> = {
  negotiation_countered: 'Countered',
  negotiation_rejected: 'Rejected an offer',
  negotiation_ready_to_finalize: 'Recommended finalizing',
  negotiation_escalated: 'Flagged for your approval',
  negotiation_halted: 'Halted negotiation',
  negotiation_accepted: 'Finalized',
  negotiation_listing_posted: 'Posted a listing',
  negotiation_offer_submitted: 'Submitted an offer',
  create_marketplace_listing: 'Posted a listing',
  submit_marketplace_offer: 'Submitted an offer',
  create_financing_request: 'Requested financing',
}

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

function fmtMoney(n: unknown, currency = 'USD'): string | null {
  const num = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN
  if (!Number.isFinite(num)) return null
  return `${currency} ${num.toLocaleString()}`
}

interface FeedItem {
  id: string
  text: string
  outcome: string
  created_at: string
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ items: [] })

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') ?? '8', 10) || 8, 20)

  const { data: rows } = await adminClient
    .from('agent_actions')
    .select('id, action_type, entity_type, entity_id, input_summary, output_summary, outcome, created_at')
    .eq('org_id', userData.org_id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (!rows?.length) return NextResponse.json({ items: [] })

  // Batch-resolve everything the formatter might need: agent_tasks titles
  // (for entity_type='agent_task') and marketplace_offers -> listing/org
  // names (for the tick loop's negotiation_* actions on entity_type='marketplace_offer').
  const taskIds = [...new Set(rows.filter(r => r.entity_type === 'agent_task').map(r => r.entity_id).filter(Boolean))]
  const offerIds = [...new Set(rows.filter(r => r.entity_type === 'marketplace_offer').map(r => r.entity_id).filter(Boolean))]

  const [{ data: tasks }, { data: offers }] = await Promise.all([
    taskIds.length ? adminClient.from('agent_tasks').select('id, title').in('id', taskIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    offerIds.length ? adminClient.from('marketplace_offers').select('id, listing_id, from_org_id, marketplace_listings(title, org_id, currency)').in('id', offerIds) : Promise.resolve({ data: [] as any[] }),
  ])

  const taskMap = new Map((tasks ?? []).map(t => [t.id, t.title]))
  const offerMap = new Map((offers ?? []).map(o => [o.id, o]))

  const orgIds = [...new Set((offers ?? []).flatMap((o: any) => {
    const listing = Array.isArray(o.marketplace_listings) ? o.marketplace_listings[0] : o.marketplace_listings
    return [o.from_org_id, listing?.org_id].filter(Boolean)
  }))]
  const { data: orgs } = orgIds.length
    ? await adminClient.from('organizations').select('id, legal_name, doing_business_as').in('id', orgIds)
    : { data: [] as { id: string; legal_name: string; doing_business_as: string | null }[] }
  const orgNameMap = new Map((orgs ?? []).map(o => [o.id, o.doing_business_as || o.legal_name]))

  const items: FeedItem[] = []
  for (const row of rows) {
    const text = describe(row, taskMap, offerMap, orgNameMap, userData.org_id)
    if (text) items.push({ id: row.id, text, outcome: row.outcome, created_at: row.created_at })
    if (items.length >= limit) break
  }

  return NextResponse.json({ items })
}

function describe(
  row: { action_type: string; entity_type: string | null; entity_id: string | null; input_summary: string | null; output_summary: string | null; outcome: string },
  taskMap: Map<string, string>,
  offerMap: Map<string, any>,
  orgNameMap: Map<string, string>,
  myOrgId: string
): string | null {
  const input = safeParse(row.input_summary)
  const output = safeParse(row.output_summary)

  // Negotiation tick actions: entity is the marketplace_offer itself.
  if (row.entity_type === 'marketplace_offer' && row.entity_id) {
    const offer = offerMap.get(row.entity_id)
    const listing = offer ? (Array.isArray(offer.marketplace_listings) ? offer.marketplace_listings[0] : offer.marketplace_listings) : null
    const listingTitle = listing?.title ? `"${listing.title}"` : 'a listing'
    const counterpartyId = offer ? (offer.from_org_id === myOrgId ? listing?.org_id : offer.from_org_id) : null
    const counterparty = counterpartyId ? orgNameMap.get(counterpartyId) : null
    const verb = ACTION_VERBS[row.action_type] ?? 'Updated'

    if (row.action_type === 'negotiation_countered') {
      const price = fmtMoney(input?.offered_price, listing?.currency ?? 'USD')
      return `${verb}${counterparty ? ` ${counterparty}` : ''}${price ? ` at ${price}` : ''} on ${listingTitle}`
    }
    if (row.outcome === 'error') return null // don't surface raw negotiation errors in the ticker
    return `${verb}${counterparty ? ` with ${counterparty}` : ''} on ${listingTitle}`
  }

  // Approved agent_tasks executions: use the task's own clean title.
  if (row.entity_type === 'agent_task' && row.entity_id) {
    const title = taskMap.get(row.entity_id)
    if (!title) return null
    if (row.outcome === 'error') return null
    return title
  }

  // Ad-hoc tool calls (no task/offer link) — humanize from action_type + amount if present.
  const verb = ACTION_VERBS[row.action_type]
  if (!verb) return null
  if (row.outcome === 'error') return null
  const amount = fmtMoney((output as any)?.amount_requested ?? (output as any)?.total_value ?? (input as any)?.amount, (output as any)?.currency ?? 'USD')
  return `${verb}${amount ? ` for ${amount}` : ''}`
}
