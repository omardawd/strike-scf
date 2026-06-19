// Extract readable text from an uploaded file for Strike AI context.
// POST /api/ai/upload  — multipart/form-data with 'file' field
// Returns: { filename: string, text: string }
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

// Pull printable ASCII out of binary blobs (DOCX, DOC, etc.)
function extractPrintableText(bytes: Uint8Array): string {
  const chunks: string[] = []
  let current = ''
  for (const b of bytes) {
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
      current += String.fromCharCode(b)
    } else {
      if (current.length >= 4) chunks.push(current.trim())
      current = ''
    }
  }
  if (current.length >= 4) chunks.push(current.trim())
  return chunks.filter(Boolean).join(' ')
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Multipart upload required' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 413 })

  const mimeType = file.type
  const fileName = file.name.toLowerCase()
  const buf = await file.arrayBuffer()

  // ── Plain text / CSV — read directly, no AI needed ──────────────────────
  const isPlainText =
    mimeType === 'text/plain' ||
    mimeType === 'text/csv' ||
    mimeType === 'application/json' ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.csv') ||
    fileName.endsWith('.json') ||
    fileName.endsWith('.md')

  if (isPlainText) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 50000)
    if (!text.trim()) return NextResponse.json({ error: 'File appears to be empty' }, { status: 400 })
    return NextResponse.json({ filename: file.name, text })
  }

  // ── PDF / Image / DOCX — use Claude Haiku to read the content ───────────
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

  const contentBlocks: ContentBlock[] = []

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    contentBlocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(buf).toString('base64') },
    })
    contentBlocks.push({
      type: 'text',
      text: 'Please read and transcribe the full text content of this document. Return only the plain text, preserving structure (headings, tables, line items) but without markdown code fences or lengthy preamble. If this is a financial or trade document, preserve all numbers, dates, and party names exactly.',
    })
  } else if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(fileName)) {
    const imgMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: imgMime, data: Buffer.from(buf).toString('base64') },
    })
    contentBlocks.push({
      type: 'text',
      text: 'Describe this image in detail. If it contains text, transcribe it verbatim. If it is a document or form, extract all fields and values. If it is a chart or diagram, explain what it shows.',
    })
  } else {
    // DOCX, DOC, XLSX, etc. — best-effort printable text extraction
    const bytes = new Uint8Array(buf)
    const raw = extractPrintableText(bytes).slice(0, 50000)
    if (!raw.trim()) {
      return NextResponse.json({ error: 'Cannot read this file type. Try uploading a PDF, image, or plain text file.' }, { status: 400 })
    }
    // Return directly — no AI call needed
    return NextResponse.json({ filename: file.name, text: raw })
  }

  // Call Haiku
  let extractedText = ''
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '')
      console.error('[ai/upload] Anthropic error', apiRes.status, errText.slice(0, 300))
      return NextResponse.json({ error: 'Failed to read file contents. Please try again.' }, { status: 502 })
    }

    const apiData = await apiRes.json()
    extractedText = (apiData?.content?.[0]?.text as string | undefined) ?? ''

    // Log usage non-fatally
    adminClient.from('ai_usage').insert({
      user_id: userData.id,
      org_id: userData.org_id ?? null,
      bank_id: userData.bank_id ?? null,
      feature: 'insight',
      tokens_input: apiData?.usage?.input_tokens ?? 0,
      tokens_output: apiData?.usage?.output_tokens ?? 0,
      tokens_total: (apiData?.usage?.input_tokens ?? 0) + (apiData?.usage?.output_tokens ?? 0),
      model: 'claude-haiku-4-5-20251001',
    }).then(undefined, () => {})
  } catch (e) {
    console.error('[ai/upload] fetch error', e)
    return NextResponse.json({ error: 'AI service unavailable. Please try again.' }, { status: 502 })
  }

  if (!extractedText.trim()) {
    return NextResponse.json({ error: 'Could not extract content from this file.' }, { status: 422 })
  }

  return NextResponse.json({ filename: file.name, text: extractedText })
}
