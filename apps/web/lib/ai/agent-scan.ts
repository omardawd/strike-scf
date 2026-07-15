// Core autonomous agent scan logic.
// Reads ERP signals + platform state for an org, calls Claude Sonnet to generate
// structured proposals, and inserts them into agent_tasks as 'awaiting_approval'.
// Nothing is ever executed automatically — humans must approve every task.

import { createClient as createAdmin } from '@supabase/supabase-js'
import { getAgentPreferences } from './agent-preferences'
import { HARD_MAX_ROUNDS, HARD_MAX_DEADLINE_DAYS, NEGOTIATION_CAPABLE_TOOLS } from './negotiation-constants'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AgentConfig {
  name: string
  persona: string | null
  goals: string[]
}

interface Proposal {
  type: string
  title: string
  body: string
  proposed_action: { tool_name: string; tool_input: Record<string, unknown> }
}

interface NegotiationPlan {
  price_floor: number | null
  price_ceiling: number | null
  max_rounds: number
  deadline_at: string
  guardrails_configured: boolean
  preferences_snapshot: Awaited<ReturnType<typeof getAgentPreferences>>
}

export async function runAgentScan(orgId: string): Promise<{ inserted: number; proposals: Proposal[] }> {
  // ── 1. Load agent config ─────────────────────────────────────────────────
  const { data: agentRow } = await adminClient
    .from('org_agents')
    .select('name, persona, goals, is_active')
    .eq('org_id', orgId)
    .single()

  if (!agentRow?.is_active) return { inserted: 0, proposals: [] }

  const agent: AgentConfig = {
    name: agentRow.name ?? 'Strike Agent',
    persona: agentRow.persona ?? null,
    goals: (agentRow.goals as string[]) ?? [],
  }

  // ── 2. Load org context ──────────────────────────────────────────────────
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, type, legal_name, doing_business_as')
    .eq('id', orgId)
    .single()

  // ── 3. Load ERP signals ──────────────────────────────────────────────────
  const { data: erpRows } = await adminClient
    .from('erp_sync_data')
    .select('data_type, data')
    .eq('org_id', orgId)
    .order('synced_at', { ascending: false })
    .limit(20)

  const erpSnapshot = (erpRows ?? []).reduce<Record<string, unknown>>((acc, row) => {
    if (!acc[row.data_type]) acc[row.data_type] = row.data
    return acc
  }, {})

  // ── 4. Load active deals ──────────────────────────────────────────────────
  const { data: activeDeals } = await adminClient
    .from('deals')
    .select(
      'id, status, total_value, agreed_currency, goods_description, payment_due_date, ' +
      'buyer_org_id, supplier_org_id, ' +
      'buyer:organizations!deals_buyer_org_id_fkey(legal_name, doing_business_as), ' +
      'supplier:organizations!deals_supplier_org_id_fkey(legal_name, doing_business_as)'
    )
    .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`)
    .not('status', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: false })
    .limit(10)

  // ── 5. Load pending recommendations ─────────────────────────────────────
  const { data: recommendations } = await adminClient
    .from('recommendations')
    .select('priority, category, title, body, action_label, estimated_impact')
    .eq('org_id', orgId)
    .eq('dismissed', false)
    .eq('actioned', false)
    .order('priority', { ascending: true })
    .limit(10)

  // ── 6. Load marketplace listings the org has ─────────────────────────────
  const { data: listings } = await adminClient
    .from('marketplace_listings')
    .select('id, listing_type, title, status, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .limit(5)

  // ── 6b. Load agent guardrail preferences — bounds what negotiation-capable ─
  // proposals (create_marketplace_listing / submit_marketplace_offer) can carry.
  const prefs = await getAgentPreferences(orgId)

  // ── 7. Build context for Claude ──────────────────────────────────────────
  const orgName = org?.doing_business_as ?? org?.legal_name ?? orgId
  const portal  = org?.type === 'anchor' ? 'anchor (buyer)' : 'supplier'

  const contextSections = [
    `Org: ${orgName} (${portal}, org_id: ${orgId})`,
    `Agent name: ${agent.name}`,
    agent.persona ? `Agent focus: ${agent.persona}` : '',
    agent.goals.length ? `Agent goals: ${agent.goals.join('; ')}` : '',
    '',
    'ERP signals:',
    Object.keys(erpSnapshot).length
      ? JSON.stringify(erpSnapshot, null, 2)
      : 'No ERP data available.',
    '',
    'Active deals (use company names, never the id, when writing proposals):',
    activeDeals?.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? JSON.stringify(activeDeals.map((d: any) => ({
          id: d.id,
          status: d.status,
          value: `${d.agreed_currency ?? 'USD'} ${d.total_value}`,
          goods: d.goods_description?.slice(0, 80),
          buyer_company: d.buyer?.doing_business_as ?? d.buyer?.legal_name ?? 'Unknown buyer',
          supplier_company: d.supplier?.doing_business_as ?? d.supplier?.legal_name ?? 'Unknown supplier',
          payment_due_date: d.payment_due_date,
        })), null, 2)
      : 'No active deals.',
    '',
    'Pending recommendations:',
    recommendations?.length
      ? recommendations.map((r) => `[${r.priority}] ${r.title} — ${r.body?.slice(0, 100)}`).join('\n')
      : 'No pending recommendations.',
    '',
    'Active marketplace listings:',
    listings?.length
      ? listings.map((l) => `${l.listing_type} — ${l.title}`).join('\n')
      : 'No active listings.',
    '',
    'Agent guardrails configured for this org (only relevant to create_marketplace_listing / submit_marketplace_offer proposals — these are the ones that can lead to an autonomous negotiation):',
    prefs.hasPriceGuardrails
      ? [
          prefs.rate_floor != null ? `- Price floor: ${prefs.rate_floor}` : '',
          prefs.rate_ceiling != null ? `- Price ceiling: ${prefs.rate_ceiling}` : '',
          prefs.max_deal_value_auto != null ? `- Max auto deal value: ${prefs.max_deal_value_auto}` : '',
        ].filter(Boolean).join('\n')
      : 'No price guardrails configured — you may use your own judgment on price, but the human will still approve the final terms before any deal is created.',
  ].filter((s) => s !== undefined).join('\n')

  const SYSTEM_PROMPT = `You are ${agent.name}, an AI agent operating on behalf of ${orgName} on the Strike SCF platform.
Your role is to scan the organisation's data and propose specific, actionable tasks for the human controller to approve.
You NEVER execute actions yourself — you only propose them.

Your audience is a treasurer, relationship manager, CFO, or CEO — not an engineer. They will never see the underlying
tool name, database IDs, or JSON parameters; they only see the "title" and "body" you write. Every proposal must be
concrete enough that they can evaluate it in 30 seconds and click Approve or Reject with full confidence in what will
happen if they do.

Writing rules for "title" and "body":
- NEVER include a UUID, internal ID (e.g. "Deal 06a05407"), status enum value (e.g. "contract_pending"), or tool/field
  name. Translate every one of these into plain business language.
- ALWAYS refer to counterparties by their company name (e.g. "Walmart Inc.", "Acme Textiles"), never by ID or "the buyer".
- ALWAYS state the dollar amount, what stage the deal/receivable is at in plain English (e.g. "goods have shipped but
  payment hasn't settled yet" instead of "status: shipped"), and why it matters financially (cash flow impact, risk of
  missed rate, aging receivable, etc.).
- The "body" must end with what will concretely happen if the human clicks Approve (e.g. "Approving will submit a
  financing request for USD 58,400 to Strike Place banks." or "Approving will pull up the deal's contract status for
  you to review — no changes will be made.").
- Write like a one-paragraph briefing note, not a system log line.

Return ONLY valid JSON: an array of proposal objects. No prose, no markdown, just the JSON array.
Each proposal must follow this exact schema:
{
  "type": "scan_advisory" | "create_listing" | "request_financing" | "submit_offer" | "negotiate",
  "title": "Short action title in plain business language (max 60 chars, no IDs/enums/tool names)",
  "body": "2-4 sentences: what's happening, which company/companies are involved, the dollar impact, and what Approve will concretely do.",
  "proposed_action": {
    "tool_name": "one of: create_marketplace_listing | create_financing_request | submit_marketplace_offer | get_active_deals | search_marketplace_listings",
    "tool_input": { ...exact tool input parameters }
  }
}

Produce 1-5 proposals max. Prioritise by urgency (cash flow > overdue receivables > inventory > procurement).
Only propose actions with clear supporting evidence in the data. If there is nothing meaningful to propose, return [].`

  const userPrompt = `Here is the current state of the organisation:\n\n${contextSections}\n\nBased on this data, what actions do you propose for the human controller to review?`

  // ── 8. Call Claude Sonnet ────────────────────────────────────────────────
  let proposals: Proposal[] = []

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (anthropicRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claudeData: any = await anthropicRes.json()
      const rawText = (claudeData.content ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b.type === 'text')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => b.text)
        .join('')
        .trim()

      // Strip markdown code fences if present
      const jsonText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
      const parsed = JSON.parse(jsonText)
      if (Array.isArray(parsed)) proposals = parsed
    }
  } catch {
    // Silently fail — don't crash the cron if Claude errors
    return { inserted: 0, proposals: [] }
  }

  if (!proposals.length) return { inserted: 0, proposals: [] }

  // ── 9. Insert tasks + notify org admins ──────────────────────────────────
  // Proposals whose tool_name is create_marketplace_listing / submit_marketplace_offer
  // are the ones that can lead into an autonomous negotiation once approved (see
  // app/api/agents/tasks/[id]/approve/route.ts) — they carry a `plan` snapshotting
  // this org's guardrails at proposal time, so the tick loop enforces the exact
  // guardrails the human saw when they approved, not whatever is configured later.
  const deadlineAt = new Date(Date.now() + HARD_MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const taskRows = proposals.map((p) => {
    const isNegotiationCapable = (NEGOTIATION_CAPABLE_TOOLS as readonly string[]).includes(p.proposed_action?.tool_name)
    const plan: NegotiationPlan | null = isNegotiationCapable
      ? {
          price_floor: prefs.rate_floor,
          price_ceiling: prefs.rate_ceiling,
          max_rounds: HARD_MAX_ROUNDS,
          deadline_at: deadlineAt,
          guardrails_configured: prefs.hasPriceGuardrails,
          preferences_snapshot: prefs,
        }
      : null

    return {
      org_id: orgId,
      type: p.type ?? 'scan_advisory',
      title: String(p.title ?? 'Agent proposal').slice(0, 200),
      body: p.body ?? null,
      proposed_action: p.proposed_action ?? null,
      plan,
      status: 'awaiting_approval',
    }
  })

  const { error: insertErr } = await adminClient.from('agent_tasks').insert(taskRows)
  if (insertErr) return { inserted: 0, proposals }

  // Notify all org_admin users
  const { data: admins } = await adminClient
    .from('users')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'org_admin')
    .eq('is_active', true)

  if (admins?.length) {
    const count = proposals.length
    const notifRows = admins.map((u) => ({
      user_id: u.id,
      event: 'agent_proposal',
      title: `${agent.name} has ${count} new proposal${count === 1 ? '' : 's'}`,
      body: proposals[0]?.title ?? 'Review your agent tasks.',
      deep_link: '/ai?tab=agent',
    }))
    await adminClient.from('notifications').insert(notifRows)
  }

  return { inserted: taskRows.length, proposals }
}
