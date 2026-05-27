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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: body.max_tokens ?? 1024,
      system: body.system,
      messages: body.messages,
    }),
  })

  if (!response.ok) {
    const err = await response.json()
    console.error('[AI] Anthropic error:', err)
    return NextResponse.json({ error: 'AI service error' }, { status: 502 })
  }

  const data = await response.json()
  const usage = data.usage ?? {}

  try {
    const { error: usageErr } = await adminClient
      .from('ai_usage')
      .insert({
        user_id: userRow.id,
        org_id: userRow.org_id ?? null,
        bank_id: userRow.bank_id ?? null,
        feature: body.feature ?? 'chat',
        tokens_input: usage.input_tokens ?? 0,
        tokens_output: usage.output_tokens ?? 0,
        tokens_total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: 'claude-haiku-4-5-20251001',
      })
    if (usageErr) console.error('[AI] Usage log error:', usageErr)
  } catch {
    // silently continue if table doesn't exist
  }

  return NextResponse.json(data)
}
