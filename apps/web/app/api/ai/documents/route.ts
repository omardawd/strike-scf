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

type DocumentType =
  | 'transaction_summary'
  | 'kyb_report'
  | 'financing_request'
  | 'passport_report'
  | 'audit_log'
  // Regulatory / formal templates (merged from the live doc-generator)
  | 'bcbs_239'
  | 'mas_610'
  | 'eba_finrep'
  | 'kyb_summary'
  | 'invoice_confirmation'
  | 'anchor_payment_notice'
  | 'custom'

interface DocumentRequest {
  type: DocumentType
  context: Record<string, unknown>
}

const SYSTEM_PROMPTS: Record<Exclude<DocumentType, 'custom'>, string> = {
  transaction_summary:
    'Generate a professional transaction summary document in Markdown. Include: transaction ID, parties, amounts, status, timeline, key terms. Use only data from context.',
  kyb_report:
    'Generate a KYB due diligence report in Markdown. Include: business identity, KYB status, risk tier, document completeness, credit assessment, recommendation.',
  financing_request:
    'Generate a financing request document in Markdown. Include: requesting party, financing structure, amount, invoice details, counterparty PassportScore, recommended terms.',
  passport_report:
    'Generate a PassportScore report in Markdown. Include: organization identity, score breakdown (KYB/Compliance 25pts, Financial Health 25pts, Trade History 25pts, Platform Behavior 25pts), total score, tier, key flags.',
  audit_log:
    'Generate a transaction audit log in Markdown. Include: all status transitions with timestamps, actor names, action types, notes. Format as a chronological table.',
  bcbs_239:
    'Generate a BCBS 239 compliant risk data aggregation report in Markdown. Include: risk data identification, aggregation capabilities assessment, risk reporting frequency, data accuracy attestation, and recommended actions. Format as a formal regulatory report.',
  mas_610:
    'Generate a MAS Notice 610 credit facilities report in Markdown. Include: credit facility details, obligor information, exposure classification, collateral details, and risk grading. Follow MAS reporting standards.',
  eba_finrep:
    'Generate an EBA FinRep financial report entry in Markdown. Include: counterparty details, exposure amount, impairment assessment, collateral coverage, and IFRS 9 stage classification.',
  kyb_summary:
    'Generate a comprehensive KYB due diligence summary report in Markdown. Include: entity verification, beneficial ownership analysis, risk assessment, document verification status, and compliance recommendation.',
  invoice_confirmation:
    'Generate a formal invoice financing confirmation letter in Markdown. Include: parties, invoice details, financing terms, disbursement confirmation, and repayment schedule.',
  anchor_payment_notice:
    'Generate a formal payment notice to the anchor/buyer in Markdown. Include: payment obligation, amount due, due date, payment instructions, and consequences of late payment.',
}

const VALID_TYPES: DocumentType[] = [
  'transaction_summary',
  'kyb_report',
  'financing_request',
  'passport_report',
  'audit_log',
  'bcbs_239',
  'mas_610',
  'eba_finrep',
  'kyb_summary',
  'invoice_confirmation',
  'anchor_payment_notice',
  'custom',
]

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

  const body = (await req.json()) as Partial<DocumentRequest>
  const type = body.type
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
  }
  const context = body.context ?? {}

  // 3. Rate limit — daily document quota
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let dailyCount = 0
  try {
    const { count } = await adminClient
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userRow.id)
      .eq('feature', 'document')
      .gte('created_at', today.toISOString())
    dailyCount = count ?? 0
  } catch {
    // silently continue if table doesn't exist
  }

  if (dailyCount >= (DAILY_LIMITS.document ?? 20)) {
    return NextResponse.json({
      error: 'Daily document limit reached',
      limit_type: 'daily',
      feature: 'document',
      reset_at: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }, { status: 429 })
  }

  // 4. Build system prompt
  const baseRules =
    '\n\nRules: Use ONLY data explicitly provided in the context below. Never invent figures, names, dates, or amounts. Format currency as $X,XXX. Use proper Markdown — ## headers, **bold labels**, and | tables | where appropriate. Be professional and ready to download. Output the document only, with no preamble.'

  let system: string
  if (type === 'custom') {
    const templateText = typeof context.templateText === 'string' ? context.templateText : ''
    const instructions = typeof context.instructions === 'string' ? context.instructions : ''
    if (templateText) {
      // Uploaded-template flow: fill the provided template with context data.
      system =
        'You are a document completion specialist. Fill in the provided template using the data in the context below. Maintain the exact structure and format of the template. Replace placeholder fields with real data; if a value is unavailable, write [NOT PROVIDED]. Output the completed document in Markdown only, with no preamble.' +
        `\n\nTemplate to fill:\n\n${templateText}` +
        baseRules
    } else {
      system =
        'Generate a professional document in Markdown based on the following instructions.' +
        (instructions ? `\n\nInstructions: ${instructions}` : '') +
        baseRules
    }
  } else {
    system = SYSTEM_PROMPTS[type] + baseRules
  }

  const userMessage = `Document context:\n${JSON.stringify(context, null, 2)}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    console.error('[AI] Document Anthropic error:', err)
    return NextResponse.json({ error: 'AI service error' }, { status: 502 })
  }

  const data = await response.json()
  const content: string =
    data.content?.find((b: { type: string; text?: string }) => b.type === 'text')?.text ??
    data.content?.[0]?.text ??
    ''
  const usage = data.usage ?? {}

  // 5. Log usage
  try {
    const { error: usageErr } = await adminClient
      .from('ai_usage')
      .insert({
        user_id: userRow.id,
        org_id: userRow.org_id ?? null,
        bank_id: userRow.bank_id ?? null,
        feature: 'document',
        tokens_input: usage.input_tokens ?? 0,
        tokens_output: usage.output_tokens ?? 0,
        tokens_total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: 'claude-sonnet-4-6',
      })
    if (usageErr) console.error('[AI] Usage log error:', usageErr)
  } catch {
    // silently continue if table doesn't exist
  }

  return NextResponse.json({
    content,
    filename: `strike_${type}_${Date.now()}.md`,
    generatedAt: new Date().toISOString(),
  })
}
