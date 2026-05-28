import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

async function getBankUser(userId: string) {
  const { data: me } = await adminClient
    .from('users')
    .select('role, bank_id')
    .eq('id', userId)
    .single()
  return me
}

async function checkOrgAccess(orgId: string, bankId: string): Promise<boolean> {
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, bank_id')
    .eq('id', orgId)
    .single()
  return !!org && org.bank_id === bankId
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me = await getBankUser(user.id)
  if (!me || !BANK_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(await checkOrgAccess(org_id, me.bank_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: rawDocs } = await adminClient
    .from('documents')
    .select('id, name, document_kind, storage_path, created_at')
    .eq('entity_type', 'organization')
    .eq('entity_id', org_id)
    .eq('document_kind', 'internal_bank')
    .order('created_at', { ascending: false })

  const documents = await Promise.all(
    (rawDocs ?? []).map(async (doc: Record<string, unknown>) => {
      const { data: signed } = await adminClient.storage
        .from('internal-documents')
        .createSignedUrl(doc.storage_path as string, 3600)
      return { ...doc, signed_url: signed?.signedUrl ?? null }
    })
  )

  return NextResponse.json({ documents })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const me = await getBankUser(user.id)
  if (!me || !BANK_ROLES.includes(me.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(await checkOrgAccess(org_id, me.bank_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file || !file.name) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${org_id}/${Date.now()}-${safeName}`
  const buffer = new Uint8Array(await file.arrayBuffer())

  const { error: uploadError } = await adminClient.storage
    .from('internal-documents')
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    console.error('Internal doc upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: docRecord, error: insertError } = await adminClient
    .from('documents')
    .insert({
      name:                file.name,
      document_kind:       'internal_bank',
      entity_type:         'organization',
      entity_id:           org_id,
      storage_path:        storagePath,
      mime_type:           file.type || 'application/octet-stream',
      size_bytes:          file.size,
      uploaded_by_user_id: user.id,
    })
    .select('id, name, created_at')
    .single()

  if (insertError) {
    console.error('Internal doc insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
  }

  return NextResponse.json({ document: docRecord }, { status: 201 })
}
