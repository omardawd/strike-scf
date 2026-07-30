// Cover image upload for a marketplace listing — public bucket, mirrors app/api/settings/logo/route.ts.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'listing-images'
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

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
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id')
    .eq('id', id)
    .single()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File must be an image (PNG, JPG, GIF, WebP)' }, { status: 400 })
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 5 MB' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${id}/cover.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: bucketErr } = await adminClient.storage.createBucket(
    BUCKET,
    { public: true, allowedMimeTypes: ALLOWED_TYPES, fileSizeLimit: 5242880 }
  )
  if (bucketErr && !bucketErr.message.toLowerCase().includes('already')) {
    console.error('Bucket create error:', bucketErr)
  }

  const { error: uploadError } = await adminClient.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (uploadError) {
    console.error('Listing image upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = adminClient.storage.from(BUCKET).getPublicUrl(path)
  // Deterministic path + upsert:true means the public URL is byte-identical across
  // re-uploads — version-bust it so a re-upload isn't served stale from cache.
  const versionedUrl = `${publicUrl}?v=${Date.now()}`

  const { error: dbError } = await adminClient
    .from('marketplace_listings')
    .update({ cover_image_url: versionedUrl })
    .eq('id', id)
  if (dbError) {
    console.error('Listing image DB update error:', dbError)
    return NextResponse.json({ error: 'Image uploaded but failed to save: ' + dbError.message }, { status: 500 })
  }

  return NextResponse.json({ cover_image_url: versionedUrl })
}

export async function DELETE(
  _request: Request,
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
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id')
    .eq('id', id)
    .single()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('marketplace_listings')
    .update({ cover_image_url: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to remove image' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
