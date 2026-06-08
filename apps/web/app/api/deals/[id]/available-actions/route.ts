// G2.3 — Returns the full machine-readable action set for the current user
// at the current deal state with financing context applied.
// Used by both the UI and the AI agent.
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

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface AvailableAction {
  action: string
  label: string
  description: string
  available: boolean
  unavailableReason?: string
  requiredFields: {
    name: string
    type: 'text' | 'date' | 'number' | 'document' | 'select' | 'checkbox'
    label: string
    required: boolean
    options?: string[]
  }[]
  confirmationMessage: string
  financingNote?: string
  isDestructive: boolean
}

function makeUnavailable(action: AvailableAction, reason: string): AvailableAction {
  return { ...action, available: false, unavailableReason: reason }
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
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

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

  const userRole = deal.buyer_org_id === userData.org_id ? 'buyer' : 'supplier'

  // Fetch linked transaction
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
    .select('legal_name, type')
    .eq('id', deal.supplier_org_id)
    .single()
  const { data: buyerOrgData } = await adminClient
    .from('organizations')
    .select('legal_name, type')
    .eq('id', deal.buyer_org_id)
    .single()

  const supplierOrg: OrgForContext = supplierOrgData ?? { legal_name: 'Supplier' }

  const fc = getFinancingContext(
    deal as DealForContext,
    transaction,
    null,
    bankOrg,
    supplierOrg
  )

  const bankName = fc.paymentRecipientName
  const status = deal.status

  const actions: AvailableAction[] = []

  // ── Supplier actions ──────────────────────────────────────────────────────

  if (userRole === 'supplier') {
    // Set payment instructions (agreed stage)
    if (['agreed', 'documents_pending'].includes(status) && !deal.payment_instructions_set_at) {
      actions.push({
        action: 'upload_documents',
        label: 'Set Payment Instructions',
        description: 'Provide your bank details so the buyer knows where to send payment.',
        available: true,
        requiredFields: [
          { name: 'payment_bank_name', type: 'text', label: 'Bank Name', required: true },
          { name: 'payment_account_name', type: 'text', label: 'Account Holder Name', required: true },
          { name: 'payment_account_number', type: 'text', label: 'Account Number', required: false },
          { name: 'payment_swift_iban', type: 'text', label: 'SWIFT / IBAN / Routing', required: false },
          { name: 'payment_reference', type: 'text', label: 'Payment Reference', required: false },
        ],
        confirmationMessage: 'Set your payment instructions and advance the deal?',
        isDestructive: false,
      })
    }

    // Start preparation (confirmed)
    if (status === 'confirmed') {
      actions.push({
        action: 'begin_preparation',
        label: 'Start Preparation',
        description: 'Begin preparing the order for shipment.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Mark this deal as In Preparation?',
        isDestructive: false,
      })
    }

    // Mark shipped (in_preparation)
    if (status === 'in_preparation') {
      actions.push({
        action: 'mark_shipped',
        label: 'Mark as Shipped',
        description: 'Confirm shipment with tracking details.',
        available: true,
        requiredFields: [
          { name: 'shipment_tracking_ref', type: 'text', label: 'Tracking Reference', required: true },
          { name: 'shipment_carrier', type: 'text', label: 'Carrier', required: true },
          { name: 'shipment_estimated_delivery', type: 'date', label: 'Estimated Delivery Date', required: false },
          { name: 'commercial_invoice_id', type: 'document', label: 'Commercial Invoice', required: false },
        ],
        confirmationMessage: 'Confirm shipment and notify buyer?',
        financingNote: fc.structure === 'po_financing'
          ? 'Marking as shipped will convert PO Financing to repayment mode.'
          : undefined,
        isDestructive: false,
      })
    }

    // Confirm payment received (payment_confirmed)
    if (status === 'payment_confirmed') {
      const label = fc.isActive && fc.structure !== 'dynamic_discounting'
        ? `Confirm Repayment Received from ${bankName}`
        : 'Confirm Payment Received'
      actions.push({
        action: 'confirm_receipt',
        label,
        description: 'Confirm that payment has been received to complete this deal.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Confirm payment received and complete this deal?',
        isDestructive: false,
      })
    }
  }

  // ── Buyer actions ─────────────────────────────────────────────────────────

  if (userRole === 'buyer') {
    // Confirm deal (documents_pending, after seller set payment instructions)
    if (status === 'documents_pending' && deal.payment_instructions_set_at) {
      actions.push({
        action: 'confirm',
        label: 'Confirm & Upload PO',
        description: 'Review payment instructions and upload your Purchase Order to confirm the deal.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Confirm the deal and proceed to order preparation?',
        isDestructive: false,
      })
    }

    // Confirm delivery (shipped)
    if (status === 'shipped') {
      actions.push({
        action: 'confirm_delivery',
        label: 'Confirm Delivery',
        description: 'Confirm that you have received the goods in acceptable condition.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Confirm delivery of goods?',
        isDestructive: false,
      })
      actions.push({
        action: 'raise_dispute',
        label: 'Raise a Dispute',
        description: 'Flag an issue with the shipment. Strike Admin will mediate.',
        available: true,
        requiredFields: [
          { name: 'dispute_category', type: 'select', label: 'Category', required: true, options: ['non_delivery', 'wrong_goods', 'quality_issue', 'document_dispute', 'other'] },
          { name: 'dispute_reason', type: 'text', label: 'Describe the Issue', required: true },
        ],
        confirmationMessage: 'Raise a dispute? Strike Admin will be notified.',
        isDestructive: true,
      })
    }

    // Acknowledge NOA (Invoice Factoring only, before payment)
    if (
      fc.structure === 'invoice_factoring' &&
      fc.noaRequired &&
      !fc.noaAcknowledged &&
      ['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(status)
    ) {
      actions.push({
        action: 'acknowledge_noa',
        label: 'Acknowledge Notice of Assignment',
        description: 'You must acknowledge receipt of the Notice of Assignment before payment instructions are shown.',
        available: true,
        requiredFields: [
          {
            name: 'acknowledged',
            type: 'checkbox',
            label: `I acknowledge receipt of this Notice of Assignment and understand that payment must be made to ${bankName}`,
            required: true,
          },
        ],
        confirmationMessage: `Acknowledge that your payment obligation has transferred to ${bankName}?`,
        isDestructive: false,
      })
    }

    // Confirm payment sent (delivery_confirmed, payment_due, payment_overdue)
    if (['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(status)) {
      // Block if IF financing active and NOA not acknowledged
      const noaBlocked = fc.structure === 'invoice_factoring' && fc.noaRequired && !fc.noaAcknowledged
      const payLabel = fc.isActive && fc.structure !== 'dynamic_discounting'
        ? `Confirm Repayment Sent to ${bankName}`
        : 'Confirm Payment Sent'

      const payAction: AvailableAction = {
        action: 'confirm_payment_sent',
        label: payLabel,
        description: 'Confirm that payment has been sent.',
        available: !noaBlocked,
        unavailableReason: noaBlocked ? 'You must acknowledge the Notice of Assignment before confirming payment.' : undefined,
        requiredFields: [
          { name: 'payment_external_reference', type: 'text', label: 'Bank Reference / Transaction ID', required: false },
          { name: 'payment_amount', type: 'number', label: 'Amount Sent', required: false },
        ],
        confirmationMessage: 'Confirm that payment has been sent?',
        financingNote: fc.paymentWarningMessage ?? undefined,
        isDestructive: false,
      }
      actions.push(payAction)
    }

    // DD offer (anchor can present DD offer when delivery_confirmed and DD program exists)
    if (status === 'delivery_confirmed' && buyerOrgData?.type === 'anchor') {
      actions.push({
        action: 'present_dd_offer',
        label: 'Offer Early Payment (Dynamic Discounting)',
        description: 'Offer the supplier an early payment at a discount. No bank involvement — you pay directly.',
        available: !fc.isActive,
        unavailableReason: fc.isActive ? 'Financing is already active on this deal.' : undefined,
        requiredFields: [
          { name: 'discount_rate', type: 'number', label: 'Discount Rate (% annualized)', required: true },
          { name: 'early_payment_date', type: 'date', label: 'Proposed Payment Date', required: true },
        ],
        confirmationMessage: 'Present this early payment offer to the supplier?',
        isDestructive: false,
      })
    }
  }

  // ── Cancellation (both parties, status-dependent) ─────────────────────────

  const cancellableStatuses = ['agreed', 'documents_pending', 'confirmed', 'in_preparation']
  if (cancellableStatuses.includes(status) && isParty) {
    const cancelAction: AvailableAction = {
      action: 'cancel',
      label: 'Cancel Deal',
      description: 'Cancel this deal. Blocked if financing is active.',
      available: !deal.financing_payment_active,
      unavailableReason: deal.financing_payment_active ? 'Cannot cancel while financing is active.' : undefined,
      requiredFields: [
        { name: 'cancellation_reason', type: 'text', label: 'Reason for Cancellation', required: true },
      ],
      confirmationMessage: 'Cancel this deal? This action cannot be undone.',
      isDestructive: true,
    }
    actions.push(cancelAction)
  }

  // ── Bank actions ──────────────────────────────────────────────────────────

  if (isBankUser && status === 'payment_confirmed') {
    actions.push({
      action: 'confirm_receipt',
      label: 'Confirm Repayment Received',
      description: 'Confirm that repayment has been received from the buyer.',
      available: true,
      requiredFields: [],
      confirmationMessage: 'Confirm repayment received and complete this deal?',
      isDestructive: false,
    })
  }

  return NextResponse.json({
    actions,
    financing_context: fc,
    deal_status: status,
    user_role: isBankUser ? 'bank' : userRole,
  })
}
