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
  if (transaction.status !== 'financing_approved') {
    return NextResponse.json({ error: 'Transaction is not in financing_approved status' }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const disbursementReference = body.disbursement_reference ? String(body.disbursement_reference) : null

  // Only overwrite disbursement_reference if a new one is explicitly provided;
  // it may already hold wire transfer info JSON sent to the supplier.
  const updateFields: Record<string, unknown> = {
    status:               'funded',
    disbursed_at:         new Date().toISOString(),
    disbursed_by_user_id: user.id,
    updated_at:           new Date().toISOString(),
  }
  if (disbursementReference) updateFields.disbursement_reference = disbursementReference

  const { data: updated, error: updateError } = await adminClient
    .from('transactions')
    .update(updateFields)
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

  await adminClient.from('transaction_events').insert({
    transaction_id: id,
    event_type:     'disbursement_marked',
    from_status:    'financing_approved',
    to_status:      'funded',
    actor_id:       user.id,
    actor_type:     'bank',
    notes:          disbursementReference,
  })

  // Notify supplier admin
  const { data: supplierAdmin } = await adminClient
    .from('users')
    .select('id, email, full_name')
    .eq('org_id', transaction.supplier_id)
    .eq('role', 'org_admin')
    .limit(1)
    .maybeSingle()

  if (supplierAdmin) {
    const invoiceRef = transaction.invoice_number ?? id
    await adminClient.from('notifications').insert({
      user_id:   supplierAdmin.id,
      event:     'transaction_funded',
      title:     'Payment disbursed',
      body:      `Your financing for invoice ${invoiceRef} has been disbursed`,
      deep_link: `/transactions/${id}`,
      read:      false,
    })
    if (supplierAdmin.email) {
      await sendEmail({
        to:      supplierAdmin.email,
        subject: `Payment disbursed: Invoice ${invoiceRef}`,
        html:    transactionStatusEmailHtml({
          recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
          eventBody:     `Your financing for invoice ${invoiceRef} has been disbursed. The funds should be available shortly.`,
          transactionId: id,
        }),
      })
    }
  }

  return NextResponse.json({ success: true, transaction: updated })
}
