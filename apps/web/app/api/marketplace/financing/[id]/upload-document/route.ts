// Upload a financing contract document for a financing_request, scoped to the
// accepted bank — alternative to AI generation in the contract route.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!BANK_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Only bank users can upload financing contracts' }, { status: 403 })
  }

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('id, accepted_bank_id, status')
    .eq('id', requestId)
    .single()
  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })
  if (financingReq.accepted_bank_id !== actor.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['accepted', 'funded'].includes(financingReq.status)) {
    return NextResponse.json({ error: 'Financing request must be accepted before a contract can be issued' }, { status: 400 })
  }

  let formData: FormData
  try { formData = await req.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })

  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `financing_requests/${requestId}/contract/${Date.now()}.${ext}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await adminClient.storage
    .from('deal-documents')
    .upload(storagePath, fileBuffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadError) {
    console.error('[financing/upload-document] Storage error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      entity_type: 'financing_request',
      entity_id: requestId,
      document_kind: 'financing_contract',
    })
    .select()
    .single()
  if (docError || !doc) {
    console.error('[financing/upload-document] Document insert error:', docError)
    return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
  }

  return NextResponse.json({ document: doc })
}
