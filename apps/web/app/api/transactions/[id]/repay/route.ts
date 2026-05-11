import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, transactionStatusEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!BANK_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: transaction } = await adminClient
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (transaction.bank_id !== userData.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (transaction.status !== 'funded') {
    return NextResponse.json({ error: 'Transaction is not in funded status' }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const repaymentReference = body.repayment_reference ? String(body.repayment_reference) : null
  const earlyRepayment     = body.early_repayment === true
  const actualFeeAmount    = body.actual_fee_amount !== undefined ? Number(body.actual_fee_amount) : null

  const updatePayload: Record<string, unknown> = {
    status:               'completed',
    repaid_at:            new Date().toISOString(),
    repaid_by_user_id:    user.id,
    repayment_reference:  repaymentReference,
    early_repayment:      earlyRepayment,
    updated_at:           new Date().toISOString(),
  }
  if (actualFeeAmount !== null) updatePayload.actual_fee_amount = actualFeeAmount

  const { data: updated, error: updateError } = await adminClient
    .from('transactions')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

  await adminClient.from('transaction_events').insert({
    transaction_id: id,
    event_type:     'repayment_marked',
    from_status:    'funded',
    to_status:      'completed',
    actor_id:       user.id,
    actor_type:     'bank',
    notes:          repaymentReference,
  })

  const invoiceRef = transaction.invoice_number ?? id
  const notifBody  = `Invoice ${invoiceRef} has been fully repaid and closed`
  const deepLink   = `/transactions/${id}`

  // Notify anchor admin and supplier admin in parallel
  const [anchorAdmin, supplierAdmin] = await Promise.all([
    adminClient
      .from('users')
      .select('id, email, full_name')
      .eq('org_id', transaction.anchor_id)
      .eq('role', 'anchor_admin')
      .limit(1)
      .maybeSingle()
      .then(r => r.data),
    adminClient
      .from('users')
      .select('id, email, full_name')
      .eq('org_id', transaction.supplier_id)
      .eq('role', 'supplier_admin')
      .limit(1)
      .maybeSingle()
      .then(r => r.data),
  ])

  const notifInserts = [anchorAdmin, supplierAdmin]
    .filter(Boolean)
    .map(u => ({
      user_id:   (u as { id: string }).id,
      event:     'transaction_completed',
      title:     'Transaction completed',
      body:      notifBody,
      deep_link: deepLink,
      read:      false,
    }))

  if (notifInserts.length > 0) {
    await adminClient.from('notifications').insert(notifInserts)
  }

  await Promise.all([
    anchorAdmin?.email ? sendEmail({
      to:      anchorAdmin.email,
      subject: `Transaction completed: Invoice ${invoiceRef}`,
      html:    transactionStatusEmailHtml({
        recipientName: anchorAdmin.full_name ?? 'Anchor Admin',
        eventBody:     notifBody,
        transactionId: id,
      }),
    }) : Promise.resolve(),
    supplierAdmin?.email ? sendEmail({
      to:      supplierAdmin.email,
      subject: `Transaction completed: Invoice ${invoiceRef}`,
      html:    transactionStatusEmailHtml({
        recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
        eventBody:     notifBody,
        transactionId: id,
      }),
    }) : Promise.resolve(),
  ])

  return NextResponse.json({ success: true, transaction: updated })
}
