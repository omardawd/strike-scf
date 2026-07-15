// Passport "Documents" & "Certifications" — quality/ISO/compliance docs shown on
// an org's public Passport profile. Distinct from onboarding/KYB documents (same
// `documents` table, different document_kind values: passport_document /
// passport_certification). Visible to any org that can view the passport
// (isOwn or network_visible); upload/delete restricted to the owning org.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { extractJson } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const KIND_MAP = {
  document: 'passport_document',
  certification: 'passport_certification',
} as const

const MAX_CLASSIFY_SIZE = 10 * 1024 * 1024

// Best-effort AI classification of what the uploaded file actually is —
// shown to the user as a confirmation popup right after upload. Never blocks
// the upload itself; any failure here just means no detected type is shown.
async function classifyDocument(
  file: File,
  kind: 'document' | 'certification',
  buf: ArrayBuffer
): Promise<{ detected_type: string; confidence: 'high' | 'medium' | 'low' } | null> {
  try {
    if (buf.byteLength > MAX_CLASSIFY_SIZE) return null

    const mime = file.type || 'application/octet-stream'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = []
    const base64 = Buffer.from(buf).toString('base64')

    if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
    } else if (mime.startsWith('image/')) {
      const media = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg'
      content.push({ type: 'image', source: { type: 'base64', media_type: media, data: base64 } })
    } else if (mime.startsWith('text/') || /\.(txt|csv|md)$/i.test(file.name)) {
      const text = Buffer.from(buf).toString('utf-8').slice(0, 6000)
      content.push({ type: 'text', text: `Document text content:\n${text}` })
    } else {
      // Unsupported binary (docx/xlsx/etc) — no content to read, skip AI classification.
      return null
    }

    content.push({
      type: 'text',
      text: kind === 'certification'
        ? 'Identify exactly what certification this is (e.g. "ISO 9001:2015 Quality Management", "SOC 2 Type II", "Fair Trade Certification"). Respond with ONLY JSON: {"detected_type": "<specific certification name>", "confidence": "high"|"medium"|"low"}'
        : 'Identify exactly what type of business document this is (e.g. "Certificate of Incorporation", "W-9 Tax Form", "Proof of Insurance", "Bank Reference Letter"). Respond with ONLY JSON: {"detected_type": "<specific document type>", "confidence": "high"|"medium"|"low"}',
    })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content }],
      }),
    })
    if (!res.ok) return null

    const data = await res.json()
    const text: string = data?.content?.[0]?.text ?? ''
    const parsed = extractJson<{ detected_type?: string; confidence?: string }>(text)
    if (!parsed?.detected_type) return null

    const confidence = ['high', 'medium', 'low'].includes(parsed.confidence ?? '')
      ? (parsed.confidence as 'high' | 'medium' | 'low')
      : 'medium'
    return { detected_type: parsed.detected_type, confidence }
  } catch (e) {
    console.error('[passport/documents] classification failed:', e)
    return null
  }
}

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  return userData ?? null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params
  const me = await getUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, network_visible')
    .eq('id', org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwn = me.org_id === org_id
  if (!isOwn && org.network_visible !== true) {
    return NextResponse.json({ error: 'This passport is private' }, { status: 403 })
  }

  const { data: docs } = await adminClient
    .from('documents')
    .select('id, name, storage_path, mime_type, document_kind, created_at')
    .eq('entity_type', 'organization')
    .eq('entity_id', org_id)
    .in('document_kind', Object.values(KIND_MAP))
    .order('created_at', { ascending: false })

  const withUrls = await Promise.all((docs ?? []).map(async (doc) => {
    const { data: signed } = await adminClient.storage
      .from('kyb-documents')
      .createSignedUrl(doc.storage_path, 3600)
    return { ...doc, url: signed?.signedUrl ?? null }
  }))

  return NextResponse.json({
    documents: withUrls.filter(d => d.document_kind === KIND_MAP.document),
    certifications: withUrls.filter(d => d.document_kind === KIND_MAP.certification),
    is_own: isOwn,
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params
  const me = await getUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.org_id !== org_id) {
    return NextResponse.json({ error: 'You can only upload documents to your own passport' }, { status: 403 })
  }

  const form = await request.formData()
  const file = form.get('file') as File | null
  const kind = form.get('kind') as string | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (kind !== 'document' && kind !== 'certification') {
    return NextResponse.json({ error: "kind must be 'document' or 'certification'" }, { status: 400 })
  }

  const buf = await file.arrayBuffer()
  const storagePath = `${org_id}/${kind}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadError } = await adminClient.storage
    .from('kyb-documents')
    .upload(storagePath, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadError) {
    return NextResponse.json({ error: 'File upload failed' }, { status: 500 })
  }

  const { data: doc, error: docError } = await adminClient
    .from('documents')
    .insert({
      org_id,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      entity_type: 'organization',
      entity_id: org_id,
      document_kind: KIND_MAP[kind],
    })
    .select('id, name, storage_path, mime_type, document_kind, created_at')
    .single()

  if (docError || !doc) {
    return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
  }

  const { data: signed } = await adminClient.storage
    .from('kyb-documents')
    .createSignedUrl(storagePath, 3600)

  const classification = await classifyDocument(file, kind, buf)

  return NextResponse.json({
    document: { ...doc, url: signed?.signedUrl ?? null },
    detected_type: classification?.detected_type ?? null,
    detection_confidence: classification?.confidence ?? null,
  }, { status: 201 })
}
