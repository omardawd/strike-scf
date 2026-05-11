import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, transactionStatusEmailHtml } from '@/lib/email'

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SUPPLIER_ROLES = ['supplier_admin', 'supplier_member']
const ANCHOR_ROLES   = ['anchor_admin', 'anchor_member']
const BANK_ROLES     = ['bank_admin', 'bank_credit_officer']

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
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: transaction, error: txnError } = await adminClient
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  if (txnError || !transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const hasAccess =
    (SUPPLIER_ROLES.includes(userData.role) && transaction.supplier_id === userData.org_id) ||
    (ANCHOR_ROLES.includes(userData.role)   && transaction.anchor_id   === userData.org_id) ||
    (BANK_ROLES.includes(userData.role)     && transaction.bank_id     === userData.bank_id)

  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: events } = await adminClient
    .from('transaction_events')
    .select('*')
    .eq('transaction_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ transaction, events: events ?? [] })
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
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: transaction } = await adminClient
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action } = body

  // ── Anchor approval ────────────────────────────────────────────
  if (ANCHOR_ROLES.includes(userData.role)) {
    if (transaction.anchor_id !== userData.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (transaction.status !== 'pending_anchor_approval') {
      return NextResponse.json({ error: 'Transaction is not awaiting anchor approval' }, { status: 400 })
    }

    const newStatus = action === 'approve' ? 'pending_bank_review'
      : action === 'reject'  ? 'rejected'
      : null

    if (!newStatus) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }

    const { data: updated, error } = await adminClient
      .from('transactions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

    await adminClient.from('transaction_events').insert({
      transaction_id: id,
      event_type:     action === 'approve' ? 'anchor_approved' : 'anchor_rejected',
      from_status:    transaction.status,
      to_status:      newStatus,
      actor_id:       user.id,
      actor_type:     'anchor',
      notes:          body.notes ? String(body.notes) : null,
    })

    if (action === 'approve') {
      const { data: bankAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('bank_id', transaction.bank_id)
        .eq('role', 'bank_admin')
        .limit(1)
        .maybeSingle()
      if (bankAdmin?.email) {
        const invoiceRef = transaction.invoice_number ?? id
        await sendEmail({
          to:      bankAdmin.email,
          subject: `Invoice ${invoiceRef} ready for review`,
          html:    transactionStatusEmailHtml({
            recipientName: bankAdmin.full_name ?? 'Bank Admin',
            eventBody:     `An invoice (${invoiceRef}) worth ${fmtMoney(transaction.invoice_amount)} has been approved by the anchor and is awaiting your bank review.`,
            transactionId: id,
          }),
        })
      }
    }

    return NextResponse.json({ transaction: updated })
  }

  // ── Bank review ────────────────────────────────────────────────
  if (BANK_ROLES.includes(userData.role)) {
    if (transaction.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (transaction.status !== 'pending_bank_review') {
      return NextResponse.json({ error: 'Transaction is not awaiting bank review' }, { status: 400 })
    }

    const newStatus = action === 'approve'      ? 'financing_approved'
      : action === 'reject'       ? 'rejected'
      : action === 'request_info' ? 'more_info_requested'
      : null

    if (!newStatus) {
      return NextResponse.json({ error: 'action must be approve, reject, or request_info' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = {
      status:     newStatus,
      updated_at: new Date().toISOString(),
    }
    if (body.financing_rate_apr        !== undefined) updatePayload.financing_rate_apr        = Number(body.financing_rate_apr)
    if (body.financing_amount_approved !== undefined) updatePayload.financing_amount_approved = Number(body.financing_amount_approved)
    if (body.tenor_days                !== undefined) updatePayload.tenor_days                = Number(body.tenor_days)
    if (body.fee_amount                !== undefined) updatePayload.fee_amount                = Number(body.fee_amount)
    if (body.net_proceeds              !== undefined) updatePayload.net_proceeds              = Number(body.net_proceeds)
    if (body.rejection_reason          !== undefined) updatePayload.rejection_reason          = String(body.rejection_reason)
    if (body.bank_approval_notes       !== undefined) updatePayload.bank_approval_notes       = String(body.bank_approval_notes)

    const { data: updated, error } = await adminClient
      .from('transactions')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

    await adminClient.from('transaction_events').insert({
      transaction_id: id,
      event_type:     action === 'approve' ? 'bank_approved'
        : action === 'reject' ? 'bank_rejected'
        : 'bank_requested_info',
      from_status:    transaction.status,
      to_status:      newStatus,
      actor_id:       user.id,
      actor_type:     'bank',
      notes:          body.bank_approval_notes
        ? String(body.bank_approval_notes)
        : body.rejection_reason ? String(body.rejection_reason) : null,
    })

    if (action === 'approve') {
      const { data: supplierAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('org_id', transaction.supplier_id)
        .eq('role', 'supplier_admin')
        .limit(1)
        .maybeSingle()
      if (supplierAdmin?.email) {
        const invoiceRef = transaction.invoice_number ?? id
        await sendEmail({
          to:      supplierAdmin.email,
          subject: `Financing approved: Invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
            eventBody:     `Your financing request for invoice ${invoiceRef} has been approved. Net proceeds: ${fmtMoney(updated?.net_proceeds ?? transaction.net_proceeds)}.`,
            transactionId: id,
          }),
        })
      }
    }

    return NextResponse.json({ transaction: updated })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
