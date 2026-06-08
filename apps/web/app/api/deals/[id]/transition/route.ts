// G2.2 — Single entry point for all deal status changes.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  getFinancingContext,
  type DealForContext,
  type TransactionForContext,
  type BankForContext,
  type OrgForContext,
} from '@/lib/deals/financing-context'
import {
  getPermittedTransition,
  type SideEffect,
  type UserRole,
} from '@/lib/deals/transitions'
import { sendEmail, dealShippedEmailHtml, dealPaymentConfirmedEmailHtml, dealCompletedEmailHtml } from '@/lib/email'
import { runPassportRecalculate } from '@/lib/passport'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TransitionRequest {
  action: string
  payload: Record<string, unknown>
}

async function executeSideEffect(
  effect: SideEffect,
  deal: Record<string, unknown>,
  financingContext: ReturnType<typeof getFinancingContext>,
  actor: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<void> {
  const dealId = deal.id as string
  const buyerOrgId = deal.buyer_org_id as string
  const supplierOrgId = deal.supplier_org_id as string
  const shortId = dealId.slice(0, 8).toUpperCase()

  switch (effect) {
    case 'create_deal_event': {
      const action = payload._action as string | undefined
      const description = payload._description as string ?? `Deal action: ${action ?? 'unknown'}`
      await adminClient.from('deal_events').insert({
        deal_id: dealId,
        event_type: action ?? 'transition',
        actor_user_id: actor.id,
        actor_org_id: actor.org_id,
        description,
        metadata: payload,
      }).then(undefined, console.error)
      break
    }

    case 'notify_counterparty': {
      // In-app notification to counterparty's org users
      const actorOrgId = actor.org_id as string | null
      const counterpartyOrgId = actorOrgId === buyerOrgId ? supplierOrgId : buyerOrgId
      const { data: cpUsers } = await adminClient
        .from('users')
        .select('id')
        .eq('org_id', counterpartyOrgId)
      if (cpUsers && cpUsers.length > 0) {
        const action = payload._action as string | undefined
        await adminClient.from('notifications').insert(
          cpUsers.map((u: any) => ({
            user_id: u.id,
            event: action ?? 'deal_update',
            title: `Deal #${shortId} updated`,
            body: payload._description as string ?? 'Deal status has been updated.',
            deep_link: `/deals/${dealId}`,
            read: false,
          }))
        ).then(undefined, console.error)
      }
      break
    }

    case 'notify_bank': {
      if (!financingContext.isActive) break
      const { data: txn } = await adminClient
        .from('transactions')
        .select('bank_id')
        .eq('deal_id', dealId)
        .limit(1)
        .maybeSingle()
      if (!txn?.bank_id) break
      const { data: bankUsers } = await adminClient
        .from('users')
        .select('id')
        .eq('bank_id', txn.bank_id)
      if (bankUsers && bankUsers.length > 0) {
        await adminClient.from('notifications').insert(
          bankUsers.map((u: any) => ({
            user_id: u.id,
            event: 'deal_update_bank',
            title: `Deal #${shortId} updated`,
            body: payload._description as string ?? 'Deal status has been updated.',
            deep_link: `/deals/${dealId}`,
            read: false,
          }))
        ).then(undefined, console.error)
      }
      break
    }

    case 'notify_admin': {
      const { data: admins } = await adminClient
        .from('users')
        .select('id')
        .eq('role', 'strike_admin')
      if (admins && admins.length > 0) {
        await adminClient.from('notifications').insert(
          admins.map((u: any) => ({
            user_id: u.id,
            event: 'deal_admin_alert',
            title: `Deal #${shortId} needs attention`,
            body: payload._description as string ?? 'A deal requires admin review.',
            deep_link: `/deals/${dealId}`,
            read: false,
          }))
        ).then(undefined, console.error)
      }
      break
    }

    case 'send_email': {
      const action = payload._action as string | undefined
      const [buyerRes, sellerRes] = await Promise.all([
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', buyerOrgId).single(),
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', supplierOrgId).single(),
      ])

      if (action === 'in_preparation:mark_shipped' || action === 'mark_shipped') {
        if (buyerRes.data?.primary_contact_email) {
          void sendEmail({
            to: buyerRes.data.primary_contact_email,
            subject: `Your order has been shipped — Deal #${shortId}`,
            html: dealShippedEmailHtml({
              sellerName: sellerRes.data?.legal_name ?? 'Seller',
              trackingRef: payload.shipment_tracking_ref as string ?? '',
              estimatedDelivery: payload.shipment_estimated_delivery as string | null ?? null,
              dealId,
              dealShortId: shortId,
            }),
          })
        }
      } else if (action === 'confirm_payment_sent' || action === 'payment_due:confirm_payment_sent') {
        if (sellerRes.data?.primary_contact_email) {
          void sendEmail({
            to: sellerRes.data.primary_contact_email,
            subject: `Payment confirmed by buyer — Deal #${shortId}`,
            html: dealPaymentConfirmedEmailHtml({
              buyerName: buyerRes.data?.legal_name ?? 'Buyer',
              paymentRef: payload.payment_external_reference as string ?? '—',
              dealId,
              dealShortId: shortId,
            }),
          })
        }
      } else if (action === 'confirm_receipt') {
        for (const [orgRes, role] of [[buyerRes, 'Buyer'], [sellerRes, 'Seller']] as const) {
          if (orgRes.data?.primary_contact_email) {
            void sendEmail({
              to: orgRes.data.primary_contact_email,
              subject: `Deal #${shortId} completed`,
              html: dealCompletedEmailHtml({ recipientName: role, dealId, dealShortId: shortId }),
            })
          }
        }
      }
      break
    }

    case 'convert_po_financing': {
      // Fires when deal transitions to shipped and PO financing is active
      if (financingContext.structure !== 'po_financing') break
      const now = new Date().toISOString()
      await Promise.resolve(adminClient
        .from('deals')
        .update({ po_financing_converted_at: now })
        .eq('id', dealId)
      ).catch(console.error)

      // Update transaction status to reflect post-delivery repayment
      await Promise.resolve(adminClient
        .from('transactions')
        .update({ status: 'pending_delivery_confirmation', repayment_routing: 'buyer_to_bank' })
        .eq('deal_id', dealId)
      ).catch(console.error)

      // Notify both parties
      const [buyerRes, sellerRes] = await Promise.all([
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', buyerOrgId).single(),
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', supplierOrgId).single(),
      ])
      const amount = financingContext.paymentAmount
      const dueDate = financingContext.paymentDueDate ?? '—'
      const bankN = financingContext.paymentRecipientName

      await adminClient.from('deal_events').insert({
        deal_id: dealId,
        event_type: 'po_financing_converted',
        actor_user_id: actor.id,
        actor_org_id: actor.org_id,
        description: `PO Financing converted on shipment confirmation. Repayment of ${amount} due to ${bankN} on ${dueDate}.`,
      }).then(undefined, console.error)

      const conversionNotice = `PO Financing has converted. Repayment is due to ${bankN} on ${dueDate}.`
      for (const orgRes of [buyerRes, sellerRes]) {
        if (orgRes.data?.primary_contact_email) {
          void sendEmail({
            to: orgRes.data.primary_contact_email,
            subject: `PO Financing converted — Deal #${shortId}`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a"><p>${conversionNotice}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${dealId}">View Deal →</a></p></div>`,
          })
        }
      }
      break
    }

    case 'generate_noa': {
      // Only for Invoice Factoring
      if (financingContext.structure !== 'invoice_factoring') break
      const [buyerRes, sellerRes] = await Promise.all([
        adminClient.from('organizations').select('legal_name').eq('id', buyerOrgId).single(),
        adminClient.from('organizations').select('legal_name').eq('id', supplierOrgId).single(),
      ])

      const now = new Date().toISOString()
      const invoiceAmount = financingContext.paymentAmount
      const dueDate = financingContext.paymentDueDate ?? '—'
      const bankN = financingContext.paymentRecipientName
      const supplierN = sellerRes.data?.legal_name ?? 'Supplier'
      const buyerN = buyerRes.data?.legal_name ?? 'Buyer'

      const noaContent = `NOTICE OF ASSIGNMENT

Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
From: ${supplierN}
To: ${buyerN}

Notice is hereby given that ${supplierN} ("Assignor") has assigned
all rights, title, and interest in the receivable described below to
${bankN} ("Assignee").

Invoice Amount: ${financingContext.paymentCurrency} ${invoiceAmount}
Original Due Date: ${dueDate}

Payment must be made directly to ${bankN}.

Payment to ${supplierN} will not discharge this obligation.

${supplierN}
${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`

      // Store as document
      const { data: noaDoc } = await adminClient
        .from('documents')
        .insert({
          name: `Notice of Assignment — Deal #${shortId}`,
          storage_path: `deals/${dealId}/noa.txt`,
          mime_type: 'text/plain',
          size_bytes: noaContent.length,
          uploaded_by_user_id: actor.id,
          entity_type: 'deal',
          entity_id: dealId,
          document_kind: 'notice_of_assignment',
        })
        .select()
        .single()
        .then(r => r, () => ({ data: null })) as { data: any }

      if (noaDoc) {
        await Promise.resolve(adminClient
          .from('deals')
          .update({ noa_document_id: noaDoc.id, noa_generated_at: now })
          .eq('id', dealId)
        ).catch(console.error)
      }
      break
    }

    case 'send_noa_email': {
      if (financingContext.structure !== 'invoice_factoring') break
      const [buyerRes] = await Promise.all([
        adminClient.from('organizations').select('primary_contact_email, legal_name').eq('id', buyerOrgId).single(),
      ])
      if (buyerRes.data?.primary_contact_email) {
        const bankN = financingContext.paymentRecipientName
        void sendEmail({
          to: buyerRes.data.primary_contact_email,
          subject: `Notice of Assignment — Invoice for Deal #${shortId} has been assigned to ${bankN}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:500px;padding:32px 24px;color:#0f172a">
            <h2 style="font-size:18px;font-weight:700;margin:0 0 16px">Notice of Assignment</h2>
            <p>This invoice has been assigned to ${bankN}. Payment must be made directly to ${bankN}.</p>
            <p>Amount: ${financingContext.paymentCurrency} ${financingContext.paymentAmount}</p>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/deals/${dealId}">View Deal to Acknowledge →</a></p>
          </div>`,
        })
        await Promise.resolve(adminClient
          .from('deals')
          .update({ noa_sent_to_buyer_at: new Date().toISOString() })
          .eq('id', dealId)
        ).catch(console.error)
      }
      break
    }

    case 'recalculate_passport_score': {
      void runPassportRecalculate(buyerOrgId).then(undefined, console.error)
      void runPassportRecalculate(supplierOrgId).then(undefined, console.error)
      break
    }

    case 'update_supplier_performance': {
      // Minimal recalculation
      const { data: deals } = await adminClient
        .from('deals')
        .select('total_value, agreed_price, payment_days_actual')
        .eq('supplier_org_id', supplierOrgId)
        .eq('status', 'completed')
      const completed = deals ?? []
      const now = new Date().toISOString()
      const totalVolume = completed.reduce((s: number, d: any) => s + Number(d.total_value ?? d.agreed_price ?? 0), 0)
      const withPay = completed.filter((d: any) => d.payment_days_actual != null)
      const onTimeRate = withPay.length > 0
        ? withPay.filter((d: any) => (d.payment_days_actual ?? 999) <= 30).length / withPay.length
        : null
      const { data: existing } = await adminClient
        .from('supplier_performance')
        .select('id')
        .eq('org_id', supplierOrgId)
        .limit(1)
        .maybeSingle()
      const sp = { org_id: supplierOrgId, total_transactions: completed.length, total_financed: totalVolume, on_time_payment_rate: onTimeRate, last_calculated_at: now, updated_at: now }
      if (existing?.id) {
        await adminClient.from('supplier_performance').update(sp).eq('id', existing.id).then(undefined, console.error)
      } else {
        await adminClient.from('supplier_performance').insert({ ...sp, created_at: now }).then(undefined, console.error)
      }
      break
    }

    case 'prompt_peer_review':
    case 'create_signal':
    case 'flag_fraud':
      // These are complex side effects — logged for future implementation
      break
  }
}

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
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  let body: TransitionRequest
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, payload = {} } = body
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

  // Fetch deal with linked transaction
  const { data: deal } = await adminClient
    .from('deals')
    .select('*')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const isParty = deal.buyer_org_id === userData.org_id || deal.supplier_org_id === userData.org_id
  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(userData.role)
  if (!isParty && !isBankUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch linked transaction for financing context
  let transaction: TransactionForContext | null = null
  let bankOrg: BankForContext | null = null
  if (deal.financing_payment_active) {
    const { data: txn } = await adminClient
      .from('transactions')
      .select('id, type, status, financing_amount_approved, repayment_due_date, bank_id, discount_rate, early_payment_date, repayment_routing')
      .eq('deal_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (txn) {
      transaction = txn as TransactionForContext
      if (txn.bank_id) {
        const { data: bank } = await adminClient
          .from('banks')
          .select('id, display_name, legal_name')
          .eq('id', txn.bank_id)
          .single()
        bankOrg = bank
      }
    }
  }

  const { data: supplierOrgData } = await adminClient
    .from('organizations')
    .select('legal_name')
    .eq('id', deal.supplier_org_id)
    .single()

  const supplierOrg: OrgForContext = supplierOrgData ?? { legal_name: 'Supplier' }

  const financingContext = getFinancingContext(
    deal as DealForContext,
    transaction,
    null,
    bankOrg,
    supplierOrg
  )

  // Get and validate the transition
  const userRole = userData.role as UserRole
  const rule = getPermittedTransition(deal.status, action, userRole, financingContext)
  if (!rule) {
    return NextResponse.json(
      { error: `Action '${action}' is not permitted at status '${deal.status}' for role '${userRole}'` },
      { status: 403 }
    )
  }

  // Validate required fields
  const missingFields = (rule.requiredFields ?? []).filter(f => !payload[f])
  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missingFields.join(', ')}` },
      { status: 400 }
    )
  }

  // Build deal update
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: rule.nextStatus,
    updated_at: now,
  }

  // Copy allowed payload fields into the update
  const ALLOWED_PAYLOAD_FIELDS = [
    'shipment_tracking_ref', 'shipment_carrier', 'shipment_estimated_delivery',
    'commercial_invoice_id', 'payment_bank_name', 'payment_account_name',
    'payment_account_number', 'payment_routing_number', 'payment_swift_iban',
    'payment_reference', 'payment_currency', 'payment_external_reference',
    'payment_amount', 'dispute_category', 'dispute_reason', 'cancellation_reason',
  ]
  for (const field of ALLOWED_PAYLOAD_FIELDS) {
    if (payload[field] !== undefined) updates[field] = payload[field]
  }

  // Status-specific timestamp fields
  if (rule.nextStatus === 'documents_pending') {
    updates.payment_instructions_set_at = now
    updates.payment_instructions_set_by = userData.id
  }
  if (rule.nextStatus === 'confirmed') updates.confirmed_at = now
  if (rule.nextStatus === 'in_preparation') updates.in_preparation_at = now
  if (rule.nextStatus === 'shipped') updates.shipped_at = now
  if (rule.nextStatus === 'payment_confirmed') {
    updates.payment_confirmed_at = now
    updates.payment_confirmed_by = userData.id
  }
  if (rule.nextStatus === 'completed') updates.completed_at = now
  if (rule.nextStatus === 'cancelled') updates.cancelled_at = now
  if (rule.nextStatus === 'in_dispute') updates.disputed_at = now
  if (payload.commercial_invoice_id !== undefined) {
    updates.commercial_invoice_issued_at = now
  }

  const { data: updated, error: updateError } = await adminClient
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (updateError || !updated) {
    return NextResponse.json({ error: 'Deal update failed' }, { status: 500 })
  }

  // Execute side effects
  const payloadWithAction = { ...payload, _action: action, _description: `Deal action: ${action}` }
  for (const effect of rule.sideEffects) {
    await executeSideEffect(effect, updated, financingContext, userData, payloadWithAction).then(undefined, console.error)
  }

  // Return updated deal + new financing context
  const newFinancingContext = getFinancingContext(
    updated as DealForContext,
    transaction,
    null,
    bankOrg,
    supplierOrg
  )

  return NextResponse.json({ deal: updated, financing_context: newFinancingContext })
}
