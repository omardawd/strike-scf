import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, transactionStatusEmailHtml } from '@/lib/email'

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function getNegotiationState(txn: Record<string, unknown>): Record<string, unknown> {
  try { return JSON.parse((txn.bank_approval_notes as string) ?? '{}') } catch { return {} }
}

function setNegotiationState(state: object): string {
  return JSON.stringify(state)
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

    if (transaction.type === 'po_financing' && action === 'approve') {
      delete body.payment_extension
      delete body.installment_request
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

    // Anchor accepts/rejects bank's counter on their repayment request (at pending_bank_review)
    if (action === 'accept_anchor_counter' || action === 'reject_anchor_counter') {
      if (transaction.status !== 'pending_bank_review') {
        return NextResponse.json({ error: 'No counter pending' }, { status: 400 })
      }
      const acState = getNegotiationState(transaction as Record<string, unknown>)
      const acAnchorNeg = acState.anchor_negotiation as Record<string, unknown> | undefined
      if (!acAnchorNeg?.type) {
        return NextResponse.json({ error: 'No anchor negotiation active' }, { status: 400 })
      }
      const accepted = action === 'accept_anchor_counter'
      acAnchorNeg.status = accepted ? 'approved' : 'rejected'

      const acSupplierDone = (acState.supplier_negotiation as Record<string, unknown> | undefined)?.status === 'approved'
      const acAnchorDone   = !acAnchorNeg.type || ['approved', 'rejected'].includes(acAnchorNeg.status as string)
      const acNewStatus    = acSupplierDone && acAnchorDone ? 'financing_approved' : transaction.status

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: acNewStatus, bank_approval_notes: setNegotiationState(acState), updated_at: new Date().toISOString() })
        .eq('id', id).select().single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     accepted ? 'anchor_accepted_counter' : 'anchor_rejected_counter',
        from_status:    transaction.status,
        to_status:      acNewStatus,
        actor_id:       user.id,
        actor_type:     'anchor',
        notes:          accepted ? 'Anchor accepted repayment counter-offer' : 'Anchor declined repayment counter-offer',
      })

      return NextResponse.json({ transaction: updated })
    }

    if (transaction.status !== 'pending_anchor_approval') {
      return NextResponse.json({ error: 'Transaction is not awaiting anchor approval' }, { status: 400 })
    }

    if (action === 'reject') {
      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', id).select().single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'anchor_rejected',
        from_status:    transaction.status,
        to_status:      'rejected',
        actor_id:       user.id,
        actor_type:     'anchor',
        notes:          body.notes ? String(body.notes) : null,
      })

      return NextResponse.json({ transaction: updated })
    }

    if (action !== 'approve' && action !== 'approve_with_extension' && action !== 'approve_with_installment') {
      return NextResponse.json({ error: 'action must be approve, approve_with_extension, approve_with_installment, or reject' }, { status: 400 })
    }

    let negState: Record<string, unknown>
    let eventNotes: string | null = null

    if (action === 'approve') {
      negState   = { supplier_negotiation: { status: 'pending' }, anchor_negotiation: { type: null, status: 'approved' } }
      eventNotes = 'Anchor approved invoice'
    } else if (action === 'approve_with_extension') {
      const extDate  = body.extension_date  ? String(body.extension_date)  : null
      const extNotes = body.extension_notes ? String(body.extension_notes) : null
      if (!extDate) return NextResponse.json({ error: 'extension_date is required' }, { status: 400 })
      negState   = {
        supplier_negotiation: { status: 'pending' },
        anchor_negotiation:   { type: 'extension', status: 'pending', anchor_request: { date: extDate, notes: extNotes } },
      }
      eventNotes = `Anchor approved with extension request to ${extDate}`
    } else {
      const count     = body.installment_count     != null ? Number(body.installment_count)     : null
      const structure = body.installment_structure ? String(body.installment_structure) : null
      const instNotes = body.installment_notes    ? String(body.installment_notes)    : null
      if (!count || !structure) return NextResponse.json({ error: 'installment_count and installment_structure are required' }, { status: 400 })
      negState   = {
        supplier_negotiation: { status: 'pending' },
        anchor_negotiation:   { type: 'installment', status: 'pending', anchor_request: { count, structure, notes: instNotes } },
      }
      eventNotes = `Anchor approved with installment request: ${count} ${structure} payments`
    }

    const { data: updated, error: approveError } = await adminClient
      .from('transactions')
      .update({ status: 'pending_bank_review', bank_approval_notes: setNegotiationState(negState), updated_at: new Date().toISOString() })
      .eq('id', id).select().single()

    if (approveError) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

    await adminClient.from('transaction_events').insert({
      transaction_id: id,
      event_type:     'anchor_approved',
      from_status:    transaction.status,
      to_status:      'pending_bank_review',
      actor_id:       user.id,
      actor_type:     'anchor',
      notes:          eventNotes,
    })

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
      const acState = getNegotiationState(transaction as Record<string, unknown>)
      if (acState.supplier_negotiation) {
        (acState.supplier_negotiation as Record<string, unknown>).status = 'approved'
      }
      const acAnchorNeg  = acState.anchor_negotiation as Record<string, unknown> | undefined
      const acAnchorDone = !acAnchorNeg?.type || ['approved', 'rejected'].includes(acAnchorNeg?.status as string)
      const acNewStatus  = acAnchorDone ? 'financing_approved' : 'pending_bank_review'

      const { data: updated, error } = await adminClient
        .from('transactions')
        .update({ status: acNewStatus, bank_approval_notes: setNegotiationState(acState), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

      await adminClient.from('transaction_events').insert({
        transaction_id: id,
        event_type:     'counter_offer_accepted',
        from_status:    transaction.status,
        to_status:      acNewStatus,
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

    // counter_offer: bank counters supplier or anchor negotiation
    if (action === 'counter_offer') {
      const coTarget = (body.negotiation_target as string | undefined) ?? 'supplier'

      if (coTarget === 'anchor') {
        if (transaction.status !== 'pending_bank_review' && transaction.status !== 'more_info_requested') {
          return NextResponse.json({ error: 'Transaction is not awaiting bank review' }, { status: 400 })
        }
        const coState    = getNegotiationState(transaction as Record<string, unknown>)
        const coAnchorNeg = coState.anchor_negotiation as Record<string, unknown> | undefined
        if (!coAnchorNeg?.type) {
          return NextResponse.json({ error: 'No anchor repayment negotiation active' }, { status: 400 })
        }

        const counterDate      = body.counter_date      ? String(body.counter_date)      : null
        const counterCount     = body.counter_count     != null ? Number(body.counter_count)  : null
        const counterStructure = body.counter_structure ? String(body.counter_structure) : null

        coAnchorNeg.status      = 'counter_offered'
        coAnchorNeg.bank_counter = { date: counterDate, count: counterCount, structure: counterStructure }

        const { data: updated, error } = await adminClient
          .from('transactions')
          .update({ bank_approval_notes: setNegotiationState(coState), updated_at: new Date().toISOString() })
          .eq('id', id).select().single()

        if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

        await adminClient.from('transaction_events').insert({
          transaction_id: id,
          event_type:     'anchor_repayment_counter_offered',
          from_status:    transaction.status,
          to_status:      transaction.status,
          actor_id:       user.id,
          actor_type:     'bank',
          notes:          'Bank counter-offered anchor repayment request',
        })

        const { data: anchorAdminCo } = await adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.anchor_id).eq('role', 'anchor_admin').limit(1).maybeSingle()
        if (anchorAdminCo?.email) {
          const invoiceRefCo = transaction.invoice_number ?? id
          await sendEmail({
            to:      anchorAdminCo.email,
            subject: `Counter-proposal for your repayment request on invoice ${invoiceRefCo}`,
            html:    transactionStatusEmailHtml({
              recipientName: anchorAdminCo.full_name ?? 'Anchor Admin',
              eventBody:     `The bank has a counter-proposal for your repayment request on invoice ${invoiceRefCo}. Please review and respond.`,
              transactionId: id,
            }),
          })
        }

        return NextResponse.json({ transaction: updated })
      }

      // Supplier counter-offer (default)
      if (transaction.status !== 'pending_bank_review' && transaction.status !== 'more_info_requested') {
        return NextResponse.json({ error: 'Transaction is not awaiting bank review' }, { status: 400 })
      }

      const rateApr        = body.apr != null ? Number(body.apr) : null
      const amountApproved = body.financing_amount_approved != null ? Number(body.financing_amount_approved) : null
      const counterNotes   = body.counter_offer_notes ? String(body.counter_offer_notes) : null

      if (!rateApr || !amountApproved) {
        return NextResponse.json({ error: 'apr and financing_amount_approved are required' }, { status: 400 })
      }

      const discountFeeCounter = body.discount_fee != null ? Number(body.discount_fee) : 0

      const scState = getNegotiationState(transaction as Record<string, unknown>)
      if (scState.supplier_negotiation) {
        (scState.supplier_negotiation as Record<string, unknown>).status = 'counter_offered'
      }

      const counterPayload: Record<string, unknown> = {
        status:                    'pending_supplier_counter_review',
        financing_rate_apr:        rateApr,
        financing_amount_approved: amountApproved,
        fee_amount:                discountFeeCounter,
        bank_approval_notes:       setNegotiationState(scState),
        updated_at:                new Date().toISOString(),
      }

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

    const bankNegTarget = (body.negotiation_target as string | undefined) ?? 'supplier'

    // ── Anchor negotiation decisions ──────────────────────────────────────────
    if (bankNegTarget === 'anchor') {
      const anState   = getNegotiationState(transaction as Record<string, unknown>)
      const anNeg     = anState.anchor_negotiation as Record<string, unknown> | undefined
      if (!anNeg?.type) {
        return NextResponse.json({ error: 'No anchor repayment negotiation active' }, { status: 400 })
      }

      const checkBothResolved = (s: Record<string, unknown>) => {
        const sNeg = s.supplier_negotiation as Record<string, unknown> | undefined
        const aNeg = s.anchor_negotiation   as Record<string, unknown> | undefined
        const supplierDone = sNeg?.status === 'approved'
        const anchorDone   = !aNeg?.type || ['approved', 'rejected'].includes(aNeg?.status as string)
        return supplierDone && anchorDone
      }

      if (action === 'approve') {
        anNeg.status       = 'approved'
        const resolvedStat = checkBothResolved(anState) ? 'financing_approved' : transaction.status

        const { data: updated, error } = await adminClient
          .from('transactions')
          .update({ status: resolvedStat, bank_approval_notes: setNegotiationState(anState), updated_at: new Date().toISOString() })
          .eq('id', id).select().single()

        if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

        await adminClient.from('transaction_events').insert({
          transaction_id: id,
          event_type:     'anchor_repayment_approved',
          from_status:    transaction.status,
          to_status:      resolvedStat,
          actor_id:       user.id,
          actor_type:     'bank',
          notes:          'Bank approved anchor repayment request',
        })

        return NextResponse.json({ transaction: updated })
      }

      if (action === 'reject') {
        anNeg.status       = 'rejected'
        const resolvedStat = checkBothResolved(anState) ? 'financing_approved' : transaction.status

        const { data: updated, error } = await adminClient
          .from('transactions')
          .update({ status: resolvedStat, bank_approval_notes: setNegotiationState(anState), updated_at: new Date().toISOString() })
          .eq('id', id).select().single()

        if (error) return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })

        await adminClient.from('transaction_events').insert({
          transaction_id: id,
          event_type:     'anchor_repayment_rejected',
          from_status:    transaction.status,
          to_status:      resolvedStat,
          actor_id:       user.id,
          actor_type:     'bank',
          notes:          'Bank rejected repayment extension — standard terms apply',
        })

        const { data: anchorAdminAn } = await adminClient.from('users').select('email, full_name')
          .eq('org_id', transaction.anchor_id).eq('role', 'anchor_admin').limit(1).maybeSingle()
        if (anchorAdminAn?.email) {
          const invoiceRefAn = transaction.invoice_number ?? id
          await sendEmail({
            to:      anchorAdminAn.email,
            subject: `Repayment extension declined for invoice ${invoiceRefAn}`,
            html:    transactionStatusEmailHtml({
              recipientName: anchorAdminAn.full_name ?? 'Anchor Admin',
              eventBody:     `The bank has declined your repayment extension request for invoice ${invoiceRefAn}. Standard repayment terms will apply.`,
              transactionId: id,
            }),
          })
        }

        return NextResponse.json({ transaction: updated })
      }

      return NextResponse.json({ error: 'action must be approve, counter_offer, or reject for anchor target' }, { status: 400 })
    }

    // ── Supplier negotiation decisions (default) ──────────────────────────────
    if (action !== 'approve' && action !== 'reject' && action !== 'request_info') {
      return NextResponse.json({ error: 'action must be approve, reject, request_info, or counter_offer' }, { status: 400 })
    }

    const snState = getNegotiationState(transaction as Record<string, unknown>)

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (action === 'approve') {
      const rateApr        = body.apr != null ? Number(body.apr) : null
      const amountApproved = body.financing_amount_approved != null ? Number(body.financing_amount_approved) : null

      if (rateApr != null)        updatePayload.financing_rate_apr        = rateApr
      if (amountApproved != null) updatePayload.financing_amount_approved = amountApproved

      const discountFee = body.discount_fee != null ? Number(body.discount_fee)
        : body.fee_amount != null ? Number(body.fee_amount)
        : 0
      updatePayload.fee_amount   = discountFee
      updatePayload.net_proceeds = (amountApproved ?? 0) - discountFee

      if (snState.supplier_negotiation) {
        (snState.supplier_negotiation as Record<string, unknown>).status     = 'approved'
        ;(snState.supplier_negotiation as Record<string, unknown>).bank_offer = { advance_rate: rateApr, amount: amountApproved, fee: discountFee }
      }

      const snAnchorNeg  = snState.anchor_negotiation as Record<string, unknown> | undefined
      const snAnchorDone = !snAnchorNeg?.type || ['approved', 'rejected'].includes(snAnchorNeg?.status as string)
      updatePayload.status             = snAnchorDone ? 'financing_approved' : 'pending_bank_review'
      updatePayload.bank_approval_notes = setNegotiationState(snState)
    }

    if (action === 'reject') {
      updatePayload.status             = 'rejected'
      updatePayload.bank_approval_notes = body.rejection_reason !== undefined ? String(body.rejection_reason) : undefined
    }

    if (action === 'request_info') {
      updatePayload.status = 'more_info_requested'
    }

    if (body.net_proceeds !== undefined) updatePayload.net_proceeds = Number(body.net_proceeds)

    const finalStatus = updatePayload.status as string

    const { data: updated, error: bankErr } = await adminClient
      .from('transactions')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (bankErr) {
      console.error('[bank approve/reject/request_info] update error:', bankErr)
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
    }

    await adminClient.from('transaction_events').insert({
      transaction_id: id,
      event_type:     action === 'approve' ? 'bank_approved'
        : action === 'reject' ? 'bank_rejected'
        : 'bank_requested_info',
      from_status:    transaction.status,
      to_status:      finalStatus,
      actor_id:       user.id,
      actor_type:     'bank',
      notes:          action === 'reject' && body.rejection_reason ? String(body.rejection_reason) : null,
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
