// AI extraction of listing fields + line items from an uploaded PO, Invoice, or document.
// POST /api/marketplace/listings/extract
// Body: multipart/form-data with 'file' field (PDF, image, DOCX, DOC, TXT, CSV)
// Returns: { items, title?, description?, category?, delivery_location?, incoterms?,
//            payment_terms?, currency?, delivery_deadline? }
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface LineItemExtract {
  name: string
  description?: string
  quantity?: number
  unit?: string
  unit_price?: number
  currency?: string
}

export interface ExtractResult {
  items: LineItemExtract[]
  title?: string
  description?: string
  category?: string
  delivery_location?: string
  incoterms?: string
  payment_terms?: string
  currency?: string
  delivery_deadline?: string
}

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

const VALID_CATEGORIES = [
  'Electronics & Components', 'Raw Materials', 'Agricultural Commodities',
  'Chemicals & Plastics', 'Textiles & Apparel', 'Industrial Equipment',
  'Food & Beverage', 'Construction Materials', 'Pharmaceuticals', 'Packaging', 'Other',
]
const VALID_INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']
const VALID_PAYMENT_TERMS = [
  'Net 30', 'Net 60', 'Net 90',
  '30% upfront, 70% on delivery', '50% upfront, 50% on delivery',
  'Letter of Credit (LC)', 'Documentary Collection', 'Open Account',
]

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Multipart file upload required' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const mimeType = file.type
  const fileName = file.name.toLowerCase()
  const buf = await file.arrayBuffer()

  // Build message content for Claude
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

  const contentBlocks: ContentBlock[] = []

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    const base64 = Buffer.from(buf).toString('base64')
    contentBlocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    })
  } else if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(fileName)) {
    const imgMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
    const base64 = Buffer.from(buf).toString('base64')
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: imgMime, data: base64 },
    })
  } else {
    // Text, CSV, DOC, DOCX — extract printable text from binary
    const bytes = new Uint8Array(buf)
    const text = extractPrintableText(bytes).slice(0, 12000)
    if (!text.trim()) {
      return NextResponse.json({ error: 'Could not read text content from this file. Please try a PDF or image.' }, { status: 400 })
    }
    contentBlocks.push({ type: 'text', text })
  }

  const prompt = `You are a trade document parser. Extract all available information from this Purchase Order or Invoice document and return ONLY a JSON object with no markdown, no explanation.

Return this exact shape:
{
  "title": "short descriptive title for this listing (e.g. '500 MT HDPE Pellets — Q3 Delivery')",
  "description": "full description of goods/services, specs, quality, certifications",
  "category": "one of: ${VALID_CATEGORIES.join(' | ')}",
  "delivery_location": "port or city, country (e.g. 'Port of Jebel Ali, AE')",
  "incoterms": "one of: ${VALID_INCOTERMS.join(' | ')} or null",
  "payment_terms": "one of: ${VALID_PAYMENT_TERMS.join(' | ')} or null",
  "currency": "3-letter ISO code e.g. USD",
  "delivery_deadline": "ISO date YYYY-MM-DD or null",
  "items": [
    {
      "name": "item name (required)",
      "description": "specs, grade, dimensions, certifications",
      "quantity": 0,
      "unit": "MT or KG or Units etc.",
      "unit_price": 0
    }
  ]
}

Use null for any field you cannot find. The items array may be empty if no line items are present. Respond with ONLY the JSON object.`

  contentBlocks.push({ type: 'text', text: prompt })

  let rawText = ''
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
        max_tokens: 2000,
        system: 'You are a trade document parser. Always respond with valid JSON only.',
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '')
      console.error('Anthropic error', apiRes.status, errText.slice(0, 300))
      return NextResponse.json({ error: 'AI extraction failed. Please try again or enter details manually.' }, { status: 502 })
    }

    const apiData = await apiRes.json()
    rawText = (apiData?.content?.[0]?.text as string) ?? ''

    // Log usage non-fatally
    adminClient.from('ai_usage').insert({
      user_id: userData.id,
      org_id: userData.org_id,
      feature: 'insight',
      tokens_input: apiData?.usage?.input_tokens ?? 0,
      tokens_output: apiData?.usage?.output_tokens ?? 0,
      tokens_total: (apiData?.usage?.input_tokens ?? 0) + (apiData?.usage?.output_tokens ?? 0),
      model: 'claude-haiku-4-5-20251001',
    }).then(undefined, () => {})
  } catch (e) {
    console.error('Extract fetch error', e)
    return NextResponse.json({ error: 'AI service unavailable. Please try again.' }, { status: 502 })
  }

  // Parse response
  let parsed: ExtractResult & { items?: unknown[] } = { items: [] }
  try {
    const cleaned = rawText.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'AI could not extract structured data. Please enter details manually.' }, { status: 422 })
  }

  const items: LineItemExtract[] = Array.isArray(parsed.items)
    ? (parsed.items as LineItemExtract[]).filter((i): i is LineItemExtract => !!i?.name)
    : []

  const result: ExtractResult = {
    items,
    title: parsed.title || undefined,
    description: parsed.description || undefined,
    category: VALID_CATEGORIES.includes(parsed.category ?? '') ? parsed.category : undefined,
    delivery_location: parsed.delivery_location || undefined,
    incoterms: VALID_INCOTERMS.includes(parsed.incoterms ?? '') ? parsed.incoterms : undefined,
    payment_terms: VALID_PAYMENT_TERMS.includes(parsed.payment_terms ?? '') ? parsed.payment_terms : undefined,
    currency: /^[A-Z]{3}$/.test(parsed.currency ?? '') ? parsed.currency : undefined,
    delivery_deadline: /^\d{4}-\d{2}-\d{2}$/.test(parsed.delivery_deadline ?? '') ? parsed.delivery_deadline : undefined,
  }

  return NextResponse.json(result)
}
