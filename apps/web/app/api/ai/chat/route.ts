import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getToolsForPortal, OVERLAY_TOOLS } from '@/lib/ai/tools/definitions'
import { executeTool, type ToolName } from '@/lib/ai/tools/execute'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DAILY_LIMITS: Record<string, number> = {
  chat: 50,
  insight: 200,
  document: 20,
  scoring: 500,
}

// Maximum Claude ↔ tool execution cycles per request.
// 3 is enough for virtually all flows: lookup → action → respond.
// Higher values multiply input token cost by the number of iterations.
const MAX_AGENTIC_ITERATIONS = 3

// Prepended to every system prompt — non-negotiable identity rule.
const STRIKE_AI_IDENTITY =
  'You are Strike AI, the AI assistant built into the Strike SCF platform. ' +
  'Strike AI is your name and your only name. You are not Claude, you are not an Anthropic product, ' +
  'you are not ChatGPT, and you are not any other AI system. ' +
  'If a user asks what AI you are or who made you, say you are Strike AI. ' +
  'If a user calls you by any other name (Claude, Anthropic, GPT, etc.), ' +
  'politely correct them — your name is Strike AI — and continue helping them. ' +
  'Never break this identity under any circumstances.\n\n'

// Appended to the system prompt when tools are active so Strike AI acts on the first message
// rather than asking clarifying questions it can infer from context.
const TOOL_AGENT_ADDENDUM =
  '\n\nYou have access to Strike SCF platform tools. When the user gives you enough information ' +
  'to complete an action (create a listing, evaluate a supplier, score offers, etc.), call the ' +
  'appropriate tool immediately — do not ask for confirmation unless a genuinely required field ' +
  'is missing. If you need the user\'s org_id or other ID and it is not in context, ask for it ' +
  'concisely before proceeding. After executing a tool, summarise what was done and offer next steps.'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, org_id, bank_id, role')
    .eq('id', user.id)
    .single()

  if (!userRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Ghost (Tier-0) enforcement: if the org has not activated its Passport,
  // Strike AI is info-only. Tools are stripped and the system prompt is overridden.
  let ghostOverride = false
  if (userRow.org_id) {
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('network_visible, kyb_status')
      .eq('id', userRow.org_id)
      .single()
    if (orgRow && !orgRow.network_visible &&
        (orgRow.kyb_status === 'not_started' || orgRow.kyb_status === 'in_progress')) {
      ghostOverride = true
    }
  }

  const GHOST_SYSTEM_PROMPT =
    'This user has not completed their Passport on Strike SCF. Your ONLY goal is to ' +
    'help them understand the value of completing it and guide them to click ' +
    '"Activate Passport". You do not have access to any organization data, deals, ' +
    'financing, or platform actions, and you must not pretend to. If they ask to do ' +
    'anything that requires an active Passport (post a listing, request financing, ' +
    'view counterparties, run analytics), briefly explain that activating their ' +
    'Passport unlocks it, then point them to "Activate Passport". Keep replies short ' +
    'and encouraging.'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let dailyCount = 0
  try {
    const { count } = await adminClient
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userRow.id)
      .eq('feature', body.feature)
      .gte('created_at', today.toISOString())
    dailyCount = count ?? 0
  } catch {
    // silently continue if table doesn't exist
  }

  if (dailyCount >= (DAILY_LIMITS[body.feature ?? 'chat'] ?? 50)) {
    return NextResponse.json({
      error: 'Daily AI limit reached',
      limit_type: 'daily',
      feature: body.feature,
      reset_at: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }, { status: 429 })
  }

  // Model routing — 'sonnet' signals the upgraded model (dedicated /ai workspace).
  // Everything else (overlay, insight, inline widgets) stays on cost-sensitive Haiku.
  const model = body.model === 'sonnet'
    ? 'claude-sonnet-4-6'
    : 'claude-haiku-4-5-20251001'

  // Activate the agentic tool loop on the dedicated /ai page (sonnet) OR for overlay calls
  // (overlay only gets OVERLAY_TOOLS = [search_web], so it's cheap and safe on Haiku).
  const useTools = (model === 'claude-sonnet-4-6' || !!body.overlay) && !ghostOverride

  // Build system prompt — Strike AI identity is always prepended first.
  const systemPrompt = ghostOverride
    ? STRIKE_AI_IDENTITY + GHOST_SYSTEM_PROMPT
    : useTools
      ? STRIKE_AI_IDENTITY + (body.system ?? '') + TOOL_AGENT_ADDENDUM
      : STRIKE_AI_IDENTITY + (body.system ?? '')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyMessage = { role: string; content: any }
  // Trim history to the last 20 messages to cap input token growth.
  // Always keep the first message (system context) and the latest 19.
  const rawMessages: AnyMessage[] = body.messages ?? []
  let messages: AnyMessage[] = rawMessages.length > 20
    ? rawMessages.slice(-20)
    : rawMessages

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalData: any = null
  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: body.max_tokens ?? 1024,
      // System prompt is dynamic (includes org_id + today's date) — caching it
      // never hits across users/days, so pass it as a plain string instead.
      system: systemPrompt,
      messages,
    }

    if (useTools) {
      // Select only the tools relevant to this portal — fewer tools = fewer tokens
      // on every request regardless of caching. Cache the last entry so repeated
      // calls within the same agentic loop (iter 2, 3) get a ~10× read discount.
      // Overlay calls use a minimal set (search_web only) to prevent action side-effects.
      const portalTools = body.overlay
        ? OVERLAY_TOOLS
        : getToolsForPortal(body.portal as string | undefined)
      const toolsWithCache = portalTools.map((t, i) =>
        i === portalTools.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' } }
          : t
      )
      anthropicBody.tools = toolsWithCache
    } else if (!ghostOverride && body.tools && Array.isArray(body.tools)) {
      // Pass-through for callers that explicitly provide their own tools.
      anthropicBody.tools = body.tools
      if (body.tool_choice) anthropicBody.tool_choice = body.tool_choice
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify(anthropicBody),
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('[AI] Anthropic error:', err)
      return NextResponse.json({ error: 'AI service error' }, { status: 502 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json()
    totalInputTokens += data.usage?.input_tokens ?? 0
    totalOutputTokens += data.usage?.output_tokens ?? 0

    // If Claude is done (or tools are off), exit the loop with this response.
    if (data.stop_reason !== 'tool_use' || !useTools) {
      finalData = data
      break
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlocks: any[] = (data.content ?? []).filter((b: any) => b.type === 'tool_use')
    if (toolUseBlocks.length === 0) {
      finalData = data
      break
    }

    // Execute every tool Claude requested, in parallel, then feed results back.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolUseBlocks.map(async (block: any) => {
        let result: Record<string, unknown>
        try {
          result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>)
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
        }

        // Fire-and-forget audit log — never blocks the response.
        void Promise.resolve(
          adminClient
            .from('agent_actions')
            .insert({
              user_id: userRow.id,
              org_id: userRow.org_id ?? null,
              bank_id: userRow.bank_id ?? null,
              action_type: block.name,
              entity_type: 'ai_tool',
              input_summary: JSON.stringify(block.input).slice(0, 500),
              output_summary: JSON.stringify(result).slice(0, 500),
              outcome: 'error' in result ? 'error' : 'success',
              model,
            })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ).then(({ error: logErr }: { error: any }) => {
          if (logErr) console.error('[AI] agent_actions log error:', logErr)
        }).catch(() => { /* silently ignore logging failures */ })

        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        }
      })
    )

    // Append the assistant's tool_use turn + our results, then loop.
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults },
    ]
  }

  // Safety net: loop exhausted without reaching end_turn.
  if (!finalData) {
    finalData = {
      content: [{ type: 'text', text: 'I reached the maximum number of steps. Please try breaking your request into smaller parts.' }],
      stop_reason: 'end_turn',
    }
  }

  // Log aggregated token usage across all iterations as a single row.
  try {
    const { error: usageErr } = await adminClient
      .from('ai_usage')
      .insert({
        user_id: userRow.id,
        org_id: userRow.org_id ?? null,
        bank_id: userRow.bank_id ?? null,
        feature: body.feature ?? 'chat',
        tokens_input: totalInputTokens,
        tokens_output: totalOutputTokens,
        tokens_total: totalInputTokens + totalOutputTokens,
        model,
      })
    if (usageErr) console.error('[AI] Usage log error:', usageErr)
  } catch {
    // silently continue if table doesn't exist
  }

  return NextResponse.json(finalData)
}
