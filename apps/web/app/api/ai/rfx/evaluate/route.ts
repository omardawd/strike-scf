// Re-scores an edited RFx draft, or evaluates a freshly-uploaded RFx document.
// POST /api/ai/rfx/evaluate
// - JSON body { draft_id, content } — re-score after an edit
// - multipart { file, entity_type, entity_id? } — evaluate an uploaded document
//   (creates the draft row with source: 'uploaded')
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { validateUpload, DOCUMENT_MIME_TYPES } from '@/lib/uploads/validate'
import { callClaude } from '@/lib/ai'
import { scoreRfxContent, benchmarkRfxPricing, fileToContentBlockOrText, type RfxContext, type RfxDocType, type ClaudeContentBlock } from '@/lib/ai/rfx/core'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return null
  return { user, userData }
}

async function assertEntityOwnership(entityType: string, entityId: string | undefined, orgId: string) {
  if (!entityId) return true
  if (entityType === 'deal') {
    const { data: deal } = await adminClient.from('deals').select('buyer_org_id, supplier_org_id').eq('id', entityId).single()
    if (!deal) return false
    return deal.buyer_org_id === orgId || deal.supplier_org_id === orgId
  }
  if (entityType === 'listing') {
    const { data: listing } = await adminClient.from('marketplace_listings').select('org_id').eq('id', entityId).single()
    return listing?.org_id === orgId
  }
  return false
}

async function extractTextFromUpload(block: ClaudeContentBlock | undefined, text: string | undefined): Promise<string> {
  if (text) return text
  if (!block) return ''
  const result = await callClaude({
    system: 'You transcribe documents into clean plain text/markdown. Respond with ONLY the document content — no commentary.',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      // callClaude's message content is typed as string, but the underlying
      // Anthropic API accepts content blocks — this mirrors the same
      // as-unknown-as-string pattern extract/route.ts uses for image/document blocks.
      content: [block, { type: 'text', text: 'Transcribe this document into clean markdown.' }] as unknown as string,
    }],
  })
  return result.text
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { userData } = auth

  const limitResult = await rateLimit(`rfx-evaluate:${userData.id}`, 20, 60_000)
  if (!limitResult.allowed) return rateLimitResponse(limitResult)

  const contentType = req.headers.get('content-type') ?? ''

  // ── Upload path ──────────────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const entityType = form.get('entity_type') as string | null
    const entityId = (form.get('entity_id') as string | null) ?? undefined
    const docType: RfxDocType = form.get('doc_type') === 'invoice' ? 'invoice' : 'rfx'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (entityType !== 'listing' && entityType !== 'deal') {
      return NextResponse.json({ error: 'entity_type must be "listing" or "deal"' }, { status: 400 })
    }

    const validation = validateUpload(file, { allowedMimeTypes: [...DOCUMENT_MIME_TYPES, ''] })
    if (!validation.ok && file.type) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File exceeds the 20MB limit' }, { status: 400 })
    }

    const owns = await assertEntityOwnership(entityType, entityId, userData.org_id)
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const extracted = await fileToContentBlockOrText(file)
    if (extracted.error) return NextResponse.json({ error: extracted.error }, { status: 400 })

    let content: string
    try {
      content = await extractTextFromUpload(extracted.block, extracted.text)
    } catch (e) {
      console.error('[rfx/evaluate] transcription error', e)
      return NextResponse.json({ error: 'Could not read the uploaded document.' }, { status: 502 })
    }
    if (!content.trim()) {
      return NextResponse.json({ error: 'Could not read the uploaded document.' }, { status: 400 })
    }

    const ctx: RfxContext = {}
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
        entity_type: entityType,
        entity_id: entityId ?? null,
        source: 'uploaded',
        doc_type: docType,
        title: file.name,
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
      console.error('[rfx/evaluate] insert error', insertError)
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

  // ── Re-score after edit (existing draft), or create one from manually-typed
  // content the first time the editor has no draft_id yet ────────────────────
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { draft_id, content, entity_type, entity_id, doc_type } = body as {
    draft_id?: string; content?: string; entity_type?: string; entity_id?: string; doc_type?: string
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  const docType: RfxDocType = doc_type === 'invoice' ? 'invoice' : 'rfx'

  let draft: { id: string; org_id: string; content_version: number | null } | null = null

  if (draft_id) {
    const { data } = await adminClient.from('rfx_drafts').select('id, org_id, content_version').eq('id', draft_id).single()
    if (!data) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (data.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    draft = data
  } else {
    if (entity_type !== 'listing' && entity_type !== 'deal') {
      return NextResponse.json({ error: 'entity_type is required when draft_id is not provided' }, { status: 400 })
    }
    const owns = await assertEntityOwnership(entity_type, entity_id, userData.org_id)
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ctx: RfxContext = {}
  const [scoreResult, benchmark] = await Promise.all([
    scoreRfxContent(content, ctx, docType),
    benchmarkRfxPricing(ctx),
  ])
  const combinedHighlights = [...scoreResult.highlights, ...benchmark.highlights].slice(0, 8)

  let resultDraftId: string
  if (draft) {
    resultDraftId = draft.id
    await adminClient
      .from('rfx_drafts')
      .update({
        content,
        content_version: (draft.content_version ?? 1) + 1,
        overall_score: scoreResult.overall_score,
        section_scores: scoreResult.section_scores,
        highlights: combinedHighlights,
        price_assessment: benchmark.price_assessment,
        ai_scored: scoreResult.ai_scored,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.id)
  } else {
    const { data: created, error: insertError } = await adminClient
      .from('rfx_drafts')
      .insert({
        org_id: userData.org_id,
        created_by: userData.id,
        entity_type,
        entity_id: entity_id ?? null,
        source: 'manual',
        doc_type: docType,
        content,
        overall_score: scoreResult.overall_score,
        section_scores: scoreResult.section_scores,
        highlights: combinedHighlights,
        price_assessment: benchmark.price_assessment,
        ai_scored: scoreResult.ai_scored,
      })
      .select()
      .single()
    if (insertError || !created) {
      console.error('[rfx/evaluate] insert error', insertError)
      return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
    }
    resultDraftId = created.id
  }

  return NextResponse.json({
    draft_id: resultDraftId,
    content,
    overall_score: scoreResult.overall_score,
    section_scores: scoreResult.section_scores,
    highlights: combinedHighlights,
    price_assessment: benchmark.price_assessment,
    ai_scored: scoreResult.ai_scored,
  })
}
