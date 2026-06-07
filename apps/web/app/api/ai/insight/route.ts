import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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

interface InsightAction {
  label: string
  href?: string
  prompt?: string
}

interface InsightResult {
  insight: string
  actions: InsightAction[]
}

const FALLBACK: InsightResult = {
  insight: 'Strike AI is analyzing your data.',
  actions: [],
}

function parseInsight(raw: string): InsightResult {
  try {
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (!parsed || typeof parsed !== 'object') return FALLBACK
    const obj = parsed as Record<string, unknown>
    if (typeof obj.insight !== 'string' || obj.insight.length === 0) return FALLBACK

    const actions: InsightAction[] = []
    if (Array.isArray(obj.actions)) {
      for (const a of obj.actions.slice(0, 2)) {
        if (a && typeof a === 'object') {
          const action = a as Record<string, unknown>
          if (typeof action.label === 'string') {
            actions.push({
              label: action.label,
              href: typeof action.href === 'string' ? action.href : undefined,
              prompt: typeof action.prompt === 'string' ? action.prompt : undefined,
            })
          }
        }
      }
    }
    return { insight: obj.insight, actions }
  } catch {
    return FALLBACK
  }
}

export async function POST(req: NextRequest) {
  // 1. Auth — anon client only for getUser()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. User row — admin client
  const { data: userRow } = await adminClient
    .from('users')
    .select('id, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const page: string = typeof body.page === 'string' ? body.page : 'dashboard'
  const portal: string = typeof body.portal === 'string' ? body.portal : 'bank'
  const data: Record<string, unknown> =
    body.data && typeof body.data === 'object' ? body.data : {}

  // 3. Rate limit — daily insight quota
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let dailyCount = 0
  try {
    const { count } = await adminClient
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userRow.id)
      .eq('feature', 'insight')
      .gte('created_at', today.toISOString())
    dailyCount = count ?? 0
  } catch {
    // silently continue if table doesn't exist
  }

  if (dailyCount >= (DAILY_LIMITS.insight ?? 200)) {
    return NextResponse.json({
      error: 'Daily insight limit reached',
      limit_type: 'daily',
      feature: 'insight',
      reset_at: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }, { status: 429 })
  }

  const system = `You are Strike AI generating a brief contextual insight for a supply chain finance platform user.
Portal: ${portal}
Page: ${page}
Data: ${JSON.stringify(data)}
Respond with ONLY valid JSON, no markdown, no preamble:
{
"insight": "one or two sentence insight, specific to the data shown, actionable",
"actions": [
{ "label": "short action label", "href": "/optional-route" },
{ "label": "short prompt action", "prompt": "message to send to Strike AI" }
]
}
Max 2 actions. Actions are optional. insight is required. Be specific — reference actual numbers from the data. Never be generic.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system,
      messages: [{ role: 'user', content: 'Generate the insight JSON for this page.' }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    console.error('[AI] Insight Anthropic error:', err)
    return NextResponse.json(FALLBACK)
  }

  const result = await response.json()
  const raw: string = result.content?.[0]?.text ?? ''
  const parsed = parseInsight(raw)
  const usage = result.usage ?? {}

  // Log usage
  try {
    const { error: usageErr } = await adminClient
      .from('ai_usage')
      .insert({
        user_id: userRow.id,
        org_id: userRow.org_id ?? null,
        bank_id: userRow.bank_id ?? null,
        feature: 'insight',
        tokens_input: usage.input_tokens ?? 0,
        tokens_output: usage.output_tokens ?? 0,
        tokens_total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: 'claude-haiku-4-5-20251001',
      })
    if (usageErr) console.error('[AI] Usage log error:', usageErr)
  } catch {
    // silently continue if table doesn't exist
  }

  return NextResponse.json(parsed)
}
