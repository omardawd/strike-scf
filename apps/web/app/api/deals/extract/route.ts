import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, extractJson } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EXTRACTION_PROMPT = `Extract these fields from this trade document if present: buyer_name, supplier_name, total_value, currency, goods_description, delivery_date, po_number, payment_terms, incoterms. Return as JSON only.`

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const documentId = searchParams.get('document_id')
  if (!documentId) return NextResponse.json({ error: 'document_id required' }, { status: 400 })

  const { data: doc } = await adminClient
    .from('documents')
    .select('id, name, storage_path, mime_type')
    .eq('id', documentId)
    .single()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: signed } = await adminClient.storage
    .from('kyb-documents')
    .createSignedUrl(doc.storage_path, 60)

  if (!signed?.signedUrl) {
    return NextResponse.json({ extracted: {} })
  }

  let docContent = ''
  try {
    const res = await fetch(signed.signedUrl)
    if (res.ok) docContent = await res.text()
  } catch {
    // Non-fatal
  }

  try {
    const result = await callClaude({
      system: 'You are a trade document extraction assistant. Return only valid JSON with no explanation.',
      messages: [
        {
          role: 'user',
          content: `Document name: ${doc.name}\n\nContent:\n${docContent.slice(0, 8000)}\n\n${EXTRACTION_PROMPT}`,
        },
      ],
      max_tokens: 512,
    })
    const extracted = extractJson(result.text) ?? {}
    return NextResponse.json({ extracted })
  } catch {
    return NextResponse.json({ extracted: {} })
  }
}
