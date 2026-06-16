// Document upload / list for a marketplace listing.
// POST /api/marketplace/listings/[id]/document — multipart upload
// GET  /api/marketplace/listings/[id]/document — list documents
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, userData: null }
  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  return { user, userData }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userData } = await getUser()
  if (!userData) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: docs } = await adminClient
    .from('documents')
    .select('id, name, storage_path, mime_type, size_bytes, document_kind, created_at')
    .eq('entity_type', 'listing')
    .eq('entity_id', id)
    .order('created_at', { ascending: false })

  // Generate signed URLs
  const withUrls = await Promise.all((docs ?? []).map(async (doc) => {
    const { data: signed } = await adminClient.storage
      .from('deal-documents')
      .createSignedUrl(doc.storage_path, 3600)
    return { ...doc, url: signed?.signedUrl ?? null }
  }))

  return NextResponse.json({ documents: withUrls })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, userData } = await getUser()
  if (!user || !userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify listing belongs to this org
  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id')
    .eq('id', id)
    .single()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buf = await file.arrayBuffer()
  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `listings/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadError } = await adminClient.storage
    .from('deal-documents')
    .upload(storagePath, buf, { contentType: file.type || 'application/octet-stream', upsert: false })

  if (uploadError) {
    console.error('Storage upload error:', uploadError)
    return NextResponse.json({ error: 'File upload failed' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      uploaded_by_user_id: user.id,
      entity_type: 'listing',
      entity_id: id,
      document_kind: 'listing_document',
    })
    .select()
    .single()

  if (docError || !doc) {
    console.error('Document insert error:', docError)
    return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
  }

  const { data: signed } = await adminClient.storage
    .from('deal-documents')
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json({ document: { ...doc, url: signed?.signedUrl ?? null } })
}
