// Financing contract management — scoped to a single financing_request/transaction
// pair (not the deal), so two concurrent requests on the same deal never collide.
// POST  — accepted bank submits the financing contract (upload or AI-generated)
// PATCH — requesting org signs the contract
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

async function resolveActor(userId: string) {
  const { data } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', userId)
    .single()
  return data
}

// ── POST: bank submits the financing contract ──────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!BANK_ROLES.includes(actor.role)) {
    return NextResponse.json({ error: 'Only bank users can submit financing contracts' }, { status: 403 })
  }

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('*')
    .eq('id', requestId)
    .single()
  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })
  if (financingReq.accepted_bank_id !== actor.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['accepted', 'funded'].includes(financingReq.status)) {
    return NextResponse.json({ error: 'Financing request must be accepted before a contract can be issued' }, { status: 400 })
  }

  const { data: txn } = await adminClient
    .from('transactions')
    .select('*')
    .eq('financing_request_id', requestId)
    .single()
  if (!txn) return NextResponse.json({ error: 'No transaction linked to this financing request' }, { status: 404 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id, total_value, agreed_currency')
    .eq('id', financingReq.deal_id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { generate?: boolean; contract_document_id?: string }
  let docId = body.contract_document_id ?? null
  let generatedContent: string | null = null

  if (body.generate) {
    try {
      const [requesterRes, bankRes] = await Promise.all([
        adminClient.from('organizations').select('legal_name').eq('id', financingReq.requesting_org_id).single(),
        adminClient.from('banks').select('display_name, legal_name').eq('id', actor.bank_id).single(),
      ])
      const currency = financingReq.currency ?? deal.agreed_currency ?? 'USD'
      const shortId = requestId.slice(0, 8).toUpperCase()
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      const result = await callClaude({
        system: 'You are a trade finance legal drafting assistant. Generate a concise, professional financing contract. Use plain English with standard legal formatting.',
        messages: [{
          role: 'user',
          content: `Generate a financing agreement for Financing Request #${shortId} dated ${today}.
Bank: ${bankRes.data?.display_name ?? bankRes.data?.legal_name ?? 'Bank'}
Borrower: ${requesterRes.data?.legal_name ?? 'Borrower'}
Financing amount: ${currency} ${financingReq.amount_requested}
Structure: ${financingReq.financing_type ?? financingReq.structure_type}
Tenor: ${financingReq.preferred_tenor_days ?? 90} days

Include: parties, financing terms, obligations, payment routing, governing law. Keep under 600 words.`,
        }],
        max_tokens: 1024,
      })
      generatedContent = result.text

      const storagePath = `financing_requests/${requestId}/contract-${Date.now()}.txt`
      const { error: uploadError } = await adminClient.storage
        .from('deal-documents')
        .upload(storagePath, generatedContent, { contentType: 'text/plain', upsert: false })
      if (uploadError) {
        console.error('[financing/contract] Storage upload failed:', uploadError)
        return NextResponse.json({ error: 'Failed to save the generated contract. Please try again.' }, { status: 502 })
      }

      const { data: doc } = await adminClient.from('documents').insert({
        name: `Financing Agreement - Request #${shortId}`,
        storage_path: storagePath,
        mime_type: 'text/plain',
        file_size_bytes: generatedContent.length,
        entity_type: 'financing_request',
        entity_id: requestId,
        document_kind: 'financing_contract',
      }).select().single()
      if (doc) docId = doc.id
    } catch (err) {
      console.error('[financing/contract] AI generation failed:', err)
      return NextResponse.json({ error: 'Failed to generate the financing contract. Please try again.' }, { status: 502 })
    }
  }

  if (!docId) {
    return NextResponse.json({ error: 'Provide contract_document_id or set generate=true' }, { status: 400 })
  }

  const now = new Date().toISOString()
  await adminClient.from('transactions').update({
    esign_document_id: docId,
    bank_signed_at: now,
    updated_at: now,
  }).eq('id', txn.id)

  // Notify the requesting org
  const { data: requesterUsers } = await adminClient.from('users').select('id').eq('org_id', financingReq.requesting_org_id)
  if (requesterUsers?.length) {
    await adminClient.from('notifications').insert(
      requesterUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'financing_contract_submitted',
        title: `Financing contract ready for signature`,
        body: 'The bank has submitted your financing contract. Please review and sign.',
        deep_link: `/marketplace/financing/${requestId}`, read: false,
      }))
    )
  }

  return NextResponse.json({ success: true, generated_content: generatedContent })
}

// ── PATCH: requesting org signs the contract ────────────────────────────────
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actor = await resolveActor(user.id)
  if (!actor) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('*')
    .eq('id', requestId)
    .single()
  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })
  if (financingReq.requesting_org_id !== actor.org_id) {
    return NextResponse.json({ error: 'Only the requesting organization can sign this contract' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { signature?: string }
  if (!body.signature?.trim()) return NextResponse.json({ error: 'Signature is required' }, { status: 400 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('id, buyer_org_id, supplier_org_id')
    .eq('id', financingReq.deal_id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const { data: txn } = await adminClient
    .from('transactions')
    .select('*')
    .eq('financing_request_id', requestId)
    .single()
  if (!txn) return NextResponse.json({ error: 'No transaction linked to this financing request' }, { status: 404 })
  if (!txn.esign_document_id) return NextResponse.json({ error: 'No contract to sign yet' }, { status: 400 })

  const now = new Date().toISOString()
  const isBuyerRequester = deal.buyer_org_id === financingReq.requesting_org_id
  const updates: Record<string, unknown> = {
    updated_at: now,
    ...(isBuyerRequester ? { anchor_signed_at: now } : { supplier_signed_at: now }),
  }
  if (txn.bank_signed_at) updates.esign_completed_at = now

  await adminClient.from('transactions').update(updates).eq('id', txn.id)

  // Notify bank
  if (txn.bank_id) {
    const { data: bankUsers } = await adminClient.from('users').select('id').eq('bank_id', txn.bank_id)
    if (bankUsers?.length) {
      await adminClient.from('notifications').insert(
        bankUsers.map((u: { id: string }) => ({
          user_id: u.id, event: 'financing_contract_signed',
          title: 'Financing contract signed',
          body: 'The borrower has signed the financing agreement.',
          deep_link: `/marketplace/financing/${requestId}`, read: false,
        }))
      )
    }
  }

  return NextResponse.json({ success: true })
}
