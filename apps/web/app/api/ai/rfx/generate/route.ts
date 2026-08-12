// AI-generates a fresh RFx draft for a po_request listing (not yet created,
// entity_id omitted) or a deal's contract-submission step (entity_id = deal id).
// POST /api/ai/rfx/generate
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { generateRfxDraft, scoreRfxContent, benchmarkRfxPricing, type RfxContext, type RfxDocType } from '@/lib/ai/rfx/core'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const limitResult = await rateLimit(`rfx-generate:${user.id}`, 10, 60_000)
  if (!limitResult.allowed) return rateLimitResponse(limitResult)

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { entity_type, entity_id, context, doc_type } = body as { entity_type?: string; entity_id?: string; context?: RfxContext; doc_type?: string }
  if (entity_type !== 'listing' && entity_type !== 'deal') {
    return NextResponse.json({ error: 'entity_type must be "listing" or "deal"' }, { status: 400 })
  }
  const docType: RfxDocType = doc_type === 'invoice' ? 'invoice' : 'rfx'

  if (entity_type === 'deal' && entity_id) {
    const { data: deal } = await adminClient.from('deals').select('buyer_org_id, supplier_org_id').eq('id', entity_id).single()
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
    if (!isParty) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (entity_type === 'listing' && entity_id) {
    const { data: listing } = await adminClient.from('marketplace_listings').select('org_id').eq('id', entity_id).single()
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    if (listing.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ctx = context ?? {}

  let content: string
  try {
    content = await generateRfxDraft(ctx, docType)
  } catch (e) {
    console.error('[rfx/generate] generation error', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 502 })
  }

  const [scoreResult, benchmark] = await Promise.all([
    scoreRfxContent(content, ctx, docType),
    benchmarkRfxPricing(ctx),
  ])

  const combinedHighlights = [...scoreResult.highlights, ...benchmark.highlights].slice(0, 8)

  const { data: draft, error: insertError } = await adminClient
    .from('rfx_drafts')
    .insert({
      org_id: userData.org_id,
      created_by: userData.id,
      entity_type,
      entity_id: entity_id ?? null,
      source: 'ai_generated',
      doc_type: docType,
      title: ctx.title ?? null,
      content,
      overall_score: scoreResult.overall_score,
      section_scores: scoreResult.section_scores,
      highlights: combinedHighlights,
      price_assessment: benchmark.price_assessment,
      ai_scored: scoreResult.ai_scored,
    })
    .select()
    .single()

  if (insertError || !draft) {
    console.error('[rfx/generate] insert error', insertError)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  return NextResponse.json({
    draft_id: draft.id,
    content,
    overall_score: scoreResult.overall_score,
    section_scores: scoreResult.section_scores,
    highlights: combinedHighlights,
    price_assessment: benchmark.price_assessment,
    ai_scored: scoreResult.ai_scored,
  })
}
