import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
// Passport docs an org publishes are readable by anyone who can see the passport.
const PUBLIC_PASSPORT_KINDS = new Set(['passport_document', 'passport_certification'])

/**
 * Authorize a caller for a specific document. Returns true only if the caller
 * is a party to whatever the document belongs to. Without this, any logged-in
 * user could mint a signed URL for any document id (IDOR).
 */
async function canAccessDocument(
  doc: { entity_type: string | null; entity_id: string | null; document_kind: string | null },
  me: { role: string; org_id: string | null; bank_id: string | null }
): Promise<boolean> {
  if (me.role === 'strike_admin') return true
  const { entity_type, entity_id } = doc
  if (!entity_type || !entity_id) return false

  if (entity_type === 'organization') {
    if (me.org_id && me.org_id === entity_id) return true
    // Public passport docs are visible when the org opted into the network.
    if (doc.document_kind && PUBLIC_PASSPORT_KINDS.has(doc.document_kind)) {
      const { data: org } = await adminClient
        .from('organizations')
        .select('network_visible').eq('id', entity_id).single()
      if (org?.network_visible === true) return true
    }
    // A bank may read docs for orgs it banks / has a live relationship with.
    if (BANK_ROLES.includes(me.role) && me.bank_id) {
      const { data: org } = await adminClient
        .from('organizations')
        .select('primary_bank_id').eq('id', entity_id).single()
      if (org?.primary_bank_id && org.primary_bank_id === me.bank_id) return true
    }
    return false
  }

  if (entity_type === 'deal') {
    const { data: deal } = await adminClient
      .from('deals')
      .select('buyer_org_id, supplier_org_id')
      .eq('id', entity_id)
      .single()
    if (!deal) return false
    if (me.org_id && (me.org_id === deal.buyer_org_id || me.org_id === deal.supplier_org_id)) return true
    // The financing bank on the deal may read its documents.
    if (BANK_ROLES.includes(me.role) && me.bank_id) {
      const { data: txn } = await adminClient
        .from('transactions')
        .select('bank_id').eq('deal_id', entity_id).eq('bank_id', me.bank_id).limit(1).maybeSingle()
      if (txn) return true
    }
    return false
  }

  if (entity_type === 'listing') {
    const { data: listing } = await adminClient
      .from('marketplace_listings')
      .select('org_id').eq('id', entity_id).single()
    return !!listing && !!me.org_id && listing.org_id === me.org_id
  }

  if (entity_type === 'financing_request') {
    const { data: financingReq } = await adminClient
      .from('financing_requests')
      .select('requesting_org_id, accepted_bank_id')
      .eq('id', entity_id).single()
    if (!financingReq) return false
    if (me.org_id && me.org_id === financingReq.requesting_org_id) return true
    if (BANK_ROLES.includes(me.role) && me.bank_id && me.bank_id === financingReq.accepted_bank_id) return true
    return false
  }

  return false
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: doc } = await adminClient
    .from('documents')
    .select('id, storage_path, entity_type, entity_id, document_kind')
    .eq('id', id)
    .single()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  if (!(await canAccessDocument(doc, me))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Deal documents may be in deal-documents bucket; everything else in kyb-documents
  const bucket = (doc.entity_type === 'deal' || doc.entity_type === 'financing_request') ? 'deal-documents' : 'kyb-documents'

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
