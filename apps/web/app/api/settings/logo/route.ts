import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_ROLES = ['bank_admin', 'anchor_admin', 'supplier_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']
const BUCKET      = 'logos'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (!ADMIN_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'File must be an image (PNG, JPG, GIF, WebP, SVG)' }, { status: 400 })
  }

  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 2 MB' }, { status: 400 })
  }

  const entityId = BANK_ROLES.includes(userData.role) ? userData.bank_id : userData.org_id
  if (!entityId) return NextResponse.json({ error: 'No org/bank associated with user' }, { status: 400 })

  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path = `${entityId}/logo.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await adminClient.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    console.error('Logo upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = adminClient.storage.from(BUCKET).getPublicUrl(path)

  if (BANK_ROLES.includes(userData.role)) {
    await adminClient.from('banks').update({ logo_url: publicUrl }).eq('id', userData.bank_id)
  } else {
    await adminClient.from('organizations').update({ logo_url: publicUrl }).eq('id', userData.org_id)
  }

  return NextResponse.json({ logo_url: publicUrl })
}
