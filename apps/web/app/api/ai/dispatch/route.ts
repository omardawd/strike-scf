// Strike AI Dispatch — external trigger endpoint.
// Accepts authenticated POST requests from phones, ERPNext webhooks, or any HTTP client.
// Auth: Bearer <dispatch_token>, validated against erp_connections.dispatch_token_hash
// (sha256 of the raw token — the raw value itself is never stored; see
// lib/erp/dispatch-token.ts and ASSESSMENT.md P0-4).

import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getToolsForPortal } from '@/lib/ai/tools/definitions'
import { executeTool, type ToolName } from '@/lib/ai/tools/execute'
import { startAutonomousFollowThrough } from '@/lib/ai/agent-negotiation-setup'
import { rateLimit } from '@/lib/rate-limit'
import { hashDispatchToken, isDispatchTokenValid } from '@/lib/erp/dispatch-token'
import { logger } from '@/lib/logger'

const NEGOTIATION_FOLLOW_THROUGH_TOOLS = ['submit_marketplace_offer', 'counter_marketplace_offer']

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_AGENTIC_ITERATIONS = 3

const STRIKE_AI_IDENTITY =
  'You are Strike AI, the AI assistant built into the Strike SCF platform. ' +
  'You are not Claude, not an Anthropic product. Your name is Strike AI. ' +
  'Never break this identity. ' +
  'NEVER use emoji, anywhere in any response, under any circumstances — this is a hard requirement, not a style preference.\n\n'

const DISPATCH_SYSTEM =
  STRIKE_AI_IDENTITY +
  'You are operating in DISPATCH mode — accessible from a phone or ERP system. ' +
  'Respond naturally to whatever the user says. If they greet you, greet them back and ask how you can help. ' +
  'Only call tools when the user asks about their finances, ERP data, deals, inventory, or wants to take an action. ' +
  'Never proactively dump ERP data unless the user asks for it. Keep responses concise and conversational.'

// Restricted to explicitly configured origins — unset/empty means no CORS
// headers at all, which is correct for this route's actual current callers
// (native phone apps and server-to-server ERP webhooks don't send/enforce
// CORS; the in-app /dispatch page is same-origin and needs no CORS either).
// Only set DISPATCH_ALLOWED_ORIGINS if a genuine cross-origin browser
// caller is added later.
const ALLOWED_ORIGINS = (process.env.DISPATCH_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    Vary: 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: NextRequest) {
  const CORS_HEADERS = corsHeaders(req)

  // Verify dispatch token — hash-compare, never a plaintext match (P0-4).
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401, headers: CORS_HEADERS })

  const tokenHash = hashDispatchToken(token)
  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, org_id, status, dispatch_token_revoked_at, dispatch_token_expires_at, dispatch_token_scopes')
    .eq('dispatch_token_hash', tokenHash)
    .single()

  if (!conn || !isDispatchTokenValid(conn)) {
    return NextResponse.json({ error: 'Invalid, inactive, expired, or revoked dispatch token' }, { status: 401, headers: CORS_HEADERS })
  }

  const orgId = conn.org_id

  const limitResult = await rateLimit(`ai-dispatch:${orgId}`, 20, 60_000)
  if (!limitResult.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limitResult.resetAt - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'Too many requests', retry_after_seconds: retryAfterSeconds },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfterSeconds) } }
    )
  }

  // Replay protection: an Idempotency-Key reused within 5 minutes is
  // rejected rather than re-executed. Scoped per-org so one caller's key
  // choices can't collide with another's.
  const idempotencyKey = req.headers.get('Idempotency-Key')
  if (idempotencyKey) {
    const idempotencyResult = await rateLimit(`ai-dispatch-idempotency:${orgId}:${idempotencyKey}`, 1, 5 * 60_000)
    if (!idempotencyResult.allowed) {
      return NextResponse.json(
        { error: 'Duplicate request: this Idempotency-Key was already used within the last 5 minutes' },
        { status: 409, headers: CORS_HEADERS }
      )
    }
  }

  logger.info('ai/dispatch request', { orgId, requestId: req.headers.get('x-request-id') ?? undefined })

  // Look up org + a representative user for context
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as')
    .eq('id', orgId)
    .single()

  const { data: adminUser } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('org_id', orgId)
    .eq('role', 'org_admin')
    .limit(1)
    .single()

  const body = await req.json().catch(() => ({}))
  const userMessage: string = body.message ?? 'Hi'
  const source: string = body.source ?? 'api'
  const history: Array<{ role: string; content: string }> = body.history ?? []

  const portalTools = getToolsForPortal('org')

  // Inject ERP + org context as a system message
  const contextNote =
    `Org context: ${org?.doing_business_as ?? org?.legal_name ?? orgId} (org_id: ${orgId}). ` +
    `Message source: ${source}.`

  // Build messages: prior conversation history + current message
  const messages: Array<{ role: string; content: unknown }> = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let finalData: Record<string, unknown> | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0
  const model = 'claude-sonnet-4-6'

  for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
    // portalTools is static per portal type — cache_control on the last entry
    // (mirrors app/api/ai/chat/route.ts's already-working pattern) caches
    // everything before it too.
    const toolsWithCache = portalTools.map((t, i) =>
      i === portalTools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    )
    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      system: `${DISPATCH_SYSTEM}\n\n${contextNote}`,
      messages,
      tools: toolsWithCache,
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
      console.error('[Dispatch] Anthropic error:', err)
      return NextResponse.json({ error: 'AI service error' }, { status: 502, headers: CORS_HEADERS })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json()
    totalInputTokens += data.usage?.input_tokens ?? 0
    totalOutputTokens += data.usage?.output_tokens ?? 0

    if (data.stop_reason !== 'tool_use') {
      finalData = data
      break
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolBlocks: any[] = (data.content ?? []).filter((b: any) => b.type === 'tool_use')
    if (!toolBlocks.length) { finalData = data; break }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolBlocks.map(async (block: any) => {
        let result: Record<string, unknown>
        try {
          result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>)
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'Tool failed' }
        }

        if (!('error' in result) && orgId && NEGOTIATION_FOLLOW_THROUGH_TOOLS.includes(block.name)) {
          try {
            result.autonomous_follow_through = await startAutonomousFollowThrough({
              orgId,
              toolName: block.name as 'submit_marketplace_offer' | 'counter_marketplace_offer',
              toolInput: block.input as Record<string, unknown>,
              result,
            })
          } catch (err) {
            console.error('[Dispatch] startAutonomousFollowThrough error:', err)
          }
        }

        // Audit log (fire-and-forget)
        void adminClient.from('agent_actions').insert({
          org_id: orgId,
          action_type: block.name,
          entity_type: 'ai_dispatch',
          input_summary: JSON.stringify(block.input).slice(0, 500),
          output_summary: JSON.stringify(result).slice(0, 500),
          outcome: 'error' in result ? 'error' : 'success',
          model,
          reasoning: `Dispatched from ${adminUser?.id ?? 'unknown'} — ${source}`,
        })

        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }
      })
    )

    messages.push(
      { role: 'assistant', content: data.content },
      { role: 'user', content: toolResults }
    )
  }

  if (!finalData) {
    finalData = {
      content: [{ type: 'text', text: 'Reached max steps. Try a more specific request.' }],
      stop_reason: 'end_turn',
    }
  }

  // Log usage
  void adminClient.from('ai_usage').insert({
    user_id: adminUser?.id ?? null,
    org_id: orgId,
    feature: 'chat',
    tokens_input: totalInputTokens,
    tokens_output: totalOutputTokens,
    tokens_total: totalInputTokens + totalOutputTokens,
    model,
  })

  // Extract plain text from response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textContent = (finalData.content as any[] ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')

  return NextResponse.json({
    response: textContent,
    model,
    tokens: totalInputTokens + totalOutputTokens,
    source,
  }, { headers: CORS_HEADERS })
}
