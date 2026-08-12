// Finalizes an RFx draft into a persisted `documents` row — the same
// convergence point contract generation uses (`contract_document_id`), so the
// editor's output slots straight into ContractSubmitForm/FinancingManagementCard's
// existing preview-before-send flow, and into a listing's "Documents" list.
// POST /api/ai/rfx/[id]/attach
// Body: { entity_id? } — required if the draft was started before its listing existed.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: draft } = await adminClient.from('rfx_drafts').select('*').eq('id', id).single()
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const entityId: string | undefined = body?.entity_id ?? draft.entity_id ?? undefined
  if (!entityId) return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })

  if (draft.entity_type === 'deal') {
    const { data: deal } = await adminClient.from('deals').select('buyer_org_id, supplier_org_id').eq('id', entityId).single()
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    const { data: listing } = await adminClient.from('marketplace_listings').select('org_id').eq('id', entityId).single()
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
    if (listing.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const docType: 'rfx' | 'invoice' = draft.doc_type === 'invoice' ? 'invoice' : 'rfx'
  const docKind = docType === 'invoice' ? 'invoice_document' : 'rfx_document'
  const docLabel = docType === 'invoice' ? 'Invoice Draft' : 'RFx Draft'
  const shortId = id.slice(0, 8).toUpperCase()
  const storagePath = `${draft.entity_type === 'deal' ? 'deals' : 'listings'}/${entityId}/${docType}-${shortId}.md`
  const fileBytes = Buffer.from(draft.content, 'utf-8')

  const { error: uploadError } = await adminClient.storage.from('deal-documents').upload(storagePath, fileBytes, {
    contentType: 'text/markdown',
    upsert: true,
  })
  if (uploadError) {
    console.error('[rfx/attach] storage upload error', uploadError)
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      name: draft.title || `${docLabel} - ${shortId}`,
      storage_path: storagePath,
      mime_type: 'text/markdown',
      file_size_bytes: fileBytes.length,
      entity_type: draft.entity_type,
      entity_id: entityId,
      document_kind: docKind,
    })
    .select()
    .single()

  if (docError || !doc) {
    console.error('[rfx/attach] document insert error', docError)
    return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
  }

  await adminClient
    .from('rfx_drafts')
    .update({ document_id: doc.id, entity_id: entityId, status: 'finalized', updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ document_id: doc.id, content: draft.content })
}
