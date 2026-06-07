import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const AI_DOC_KINDS = ['ai_po', 'ai_invoice', 'ai_contract'] as const
type AiDocKind = typeof AI_DOC_KINDS[number]

const AI_DOC_CONTENT_MAP: Record<AiDocKind, 'ai_po_draft' | 'ai_invoice_draft' | 'ai_contract_draft'> = {
  ai_po:       'ai_po_draft',
  ai_invoice:  'ai_invoice_draft',
  ai_contract: 'ai_contract_draft',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id, ai_po_draft, ai_invoice_draft, ai_contract_draft, documents_generated_at')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: docRows } = await adminClient
    .from('documents')
    .select('id, name, document_kind, storage_path, mime_type, created_at')
    .eq('entity_type', 'deal')
    .eq('entity_id', id)
    .order('created_at', { ascending: true })

  const aiDocs: {
    kind: AiDocKind
    content: string
    generated_at: string | null
  }[] = []

  if (deal.documents_generated_at) {
    for (const kind of AI_DOC_KINDS) {
      const field = AI_DOC_CONTENT_MAP[kind]
      const text = deal[field] as string | null
      if (text) {
        aiDocs.push({
          kind,
          content: text,
          generated_at: deal.documents_generated_at,
        })
      }
    }
  }

  const uploadedDocs: {
    id: string
    kind: string
    name: string
    url: string | null
    created_at: string
  }[] = []

  for (const doc of docRows ?? []) {
    if (AI_DOC_KINDS.includes(doc.document_kind as AiDocKind)) continue
    let signedUrl: string | null = null
    if (doc.storage_path) {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 3600)
      signedUrl = signed?.signedUrl ?? null
    }
    uploadedDocs.push({
      id: doc.id,
      kind: doc.document_kind ?? 'unknown',
      name: doc.name,
      url: signedUrl,
      created_at: doc.created_at,
    })
  }

  return NextResponse.json({ ai_documents: aiDocs, uploaded_documents: uploadedDocs })
}
