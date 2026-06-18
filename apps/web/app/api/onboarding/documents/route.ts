import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { DocumentEntityType } from '@strike-scf/types'

const adminClient = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VALID_DOCUMENT_KINDS = new Set([
  // Onboarding step 7 document kinds
  'certificate_of_incorporation',
  'photo_id',
  'proof_of_address',
  'ubo_declaration',
  'bank_statements',
  'audited_financials',
  'tax_return',
  'board_resolution',
  // Legacy / other kinds
  'ein_letter',
  'ownership_structure',
  'insurance_certificate',
  'banking_license',
  'aml_kyc_policy',
  'bsa_officer_letter',
  'fdic_exam_report',
])

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const org_id = formData.get('org_id') as string | null
  const document_kind = formData.get('document_kind') as string | null

  if (!file || !org_id || !document_kind) {
    return NextResponse.json({ error: 'file, org_id, and document_kind are required' }, { status: 400 })
  }

  if (!VALID_DOCUMENT_KINDS.has(document_kind)) {
    return NextResponse.json({ error: `Invalid document_kind: ${document_kind}` }, { status: 400 })
  }

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError) {
    console.error('[onboarding/documents] user fetch error:', userError)
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  if (userData.org_id !== org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const storagePath = `${org_id}/${document_kind}/${file.name}`
  const fileBytes = await file.arrayBuffer()

  const { error: uploadError } = await adminClient.storage
    .from('kyb-documents')
    .upload(storagePath, fileBytes, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    console.error('[onboarding/documents] storage upload error:', uploadError)
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      entity_type: 'organization' satisfies DocumentEntityType,
      entity_id: org_id,
      document_kind,
    })
    .select('id')
    .single()

  if (docError || !doc) {
    console.error('[onboarding/documents] documents insert error:', docError)
    return NextResponse.json({ error: 'Failed to record document' }, { status: 500 })
  }

  return NextResponse.json({ document_id: doc.id, storage_path: storagePath }, { status: 201 })
}
