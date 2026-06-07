import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, transactionStatusEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

async function verifyAccess(
  item: Record<string, unknown>,
  userData: { id: string; role: string; bank_id: string | null; org_id: string | null }
): Promise<boolean> {
  if (BANK_ROLES.includes(userData.role)) {
    if (item.transaction_id) {
      const { data: txn } = await adminClient
        .from('transactions')
        .select('bank_id')
        .eq('id', item.transaction_id as string)
        .single()
      return txn?.bank_id === userData.bank_id
    } else {
      // org-level: check creator is from same bank
      const { data: creator } = await adminClient
        .from('users')
        .select('bank_id')
        .eq('id', item.required_by_user_id as string)
        .single()
      return creator?.bank_id === userData.bank_id
    }
  }

  if (ORG_ROLES.includes(userData.role)) {
    const { data: orgRow } = await adminClient.from('organizations').select('type').eq('id', userData.org_id).single()
    const orgType = orgRow?.type  // 'anchor' | 'supplier'

    if (orgType === 'supplier') {
      if (item.org_id === userData.org_id) return true
      if (item.transaction_id) {
        const { data: txn } = await adminClient
          .from('transactions')
          .select('supplier_id')
          .eq('id', item.transaction_id as string)
          .single()
        return txn?.supplier_id === userData.org_id
      }
      return false
    }

    if (orgType === 'anchor') {
      if (!item.transaction_id) return false
      const { data: txn } = await adminClient
        .from('transactions')
        .select('anchor_id')
        .eq('id', item.transaction_id as string)
        .single()
      return txn?.anchor_id === userData.org_id
    }

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

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: item, error } = await adminClient
    .from('collateral_requirements')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hasAccess = await verifyAccess(item, userData)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ collateral: item })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: item, error: fetchError } = await adminClient
    .from('collateral_requirements')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hasAccess = await verifyAccess(item, userData)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Parse body — submit uses multipart/form-data (may include a file); all other
  // actions use application/json.
  let body: Record<string, unknown> = {}
  let uploadedFile: File | null = null

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
    }
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        uploadedFile = value
      } else {
        body[key] = value
      }
    }
  } else {
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  const { action } = body

  // ── submit (supplier) ──────────────────────────────────────────────────────
  if (action === 'submit') {
    if (!ORG_ROLES.includes(userData.role)) {
      return NextResponse.json({ error: 'Only suppliers can submit collateral' }, { status: 403 })
    }
    if (item.status !== 'pending') {
      return NextResponse.json({ error: 'Collateral is not pending' }, { status: 400 })
    }

    const submissionNotes = body.submission_notes ? String(body.submission_notes) : null

    // Upload supporting document to the existing transaction-documents bucket
    if (uploadedFile) {
      const storagePath = `collateral/${id}/${uploadedFile.name}`
      const arrayBuffer = await uploadedFile.arrayBuffer()
      const { error: uploadError } = await adminClient.storage
        .from('transaction-documents')
        .upload(storagePath, arrayBuffer, { contentType: uploadedFile.type, upsert: true })

      if (uploadError) {
        console.error('[collateral submit] file upload error:', uploadError)
        return NextResponse.json({ error: 'File upload failed: ' + uploadError.message }, { status: 500 })
      }

      // Record in documents table so it appears in the transaction's document list
      if (item.transaction_id) {
        await adminClient.from('documents').insert({
          name:                uploadedFile.name,
          storage_path:        storagePath,
          mime_type:           uploadedFile.type,
          entity_type:         'transaction',
          entity_id:           item.transaction_id as string,
          document_kind:       'supporting_document',
        })
      }
    }

    const { data: updated, error: updateError } = await adminClient
      .from('collateral_requirements')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('[collateral submit] update error:', updateError)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    // Insert transaction event if linked to a transaction
    if (item.transaction_id) {
      await adminClient.from('transaction_events').insert({
        transaction_id: item.transaction_id as string,
        event_type:     'collateral_updated',
        actor_id:       user.id,
        actor_type:     'supplier',
        notes:          submissionNotes ?? `Collateral submitted: ${item.description}`,
      })
    }

    // Email bank admin — fire and forget
    ;(async () => {
      let bankId: string | null = null
      if (item.transaction_id) {
        const { data: txn } = await adminClient.from('transactions').select('bank_id').eq('id', item.transaction_id as string).single()
        bankId = txn?.bank_id ?? null
      } else if (item.required_by_user_id) {
        const { data: creator } = await adminClient.from('users').select('bank_id').eq('id', item.required_by_user_id as string).single()
        bankId = creator?.bank_id ?? null
      }
      if (!bankId) return

      const { data: bankAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('bank_id', bankId)
        .eq('role', 'bank_admin')
        .limit(1)
        .maybeSingle()

      if (!bankAdmin?.email) return

      await sendEmail({
        to:      bankAdmin.email,
        subject: 'Collateral submitted for review — Strike SCF',
        html:    transactionStatusEmailHtml({
          recipientName: bankAdmin.full_name ?? 'Bank Admin',
          eventBody:     `Collateral has been submitted and is ready for your review: ${item.description}`,
          transactionId: String(item.transaction_id ?? item.id),
        }),
      })
    })().catch(() => {})

    return NextResponse.json({ collateral: updated })
  }

  // ── accept / reject / waive (bank) ─────────────────────────────────────────
  if (['accept', 'reject', 'waive'].includes(action as string)) {
    if (!BANK_ROLES.includes(userData.role)) {
      return NextResponse.json({ error: 'Only bank users can review collateral' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      reviewed_at:          now,
      reviewed_by_user_id:  user.id,
    }

    let emailOutcome = ''
    if (action === 'accept') {
      updatePayload.status = 'accepted'
      emailOutcome = 'Your collateral submission has been accepted.'
    } else if (action === 'reject') {
      updatePayload.status           = 'rejected'
      updatePayload.rejection_reason = body.rejection_reason ? String(body.rejection_reason) : null
      emailOutcome = `Your collateral submission was rejected. Reason: ${updatePayload.rejection_reason ?? 'No reason provided.'}`
    } else if (action === 'waive') {
      updatePayload.status      = 'waived'
      updatePayload.waiver_note = body.waiver_note ? String(body.waiver_note) : null
      emailOutcome = 'The collateral requirement has been waived.'
    }

    const { data: updated, error: updateError } = await adminClient
      .from('collateral_requirements')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('[collateral review] update error:', updateError)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    // Email supplier admin — fire and forget
    ;(async () => {
      let targetOrgId: string | null = item.org_id as string | null
      if (!targetOrgId && item.transaction_id) {
        const { data: txn } = await adminClient.from('transactions').select('supplier_id').eq('id', item.transaction_id as string).single()
        targetOrgId = txn?.supplier_id ?? null
      }
      if (!targetOrgId) return

      const { data: supplierAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('org_id', targetOrgId)
        .eq('role', 'org_admin')
        .limit(1)
        .maybeSingle()

      if (!supplierAdmin?.email) return

      await sendEmail({
        to:      supplierAdmin.email,
        subject: `Collateral ${String(action)}ed — Strike SCF`,
        html:    transactionStatusEmailHtml({
          recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
          eventBody:     emailOutcome,
          transactionId: String(item.transaction_id ?? item.id),
        }),
      })
    })().catch(() => {})

    return NextResponse.json({ collateral: updated })
  }

  // ── release (bank) ─────────────────────────────────────────────────────────
  if (action === 'release') {
    if (!BANK_ROLES.includes(userData.role)) {
      return NextResponse.json({ error: 'Only bank users can release collateral' }, { status: 403 })
    }
    if (item.status !== 'accepted') {
      return NextResponse.json({ error: 'Collateral must be accepted before it can be released' }, { status: 400 })
    }

    const { data: updated, error: updateError } = await adminClient
      .from('collateral_requirements')
      .update({
        status:                'released',
        released_at:           new Date().toISOString(),
        released_by_user_id:   user.id,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('[collateral release] update error:', updateError)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ collateral: updated })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
