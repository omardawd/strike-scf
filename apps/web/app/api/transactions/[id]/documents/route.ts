import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SUPPLIER_ROLES = ['supplier_admin', 'supplier_member']
const ANCHOR_ROLES   = ['anchor_admin', 'anchor_member']
const BANK_ROLES     = ['bank_admin', 'bank_credit_officer']

const VALID_KINDS = [
  'invoice_pdf',
  'purchase_order',
  'delivery_confirmation',
  'supporting_document',
]

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: transaction } = await adminClient
    .from('transactions')
    .select('id, status, supplier_id, anchor_id, bank_id')
    .eq('id', id)
    .single()

  if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const hasAccess =
    (SUPPLIER_ROLES.includes(userData.role) && transaction.supplier_id === userData.org_id) ||
    (ANCHOR_ROLES.includes(userData.role)   && transaction.anchor_id   === userData.org_id) ||
    (BANK_ROLES.includes(userData.role)     && transaction.bank_id     === userData.bank_id)

  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: docs, error } = await adminClient
    .from('documents')
    .select('id, name, document_kind, mime_type, size_bytes, storage_path, created_at')
    .eq('entity_type', 'transaction')
    .eq('entity_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })

  const docsWithUrls = await Promise.all(
    (docs ?? []).map(async doc => {
      const { data: urlData } = await adminClient
        .storage
        .from('transaction-documents')
        .createSignedUrl(doc.storage_path, 3600)
      return {
        ...doc,
        signed_url: urlData?.signedUrl ?? null,
      }
    })
  )

  return NextResponse.json({ documents: docsWithUrls })
}

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
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: transaction } = await adminClient
    .from('transactions')
    .select('id, status, supplier_id, anchor_id, bank_id')
    .eq('id', id)
    .single()

  if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const hasAccess =
    (SUPPLIER_ROLES.includes(userData.role) && transaction.supplier_id === userData.org_id) ||
    (ANCHOR_ROLES.includes(userData.role)   && transaction.anchor_id   === userData.org_id) ||
    (BANK_ROLES.includes(userData.role)     && transaction.bank_id     === userData.bank_id)

  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const document_kind = formData.get('document_kind') as string | null

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!document_kind || !VALID_KINDS.includes(document_kind)) {
    return NextResponse.json({ error: `document_kind must be one of: ${VALID_KINDS.join(', ')}` }, { status: 400 })
  }

  const filename = file.name
  const storagePath = `${id}/${document_kind}/${filename}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await adminClient.storage
    .from('transaction-documents')
    .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      name:                 filename,
      storage_path:         storagePath,
      mime_type:            file.type,
      size_bytes:           file.size,
      uploaded_by_user_id:  user.id,
      entity_type:          'transaction',
      entity_id:            id,
      document_kind,
    })
    .select('id')
    .single()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Failed to record document' }, { status: 500 })
  }

  const actorType = SUPPLIER_ROLES.includes(userData.role) ? 'supplier'
    : ANCHOR_ROLES.includes(userData.role) ? 'anchor'
    : 'bank'

  await adminClient.from('transaction_events').insert({
    transaction_id: id,
    event_type:     'document_uploaded',
    from_status:    transaction.status,
    to_status:      transaction.status,
    actor_id:       user.id,
    actor_type:     actorType,
    notes:          filename,
  })

  return NextResponse.json({ document_id: doc.id, storage_path: storagePath }, { status: 201 })
}
