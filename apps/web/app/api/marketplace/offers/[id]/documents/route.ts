// Upload a supplier quote document (spec sheet, certification, etc.) and
// attach it to an offer. This is the ONLY way marketplace_offers.document_ids
// is ever populated — the offer submit/counter body never accepts a raw
// document_ids array, so there is no client-supplied-ID trust surface here:
// the document is created fresh, by the authorized offeror, for this exact
// offer, and its id is server-appended, never taken from the request body.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sanitizeFilename, validateUpload } from '@/lib/uploads/validate'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: offerId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('id, from_org_id, document_ids')
    .eq('id', offerId)
    .single()
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  // Only the offeror can attach documents to their own quote — not the
  // listing owner, not any other party.
  if (offer.from_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Only the offeror can attach documents to this offer' }, { status: 403 })
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })

  const validation = validateUpload(file)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const safeName = sanitizeFilename(file.name)
  const storagePath = `offers/${offerId}/${Date.now()}-${safeName}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await adminClient.storage
    .from('deal-documents')
    .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false })
  if (uploadError) {
    console.error('[offer documents] Storage error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      org_id: userData.org_id,
      entity_type: 'offer',
      entity_id: offerId,
      document_kind: 'quote_document',
      name: safeName,
      storage_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
    })
    .select()
    .single()
  if (docError || !doc) {
    return NextResponse.json({ error: 'Document record creation failed' }, { status: 500 })
  }

  const updatedDocumentIds = [...(offer.document_ids ?? []), doc.id]
  const { data: updatedOffer, error: updateError } = await adminClient
    .from('marketplace_offers')
    .update({ document_ids: updatedDocumentIds })
    .eq('id', offerId)
    .select('id, document_ids')
    .single()
  if (updateError || !updatedOffer) {
    return NextResponse.json({ error: 'Failed to attach document to offer' }, { status: 500 })
  }

  return NextResponse.json({ document: doc, offer: updatedOffer })
}
