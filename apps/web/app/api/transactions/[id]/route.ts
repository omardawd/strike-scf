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

  const isSupplier = SUPPLIER_ROLES.includes(userData.role)
  const isAnchor   = ANCHOR_ROLES.includes(userData.role)
  const isBank     = BANK_ROLES.includes(userData.role)

  const hasAccess =
    (isSupplier && transaction.supplier_id === userData.org_id) ||
    (isAnchor   && transaction.anchor_id   === userData.org_id) ||
    (isBank     && transaction.bank_id     === userData.bank_id)

  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [
    { data: rawEvents },
    { data: supplierOrg },
    { data: anchorOrg },
    { data: bank },
    { data: program },
  ] = await Promise.all([
    adminClient.from('transaction_events').select('*').eq('transaction_id', id).order('created_at', { ascending: true }),
    transaction.supplier_id
      ? adminClient.from('organizations').select('legal_name').eq('id', transaction.supplier_id).single()
      : Promise.resolve({ data: null }),
    transaction.anchor_id
      ? adminClient.from('organizations').select('legal_name').eq('id', transaction.anchor_id).single()
      : Promise.resolve({ data: null }),
    transaction.bank_id
      ? adminClient.from('banks').select('name').eq('id', transaction.bank_id).single()
      : Promise.resolve({ data: null }),
    transaction.program_id
      ? adminClient.from('programs').select('name').eq('id', transaction.program_id).single()
      : Promise.resolve({ data: null }),
  ])

  // Enrich events: resolve actor_id → full_name and expose actor_type as actor
  const events = rawEvents ?? []
  const actorIds = [...new Set(events.map((e: Record<string, unknown>) => e.actor_id as string).filter(Boolean))]
  const actorNameMap: Record<string, string> = {}
  if (actorIds.length > 0) {
    const { data: actorUsers } = await adminClient
      .from('users')
      .select('id, full_name')
      .in('id', actorIds)
    for (const u of actorUsers ?? []) {
      const typedU = u as { id: string; full_name: string }
      actorNameMap[typedU.id] = typedU.full_name
    }
  }

  const enrichedEvents = events.map((e: Record<string, unknown>) => ({
    ...e,
    actor:      e.actor_type ?? 'system',
    actor_name: e.actor_id ? (actorNameMap[e.actor_id as string] ?? 'System') : 'System',
    action:     e.event_type,
  }))

  // Scope events per portal:
  // Anchors must not see wire transfer info events (bank→supplier)
  // Suppliers must not see repayment info events (bank→anchor)
  const scopedEvents = enrichedEvents.filter((e: Record<string, unknown>) => {
    if (isAnchor   && e.event_type === 'wire_info_sent')      return false
    if (isSupplier && e.event_type === 'repayment_info_sent') return false
    return true
  })

  const enrichedTxn = {
    ...transaction,
    supplier_name: (supplierOrg as { legal_name?: string } | null)?.legal_name ?? null,
    anchor_name:   (anchorOrg  as { legal_name?: string } | null)?.legal_name ?? null,
    bank_name:     (bank       as { name?: string }       | null)?.name        ?? null,
    program_name:  (program    as { name?: string }       | null)?.name        ?? null,
  }

  // Scope sensitive fields:
  // Anchor cannot see wire transfer info (disbursement_reference used for supplier wire info)
  if (isAnchor) {
    enrichedTxn.disbursement_reference = null
  }
  // Supplier cannot see repayment instructions (bank_approval_notes used for anchor repayment)
  if (isSupplier) {
    enrichedTxn.bank_approval_notes = null
  }

  return NextResponse.json({ transaction: enrichedTxn, events: scopedEvents })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    if (transaction.type === 'invoice_factoring') {
      return NextResponse.json({ error: 'Anchor approval not required for invoice factoring' }, { status: 400 })
    }

    // PO financing: anchor confirms goods receipt at pending_anchor_confirmation
    if (transaction.status === 'pending_anchor_confirmation') {
      const newStatus = action === 'approve' ? 'repayment_due'
        : action === 'reject'  ? 'in_dispute'
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
          const ref = transaction.invoice_number ?? id
          await sendEmail({
            to:      bankAdmin.email,
            subject: `Invoice ${ref} confirmed by anchor`,
            html:    transactionStatusEmailHtml({
              recipientName: bankAdmin.full_name ?? 'Bank Admin',
              eventBody:     `The anchor has confirmed receipt of goods for invoice ${ref}. The transaction is now in repayment due status.`,
              transactionId: id,
            }),
          })
        }
      }

      return NextResponse.json({ transaction: updated })
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

  // ── Supplier: respond to bank counter-offer (accept, counter back, or reject) ──
  if (SUPPLIER_ROLES.includes(userData.role)) {
    if (transaction.supplier_id !== userData.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // PO financing: supplier submits invoice after delivery (at funded status)
    if (action === 'submit_invoice') {
      if (transaction.status !== 'funded') {
        return NextResponse.json({ error: 'Transaction is not in funded status' }, { status: 400 })
      }

      const invoiceNumber = body.invoice_number ? String(body.invoice_number) : null
      const invoiceAmount = body.invoice_amount  != null ? Number(body.invoice_amount) : null
      const invoiceDate   = body.invoice_date    ? String(body.invoice_date)   : null

      if (!invoiceNumber || !invoiceAmount || !invoiceDate) {
        return NextResponse.json({ error: 'invoice_number, invoice_amount, and invoice_date are required' }, { status: 400 })
      }

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({
          invoice_number: invoiceNumber,
          invoice_amount: invoiceAmount,
          invoice_date:   invoiceDate,
          status:         'pending_anchor_confirmation',
          updated_at:     new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'status_change',
        from_status:    transaction.status,
        to_status:      'pending_anchor_confirmation',
        actor_id:       user.id,
        actor_type:     'supplier',
        notes:          'Invoice submitted after delivery',
      })

      const { data: anchorAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('org_id', transaction.anchor_id)
        .eq('role', 'anchor_admin')
        .limit(1)
        .maybeSingle()
      if (anchorAdmin?.email) {
        await sendEmail({
          to:      anchorAdmin.email,
          subject: `Invoice ${invoiceNumber} ready for approval`,
          html:    transactionStatusEmailHtml({
            recipientName: anchorAdmin.full_name ?? 'Anchor Admin',
            eventBody:     `The supplier has submitted invoice ${invoiceNumber} (${fmtMoney(invoiceAmount)}) after delivering goods. Please review and confirm receipt.`,
            transactionId: id,
          }),
        })
      }

      return NextResponse.json({ transaction: updated })
    }

    if (transaction.status !== 'pending_supplier_counter_review') {
      return NextResponse.json({ error: 'No counter-offer pending' }, { status: 400 })
    }

    // Supplier accepts bank's counter-offer
    if (action === 'accept_counter') {
      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: 'financing_approved', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'counter_offer_accepted',
        from_status:    transaction.status,
        to_status:      'financing_approved',
        actor_id:       user.id,
        actor_type:     'supplier',
        notes:          null,
      })

      return NextResponse.json({ transaction: updated })
    }

    // Supplier sends their own counter back to bank
    if (action === 'supplier_counter') {
      const rateApr        = body.apr != null ? Number(body.apr) : null
      const counterNotes   = body.counter_notes ? String(body.counter_notes) : null

      if (!rateApr) {
        return NextResponse.json({ error: 'apr is required for supplier counter-offer' }, { status: 400 })
      }

      const invoiceAmt = transaction.invoice_amount ?? 0
      const amountApproved = parseFloat((invoiceAmt * (rateApr / 100)).toFixed(2))

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({
          status:                    'pending_bank_review',
          financing_rate_apr:        rateApr,
          financing_amount_approved: amountApproved,
          updated_at:                new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('[supplier_counter] update error:', error)
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
      }

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'counter_offer_submitted',
        from_status:    transaction.status,
        to_status:      'pending_bank_review',
        actor_id:       user.id,
        actor_type:     'supplier',
        notes:          counterNotes,
      })

      // Notify bank
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
          subject: `Supplier counter-offer on invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: bankAdmin.full_name ?? 'Bank Admin',
            eventBody:     `The supplier has submitted a counter-offer on invoice ${invoiceRef}. Advance rate: ${rateApr}%, Amount: ${fmtMoney(amountApproved)}. Please review.`,
            transactionId: id,
          }),
        })
      }

      return NextResponse.json({ transaction: updated })
    }

    // Supplier rejects the counter-offer
    if (action === 'reject_counter') {
      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'counter_offer_rejected',
        from_status:    transaction.status,
        to_status:      'rejected',
        actor_id:       user.id,
        actor_type:     'supplier',
        notes:          null,
      })

      return NextResponse.json({ transaction: updated })
    }

    return NextResponse.json({ error: 'action must be accept_counter, supplier_counter, or reject_counter' }, { status: 400 })
  }

  // ── Bank actions ───────────────────────────────────────────────
  if (BANK_ROLES.includes(userData.role)) {
    if (transaction.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // send_repayment_info: at funded (RF) or repayment_due (PO)
    if (action === 'send_repayment_info') {
      if (transaction.status !== 'funded' && transaction.status !== 'repayment_due') {
        return NextResponse.json({ error: 'Transaction is not in funded or repayment_due status' }, { status: 400 })
      }

      const repaymentDueDate      = body.repayment_due_date      ? String(body.repayment_due_date)      : null
      const repaymentInstructions = body.repayment_instructions  ? String(body.repayment_instructions)  : null
      const repaymentAmount       = body.repayment_amount != null ? Number(body.repayment_amount)        : null

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (repaymentDueDate)      updatePayload.repayment_due_date  = repaymentDueDate
      if (repaymentInstructions) updatePayload.bank_approval_notes = repaymentInstructions

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'repayment_info_sent',
        from_status:    transaction.status,
        to_status:      transaction.status,
        actor_id:       user.id,
        actor_type:     'bank',
        notes:          repaymentInstructions,
      })

      const { data: anchorAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('org_id', transaction.anchor_id)
        .eq('role', 'anchor_admin')
        .limit(1)
        .maybeSingle()
      if (anchorAdmin?.email) {
        const invoiceRef = transaction.invoice_number ?? id
        await sendEmail({
          to:      anchorAdmin.email,
          subject: `Repayment instructions for invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: anchorAdmin.full_name ?? 'Anchor Admin',
            eventBody:     `Repayment details for invoice ${invoiceRef}:\n\nAmount due: ${fmtMoney(repaymentAmount)}\nDue date: ${repaymentDueDate ?? '—'}\n\n${repaymentInstructions ?? ''}`,
            transactionId: id,
          }),
        })
      }

      return NextResponse.json({ transaction: updated })
    }

    // send_wire_info: bank sends wire transfer details to supplier (at financing_approved)
    if (action === 'send_wire_info') {
      if (transaction.status !== 'financing_approved') {
        return NextResponse.json({ error: 'Transaction is not in financing_approved status' }, { status: 400 })
      }

      const wireInfo = body.wire_transfer_info as Record<string, string> | undefined
      if (!wireInfo) {
        return NextResponse.json({ error: 'wire_transfer_info is required' }, { status: 400 })
      }

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({
          disbursement_reference: JSON.stringify(wireInfo),
          updated_at:             new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'wire_info_sent',
        from_status:    transaction.status,
        to_status:      transaction.status,
        actor_id:       user.id,
        actor_type:     'bank',
        notes:          wireInfo.reference ?? null,
      })

      // Notify supplier
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
          subject: `Wire transfer details for invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
            eventBody:     `Wire transfer details have been sent for invoice ${invoiceRef}. Funds will be disbursed to your account shortly.`,
            transactionId: id,
          }),
        })
      }

      return NextResponse.json({ transaction: updated })
    }

    // counter_offer: bank counters supplier's offer or supplier's counter
    if (action === 'counter_offer') {
      if (transaction.status !== 'pending_bank_review' && transaction.status !== 'more_info_requested') {
        return NextResponse.json({ error: 'Transaction is not awaiting bank review' }, { status: 400 })
      }

      const rateApr        = body.apr != null ? Number(body.apr) : null
      const amountApproved = body.financing_amount_approved != null ? Number(body.financing_amount_approved) : null
      const counterNotes   = body.counter_offer_notes ? String(body.counter_offer_notes) : null

      if (!rateApr || !amountApproved) {
        return NextResponse.json({ error: 'apr and financing_amount_approved are required' }, { status: 400 })
      }

      const invoiceAmt    = transaction.invoice_amount ?? 0
      const computedFee   = invoiceAmt > 0 ? parseFloat((invoiceAmt - amountApproved).toFixed(2)) : null

      const counterPayload: Record<string, unknown> = {
        status:                    'pending_supplier_counter_review',
        financing_rate_apr:        rateApr,
        financing_amount_approved: amountApproved,
        updated_at:                new Date().toISOString(),
      }
      if (computedFee != null && computedFee >= 0) counterPayload.fee_amount = computedFee

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update(counterPayload)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('[counter_offer] update error:', error)
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
      }

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'counter_offer_submitted',
        from_status:    transaction.status,
        to_status:      'pending_supplier_counter_review',
        actor_id:       user.id,
        actor_type:     'bank',
        notes:          counterNotes,
      })

      const invoiceRef = transaction.invoice_number ?? id

      const [{ data: supplierAdmin }, { data: anchorAdmin }] = await Promise.all([
        adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.supplier_id).eq('role', 'supplier_admin').limit(1).maybeSingle(),
        adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.anchor_id).eq('role', 'anchor_admin').limit(1).maybeSingle(),
      ])

      if (supplierAdmin?.email) {
        await sendEmail({
          to:      supplierAdmin.email,
          subject: `Counter-offer on invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
            eventBody:     `The bank has made a counter-offer on invoice ${invoiceRef}. Advance rate: ${rateApr}%, Amount: ${fmtMoney(amountApproved)}. Please review and accept or decline.`,
            transactionId: id,
          }),
        })
      }
      if (anchorAdmin?.email) {
        await sendEmail({
          to:      anchorAdmin.email,
          subject: `Counter-offer submitted for invoice ${invoiceRef}`,
          html:    transactionStatusEmailHtml({
            recipientName: anchorAdmin.full_name ?? 'Anchor Admin',
            eventBody:     `The bank has submitted a counter-offer on invoice ${invoiceRef} (${fmtMoney(amountApproved)} at ${rateApr}%). Awaiting supplier response.`,
            transactionId: id,
          }),
        })
      }

      return NextResponse.json({ transaction: updated })
    }

    // mark_repaid: PO financing repayment_due → completed
    if (action === 'mark_repaid') {
      if (transaction.status !== 'repayment_due') {
        return NextResponse.json({ error: 'Transaction is not in repayment_due status' }, { status: 400 })
      }

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: 'completed', repaid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'repayment_marked',
        from_status:    transaction.status,
        to_status:      'completed',
        actor_id:       user.id,
        actor_type:     'bank',
        notes:          null,
      })

      return NextResponse.json({ transaction: updated })
    }

    // approve / reject / request_info: only when pending_bank_review or more_info_requested
    if (transaction.status !== 'pending_bank_review' && transaction.status !== 'more_info_requested') {
      return NextResponse.json({ error: 'Transaction is not awaiting bank review' }, { status: 400 })
    }

    const newStatus = action === 'approve'      ? 'financing_approved'
      : action === 'reject'       ? 'rejected'
      : action === 'request_info' ? 'more_info_requested'
      : null

    if (!newStatus) {
      return NextResponse.json({ error: 'action must be approve, reject, request_info, or counter_offer' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = {
      status:     newStatus,
      updated_at: new Date().toISOString(),
    }

    if (action === 'approve') {
      // Bank approves at the supplier's offered rate (no rate editing for approve)
      const rateApr        = body.apr != null ? Number(body.apr) : null
      const amountApproved = body.financing_amount_approved != null ? Number(body.financing_amount_approved) : null

      if (rateApr != null)        updatePayload.financing_rate_apr        = rateApr
      if (amountApproved != null) updatePayload.financing_amount_approved = amountApproved

      // Auto-compute fee_amount = invoice_amount - financing_amount_approved
      const invAmt = transaction.invoice_amount ?? 0
      const disbAmt = amountApproved ?? transaction.financing_amount_requested ?? 0
      if (invAmt > 0 && disbAmt > 0) {
        updatePayload.fee_amount = parseFloat((invAmt - disbAmt).toFixed(2))
      }
    }

    if (action === 'reject') {
      // Store rejection reason in bank_approval_notes (rejection_reason column may not exist)
      if (body.rejection_reason !== undefined) {
        updatePayload.bank_approval_notes = String(body.rejection_reason)
      }
    }

    if (body.bank_approval_notes !== undefined) {
      updatePayload.bank_approval_notes = String(body.bank_approval_notes)
    }
    if (body.net_proceeds !== undefined) updatePayload.net_proceeds = Number(body.net_proceeds)

    const { data: updated, error } = await adminClient
      .from('transactions')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[bank approve/reject/request_info] update error:', error)
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
    }

    await adminClient.from('transaction_events').insert({
      transaction_id: id,
      event_type:     action === 'approve' ? 'bank_approved'
        : action === 'reject' ? 'bank_rejected'
        : 'bank_requested_info',
      from_status:    transaction.status,
      to_status:      newStatus,
      actor_id:       user.id,
      actor_type:     'bank',
      notes:          action === 'reject' && body.rejection_reason
        ? String(body.rejection_reason)
        : body.bank_approval_notes ? String(body.bank_approval_notes) : null,
    })

    const invoiceRef2 = transaction.invoice_number ?? id

    if (action === 'approve') {
      const { data: supplierAdmin } = await adminClient
        .from('users')
        .select('email, full_name')
        .eq('org_id', transaction.supplier_id)
        .eq('role', 'supplier_admin')
        .limit(1)
        .maybeSingle()
      if (supplierAdmin?.email) {
        await sendEmail({
          to:      supplierAdmin.email,
          subject: `Financing approved: Invoice ${invoiceRef2}`,
          html:    transactionStatusEmailHtml({
            recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
            eventBody:     `Your financing request for invoice ${invoiceRef2} has been approved. Amount: ${fmtMoney(updated?.financing_amount_approved ?? transaction.financing_amount_requested)}.`,
            transactionId: id,
          }),
        })
      }
    }

    if (action === 'reject') {
      const [{ data: supplierAdmin }, { data: anchorAdmin }] = await Promise.all([
        adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.supplier_id).eq('role', 'supplier_admin').limit(1).maybeSingle(),
        adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.anchor_id).eq('role', 'anchor_admin').limit(1).maybeSingle(),
      ])
      const rejectReason = body.rejection_reason ? String(body.rejection_reason) : null
      if (supplierAdmin?.email) {
        await sendEmail({
          to:      supplierAdmin.email,
          subject: `Financing declined: Invoice ${invoiceRef2}`,
          html:    transactionStatusEmailHtml({
            recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
            eventBody:     `Your financing request for invoice ${invoiceRef2} has been declined by the bank.${rejectReason ? `\n\nReason: ${rejectReason}` : ''}`,
            transactionId: id,
          }),
        })
      }
      if (anchorAdmin?.email) {
        await sendEmail({
          to:      anchorAdmin.email,
          subject: `Invoice ${invoiceRef2} declined by bank`,
          html:    transactionStatusEmailHtml({
            recipientName: anchorAdmin.full_name ?? 'Anchor Admin',
            eventBody:     `Invoice ${invoiceRef2} has been declined by the bank.${rejectReason ? `\n\nReason: ${rejectReason}` : ''}`,
            transactionId: id,
          }),
        })
      }
    }

    return NextResponse.json({ transaction: updated })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch (err: unknown) {
    console.error('[PATCH /api/transactions/:id] unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
