import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { executeTool, BANK_ONLY_TOOLS, WRITE_TOOLS, type ToolName } from '@/lib/ai/tools/execute'

// Used only for auth/user-row lookups and agent_actions logging in this route.
// Tool handlers own their own adminClient via lib/ai/tools/admin.ts.
const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. User row
  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // 3. Ghost check — ghost orgs can only use read tools, not write tools
  if (userData.org_id) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('network_visible, kyb_status')
      .eq('id', userData.org_id)
      .single()
    if (orgRow && !orgRow.network_visible && orgRow.kyb_status === 'not_started') {
      return NextResponse.json({ error: 'Complete your Passport to use AI tools.' }, { status: 403 })
    }
  }

  const body = await req.json()
  const { tool_name, tool_input } = body as {
    tool_name: ToolName
    tool_input: Record<string, unknown>
  }

  if (!tool_name || !tool_input) {
    return NextResponse.json({ error: 'tool_name and tool_input are required' }, { status: 400 })
  }

  // 4. Role gating — bank-only tools
  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(userData.role)
  if (BANK_ONLY_TOOLS.includes(tool_name) && !isBankUser) {
    return NextResponse.json({ error: 'This tool is only available to bank users.' }, { status: 403 })
  }

  // 5. Check agent preferences for write-tool approval requirements
  if (WRITE_TOOLS.includes(tool_name) && userData.org_id) {
    const { data: pref } = await adminClient
      .from('agent_preferences')
      .select('value')
      .eq('org_id', userData.org_id)
      .eq('preference_type', 'require_approval_for_actions')
      .eq('is_active', true)
      .single()

    if (pref && (pref.value as { enabled?: boolean })?.enabled) {
      // Return a pending-approval response; the frontend should show a confirmation dialog
      return NextResponse.json({
        status: 'requires_approval',
        tool_name,
        tool_input,
        message: `AI wants to execute "${tool_name}". Approve this action in your settings or confirm here.`,
      }, { status: 202 })
    }
  }

  // 6. Execute the tool
  let result: Record<string, unknown>
  const startMs = Date.now()
  try {
    result = await executeTool(tool_name, tool_input)
  } catch (err) {
    console.error(`[AI Tool] ${tool_name} error:`, err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    result = { error: `Tool execution failed: ${message}` }
  }
  const durationMs = Date.now() - startMs

  // 7. Log to agent_actions
  const isError = 'error' in result
  try {
    await adminClient.from('agent_actions').insert({
      action_type: tool_name,
      entity_type: getEntityType(tool_name),
      entity_id: getEntityId(tool_input),
      reasoning: `Tool called by user ${userData.id}`,
      input_summary: JSON.stringify(tool_input).slice(0, 500),
      output_summary: isError
        ? (result.error as string)
        : JSON.stringify(result).slice(0, 500),
      outcome: isError ? 'error' : 'success',
      requires_approval: false,
      human_approved: true,
      model: 'tool_handler',
      tokens_used: 0,
    })
  } catch {
    // silently continue if agent_actions insert fails
  }

  // 8. Return result
  if (isError) {
    return NextResponse.json({ error: result.error, tool_name }, { status: 422 })
  }

  return NextResponse.json({
    tool_name,
    result,
    duration_ms: durationMs,
  })
}

function getEntityType(toolName: ToolName): string {
  const map: Partial<Record<ToolName, string>> = {
    create_marketplace_listing: 'listing',
    evaluate_supplier_passport: 'organization',
    find_and_recommend_deals: 'deal',
    get_pricing_insights: 'market_signal',
    summarize_deal_negotiation: 'deal',
    score_and_rank_financing_offers: 'financing_request',
    detect_deal_risk_signals: 'deal',
    recommend_suppliers_for_buyer: 'organization',
    generate_deal_term_sheet: 'deal',
    proactive_portfolio_alerts: 'portfolio',
  }
  return map[toolName] ?? 'unknown'
}

function getEntityId(toolInput: Record<string, unknown>): string | null {
  return (
    (toolInput.deal_id as string) ??
    (toolInput.supplier_org_id as string) ??
    (toolInput.financing_request_id as string) ??
    (toolInput.org_id as string) ??
    (toolInput.bank_id as string) ??
    null
  )
}
