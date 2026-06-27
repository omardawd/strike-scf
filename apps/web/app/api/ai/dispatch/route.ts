// Strike AI Dispatch — external trigger endpoint.
// Accepts authenticated POST requests from phones, ERPNext webhooks, or any HTTP client.
// Auth: Bearer <dispatch_token> (stored in erp_connections.dispatch_token).

import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getToolsForPortal } from '@/lib/ai/tools/definitions'
import { executeTool, type ToolName } from '@/lib/ai/tools/execute'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_AGENTIC_ITERATIONS = 3

const STRIKE_AI_IDENTITY =
  'You are Strike AI, the AI assistant built into the Strike SCF platform. ' +
  'You are not Claude, not an Anthropic product. Your name is Strike AI. ' +
  'Never break this identity.\n\n'

const DISPATCH_SYSTEM =
  STRIKE_AI_IDENTITY +
  'You are operating in DISPATCH mode — a message was sent externally (from a phone or ERP system). ' +
  'Act immediately and autonomously. Analyze any data signals provided in the context, ' +
  'call the appropriate tools to take action, and return a clear summary of what you did or found. ' +
  'Be concise. If no specific action is requested, scan the org\'s ERP signals and report any advisories.'

export async function POST(req: NextRequest) {
  // Verify dispatch token
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })

  const { data: conn } = await adminClient
    .from('erp_connections')
    .select('id, org_id, dispatch_token')
    .eq('dispatch_token', token)
    .eq('status', 'active')
    .single()

  if (!conn) return NextResponse.json({ error: 'Invalid or inactive dispatch token' }, { status: 401 })

  const orgId = conn.org_id

  // Look up org + a representative user for context
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, type, legal_name, doing_business_as')
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
  const userMessage: string = body.message ?? 'Check my ERP data and report any advisories or actions I should take.'
  const source: string = body.source ?? 'api'

  const portal = org?.type === 'anchor' ? 'anchor' : 'supplier'
  const portalTools = getToolsForPortal(portal)

  // Inject ERP + org context as a system message
  const contextNote =
    `Org context: ${org?.doing_business_as ?? org?.legal_name ?? orgId} (${portal} portal, org_id: ${orgId}). ` +
    `Message source: ${source}.`

  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userMessage },
  ]

  let finalData: Record<string, unknown> | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0
  const model = 'claude-sonnet-4-6'

  for (let iter = 0; iter < MAX_AGENTIC_ITERATIONS; iter++) {
    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      system: `${DISPATCH_SYSTEM}\n\n${contextNote}`,
      messages,
      tools: portalTools,
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify(anthropicBody),
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('[Dispatch] Anthropic error:', err)
      return NextResponse.json({ error: 'AI service error' }, { status: 502 })
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

        // Audit log (fire-and-forget)
        void adminClient.from('agent_actions').insert({
          user_id: adminUser?.id ?? null,
          org_id: orgId,
          action_type: block.name,
          entity_type: 'ai_dispatch',
          input_summary: JSON.stringify(block.input).slice(0, 500),
          output_summary: JSON.stringify(result).slice(0, 500),
          outcome: 'error' in result ? 'error' : 'success',
          model,
          reasoning: `Dispatched from ${source}`,
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
  })
}
