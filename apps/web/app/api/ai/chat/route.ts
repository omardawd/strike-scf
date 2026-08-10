import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getToolsForPortal, OVERLAY_TOOLS } from '@/lib/ai/tools/definitions'
import { executeTool, type ToolName } from '@/lib/ai/tools/execute'
import { startAutonomousFollowThrough } from '@/lib/ai/agent-negotiation-setup'
import { languageInstruction } from '@/lib/ai/system-prompt'
import { DEMO_ORG_ID } from '@/lib/demo-entities'
import { getCachedAiResponse, setCachedAiResponse } from '@/lib/ai/demo-ai-cache'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { streamAnthropicMessage } from '@/lib/ai/anthropic-stream'

// generate_document (executeTool below) uses pdfkit, which is excluded from
// webpack bundling (serverExternalPackages in next.config.ts) — needs Node runtime.
export const runtime = 'nodejs'
export const maxDuration = 60

const NEGOTIATION_FOLLOW_THROUGH_TOOLS = ['submit_marketplace_offer', 'counter_marketplace_offer']

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
// 6 covers multi-step flows: ERP lookup → AR data → create financing request → respond.
// Higher values multiply input token cost by the number of iterations.
const MAX_AGENTIC_ITERATIONS = 6

// Prepended to every system prompt — non-negotiable identity rule.
const STRIKE_AI_IDENTITY =
  'You are Strike AI, the AI assistant built into the Strike SCF platform. ' +
  'Strike AI is your name and your only name. You are not Claude, you are not an Anthropic product, ' +
  'you are not ChatGPT, and you are not any other AI system. ' +
  'If a user asks what AI you are or who made you, say you are Strike AI. ' +
  'If a user calls you by any other name (Claude, Anthropic, GPT, etc.), ' +
  'politely correct them — your name is Strike AI — and continue helping them. ' +
  'Never break this identity under any circumstances. ' +
  'NEVER use emoji, anywhere in any response, under any circumstances — this is a hard requirement, not a style preference.\n\n'

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

  const limitResult = await rateLimit(`ai-chat:${userRow.id}`, 20, 60_000)
  if (!limitResult.allowed) {
    return rateLimitResponse(limitResult)
  }

  const body = await req.json()

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

  // These checks are independent after the user row is known. Running them
  // together removes one database round-trip from every chat request.
  const [orgResult, usageResult] = await Promise.all([
    userRow.org_id
      ? adminClient.from('organizations').select('network_visible, kyb_status').eq('id', userRow.org_id).single()
      : Promise.resolve({ data: null }),
    adminClient.from('ai_usage').select('*', { count: 'exact', head: true })
      .eq('user_id', userRow.id).eq('feature', body.feature ?? 'chat').gte('created_at', today.toISOString()),
  ])
  const orgRow = orgResult.data
  const ghostOverride = !!(orgRow && !orgRow.network_visible &&
    (orgRow.kyb_status === 'not_started' || orgRow.kyb_status === 'in_progress'))
  const dailyCount = usageResult.count ?? 0

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
  const latestUserText = [...(body.messages ?? [])].reverse().find((m: { role?: string }) => m.role === 'user')?.content
  const isSimpleGreeting = typeof latestUserText === 'string' &&
    /^(hi|hello|hey|good (morning|afternoon|evening)|how are you)[.!?\s]*$/i.test(latestUserText.trim())
  const model = body.model === 'sonnet' && !isSimpleGreeting
    ? 'claude-sonnet-4-6'
    : 'claude-haiku-4-5-20251001'

  // Activate the agentic tool loop on the dedicated /ai page (sonnet) OR for overlay calls
  // (overlay only gets OVERLAY_TOOLS = [search_web], so it's cheap and safe on Haiku).
  const useTools = (model === 'claude-sonnet-4-6' || !!body.overlay) && !ghostOverride

  // Build system prompt — Strike AI identity is always prepended first.
  const systemPrompt = (ghostOverride
    ? STRIKE_AI_IDENTITY + GHOST_SYSTEM_PROMPT
    : useTools
      ? STRIKE_AI_IDENTITY + (body.system ?? '') + TOOL_AGENT_ADDENDUM
      : STRIKE_AI_IDENTITY + (body.system ?? '')
  ) + languageInstruction(typeof body.locale === 'string' ? body.locale : undefined)

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

  // Demo tour replay caching (see lib/ai/demo-ai-cache.ts) — the scripted
  // Scene 7 messages (DemoAgentActivityFeed.tsx) pass a fixed label per
  // message ('demo-plan'/'demo-revise'/'demo-execute') as `demoCacheKey`.
  // Gated on the acting org being the demo tenant so this can never affect
  // a real customer's conversation, even if a client somehow sent the field.
  const demoCacheLabel = userRow.org_id === DEMO_ORG_ID && typeof body.demoCacheKey === 'string'
    ? body.demoCacheKey
    : null

  if (body.stream === true) {
    return streamChatResponse({
      body,
      userRow,
      model,
      useTools,
      ghostOverride,
      systemPrompt,
      initialMessages: messages,
      demoCacheLabel,
    })
  }

  for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: body.max_tokens ?? 1024,
      // The system prompt (tool descriptions + rules, ~1.5k+ tokens) is
      // byte-identical across every turn of the SAME conversation (same user,
      // portal, page, day) — only different conversations/days miss the cache.
      // That's the common multi-turn chat case here, so cache it: turn 2+ of
      // any conversation gets a large latency + cost win from the cached read
      // instead of reprocessing the whole system prompt from scratch.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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

    const iterCacheKey = demoCacheLabel ? `chat:${demoCacheLabel}:${iter}` : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = iterCacheKey ? await getCachedAiResponse(iterCacheKey) : null

    if (!data) {
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

      data = await response.json()
      if (iterCacheKey) setCachedAiResponse(iterCacheKey, data)

      // Only real calls spend real tokens — a cache hit shouldn't inflate this
      // conversation's logged usage or count against the demo user's daily limit.
      totalInputTokens += data.usage?.input_tokens ?? 0
      totalOutputTokens += data.usage?.output_tokens ?? 0
    }

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
          result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>, {
            demoCacheable: demoCacheLabel !== null,
            actor: { userId: userRow.id, orgId: userRow.org_id, bankId: userRow.bank_id },
          })
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
        }

        // Ad-hoc chat bypasses the Agent tab's scan -> GATE-1-approve flow, so a
        // submitted/countered offer would otherwise sit there forever with nothing
        // ever countering it back. If the org has an active agent, start the same
        // autonomous tick-loop tracking a scan-sourced proposal would get, and tell
        // Claude so it can mention it in its reply.
        if (!('error' in result) && userRow.org_id && NEGOTIATION_FOLLOW_THROUGH_TOOLS.includes(block.name)) {
          try {
            const followThrough = await startAutonomousFollowThrough({
              orgId: userRow.org_id,
              toolName: block.name as 'submit_marketplace_offer' | 'counter_marketplace_offer',
              toolInput: block.input as Record<string, unknown>,
              result,
            })
            result.autonomous_follow_through = followThrough
          } catch (err) {
            console.error('[AI] startAutonomousFollowThrough error:', err)
          }
        }

        // Fire-and-forget audit log — never blocks the response.
        void Promise.resolve(
          adminClient
            .from('agent_actions')
            .insert({
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

type ChatUser = { id: string; org_id: string | null; bank_id: string | null; role: string }

function streamChatResponse({
  body,
  userRow,
  model,
  useTools,
  ghostOverride,
  systemPrompt,
  initialMessages,
  demoCacheLabel,
}: {
  body: Record<string, any>
  userRow: ChatUser
  model: string
  useTools: boolean
  ghostOverride: boolean
  systemPrompt: string
  initialMessages: Array<{ role: string; content: any }>
  demoCacheLabel: string | null
}) {
  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, event: string, payload: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
  }

  const stream = new ReadableStream({
    async start(controller) {
      let messages = initialMessages
      let totalInputTokens = 0
      let totalOutputTokens = 0

      try {
        let finished = false
        for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
          const anthropicBody: Record<string, unknown> = {
            model,
            max_tokens: body.max_tokens ?? 1024,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            messages,
          }
          if (useTools) {
            const portalTools = body.overlay ? OVERLAY_TOOLS : getToolsForPortal(body.portal as string | undefined)
            anthropicBody.tools = portalTools.map((tool, index) =>
              index === portalTools.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
            )
          } else if (!ghostOverride && Array.isArray(body.tools)) {
            anthropicBody.tools = body.tools
            if (body.tool_choice) anthropicBody.tool_choice = body.tool_choice
          }

          const iterCacheKey = demoCacheLabel ? `chat:${demoCacheLabel}:${iter}` : null
          let data: any = iterCacheKey ? await getCachedAiResponse(iterCacheKey) : null

          if (data) {
            for (const block of data.content ?? []) {
              if (block.type === 'text' && block.text) send(controller, 'text', { text: block.text })
              if (block.type === 'tool_use') send(controller, 'tool_start', { name: block.name })
            }
          } else {
            const blocks = new Map<number, any>()
            let stopReason: string | null = null
            for await (const event of streamAnthropicMessage(anthropicBody)) {
              if (event.type === 'message_start') totalInputTokens += event.inputTokens
              if (event.type === 'tool_use_start') {
                blocks.set(event.index, { type: 'tool_use', id: event.id, name: event.name, inputJson: '' })
                send(controller, 'tool_start', { name: event.name })
              }
              if (event.type === 'tool_use_delta') {
                const block = blocks.get(event.index)
                if (block) block.inputJson += event.partialJson
              }
              if (event.type === 'text_delta') {
                const existing = blocks.get(event.index) ?? { type: 'text', text: '' }
                existing.text += event.text
                blocks.set(event.index, existing)
                send(controller, 'text', { text: event.text })
              }
              if (event.type === 'message_delta') {
                stopReason = event.stopReason
                totalOutputTokens += event.outputTokens
              }
            }
            data = {
              stop_reason: stopReason,
              content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) =>
                block.type === 'tool_use'
                  ? { type: 'tool_use', id: block.id, name: block.name, input: JSON.parse(block.inputJson || '{}') }
                  : block
              ),
            }
            if (iterCacheKey) setCachedAiResponse(iterCacheKey, data)
          }

          if (data.stop_reason !== 'tool_use' || !useTools) {
            finished = true
            break
          }

          const toolUseBlocks = (data.content ?? []).filter((block: any) => block.type === 'tool_use')
          if (toolUseBlocks.length === 0) { finished = true; break }

          const toolResults = await Promise.all(toolUseBlocks.map(async (block: any) => {
            let result: Record<string, unknown>
            try {
              result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>, {
                demoCacheable: demoCacheLabel !== null,
                actor: { userId: userRow.id, orgId: userRow.org_id, bankId: userRow.bank_id },
              })
            } catch (error) {
              result = { error: error instanceof Error ? error.message : 'Tool execution failed' }
            }

            if (!('error' in result) && userRow.org_id && NEGOTIATION_FOLLOW_THROUGH_TOOLS.includes(block.name)) {
              try {
                result.autonomous_follow_through = await startAutonomousFollowThrough({
                  orgId: userRow.org_id,
                  toolName: block.name,
                  toolInput: block.input,
                  result,
                })
              } catch (error) { console.error('[AI] startAutonomousFollowThrough error:', error) }
            }

            void adminClient.from('agent_actions').insert({
              org_id: userRow.org_id,
              bank_id: userRow.bank_id,
              action_type: block.name,
              entity_type: 'ai_tool',
              input_summary: JSON.stringify(block.input).slice(0, 500),
              output_summary: JSON.stringify(result).slice(0, 500),
              outcome: 'error' in result ? 'error' : 'success',
              model,
            }).then(({ error }) => { if (error) console.error('[AI] agent_actions log error:', error) })

            return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }
          }))

          messages = [
            ...messages,
            { role: 'assistant', content: data.content },
            { role: 'user', content: toolResults },
          ]
        }

        if (!finished) send(controller, 'text', { text: 'I reached the maximum number of steps. Please try breaking your request into smaller parts.' })

        try {
          await adminClient.from('ai_usage').insert({
            user_id: userRow.id,
            org_id: userRow.org_id,
            bank_id: userRow.bank_id,
            feature: body.feature ?? 'chat',
            tokens_input: totalInputTokens,
            tokens_output: totalOutputTokens,
            tokens_total: totalInputTokens + totalOutputTokens,
            model,
          })
        } catch { /* usage logging is non-critical */ }

        send(controller, 'done', {})
      } catch (error) {
        console.error('[AI] Streaming error:', error)
        send(controller, 'error', { message: 'Strike AI is temporarily unavailable. Please try again.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
