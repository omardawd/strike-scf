import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: doc } = await adminClient
    .from('documents')
    .select('id, storage_path, entity_type')
    .eq('id', id)
    .single()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Deal documents may be in deal-documents bucket; everything else in kyb-documents
  const bucket = doc.entity_type === 'deal' ? 'deal-documents' : 'kyb-documents'

  const { data: signed, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(doc.storage_path, 300)

  // Fall back to the other bucket if the primary one fails (belt-and-suspenders)
  if (error || !signed?.signedUrl) {
    const fallbackBucket = bucket === 'deal-documents' ? 'kyb-documents' : 'deal-documents'
    const { data: fallback } = await adminClient.storage
      .from(fallbackBucket)
      .createSignedUrl(doc.storage_path, 300)
    if (fallback?.signedUrl) return NextResponse.json({ url: fallback.signedUrl })
    return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
