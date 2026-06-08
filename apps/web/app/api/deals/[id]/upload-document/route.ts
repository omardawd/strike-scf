// Upload a document for a deal (commercial invoice, dispute evidence, etc.)
// Accepts multipart/form-data: file, document_kind
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('buyer_org_id, supplier_org_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  const documentKind = (formData.get('document_kind') as string | null) ?? 'deal_document'

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })

  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `deals/${id}/${documentKind}/${Date.now()}.${ext}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await adminClient.storage
    .from('deal-documents')
    .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[upload-document] Storage error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      org_id: userData.org_id,
      entity_type: 'deal',
      entity_id: id,
      document_kind: documentKind,
      name: file.name,
      storage_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
    })
    .select()
    .single()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Document record creation failed' }, { status: 500 })
  }

  // G7.1 — Duplicate commercial invoice check
  if (documentKind === 'commercial_invoice') {
    const { data: existing } = await adminClient
      .from('documents')
      .select('id, name')
      .eq('org_id', userData.org_id)
      .eq('entity_type', 'deal')
      .eq('document_kind', 'commercial_invoice')
      .neq('id', doc.id)
      .limit(1)

    if (existing && existing.length > 0) {
      // Log potential duplicate for admin review
      await adminClient.from('agent_actions').insert({
        org_id: userData.org_id,
        action_type: 'fraud_flagged',
        entity_type: 'deal',
        entity_id: id,
        reasoning: `Potential duplicate commercial invoice upload. Existing document: ${existing[0]?.id}. New document: ${doc.id}`,
        outcome: 'duplicate_invoice_warning',
        requires_approval: false,
      })

      return NextResponse.json({
        document: doc,
        warning: 'This invoice number appears to have been submitted previously. Duplicate invoices cannot be financed. Please verify this is a unique invoice.',
      })
    }
  }

  return NextResponse.json({ document: doc })
}
