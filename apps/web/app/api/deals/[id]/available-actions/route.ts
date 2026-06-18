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

  const userRole: 'buyer' | 'supplier' = deal.buyer_org_id === userData.org_id ? 'buyer' : 'supplier'

  // Fetch listing to determine scenario (A vs B).
  // Use listing_type — the canonical signal — not org_id, since any org can
  // post either type regardless of what "kind" of account they are.
  let listingType: string | null = null
  if (deal.listing_id) {
    const { data: listing } = await adminClient
      .from('marketplace_listings')
      .select('listing_type')
      .eq('id', deal.listing_id)
      .maybeSingle()
    listingType = listing?.listing_type ?? null
  }

  // Fetch linked transaction
  let transaction: TransactionForContext | null = null
  let bankOrg: BankForContext | null = null
  if (deal.financing_payment_active || deal.status === 'financing_active') {
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
    // V2 FLOW: Supplier signs contract (contract_pending → confirmed)
    if (status === 'contract_pending') {
      actions.push({
        action: 'sign_contract',
        label: 'Sign Contract',
        description: 'Review the contract submitted by the buyer and sign with your full legal name to confirm the deal.',
        available: true,
        requiredFields: [
          { name: 'contract_supplier_signature', type: 'text', label: 'Full Legal Name (typed signature)', required: true },
        ],
        confirmationMessage: 'Sign the contract and advance the deal to confirmed?',
        isDestructive: false,
      })
    }

    // LEGACY FLOW: Scenario A — po_request listing (buyer posted a purchase request)
    // Only for deals that haven't gone through the v2 contract flow.
    if (status === 'agreed' && listingType === 'po_request' && !deal.contract_document_id && !deal.listing_id) {
      actions.push({
        action: 'confirm_po',
        label: 'Confirm Purchase Order',
        description: 'Confirm the Purchase Order to begin fulfilling this deal. Upload the PO document if available.',
        available: true,
        requiredFields: [
          { name: 'commercial_invoice_id', type: 'document', label: 'PO Document (optional)', required: false },
        ],
        confirmationMessage: 'Confirm the PO and advance the deal to preparation?',
        isDestructive: false,
      })
    }

    // LEGACY: Set payment instructions (old documents_pending path, or direct/imported deals with no listing)
    if (['agreed', 'documents_pending'].includes(status) && !deal.payment_instructions_set_at && !deal.po_confirmed_at && !deal.invoice_confirmed_at && (listingType === null || status === 'documents_pending')) {
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

    // LEGACY: Start preparation (confirmed, old path — not used for v2 marketplace deals)
    if (status === 'confirmed' && !deal.po_confirmed_at && !deal.invoice_confirmed_at && !deal.listing_id) {
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

    // NEW FLOW: Mark shipped directly from confirmed (v2 marketplace deals, or legacy Scenario A/B)
    if (status === 'confirmed' && (deal.po_confirmed_at || deal.invoice_confirmed_at || deal.listing_id)) {
      actions.push({
        action: 'mark_shipped',
        label: 'Mark as Shipped',
        description: 'Confirm goods have been shipped with tracking details and commercial invoice.',
        available: true,
        requiredFields: [
          { name: 'shipment_tracking_ref', type: 'text', label: 'Tracking Reference', required: true },
          { name: 'shipment_carrier', type: 'text', label: 'Carrier / Shipping Company', required: true },
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

    // LEGACY: Mark shipped from in_preparation
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

    // NEW FLOW: Submit payment information (after buyer confirms delivery)
    // Bank does this when financing is active; supplier does it otherwise
    if (status === 'delivery_confirmed' && !fc.isActive && !deal.receiving_bank_account_id) {
      actions.push({
        action: 'submit_payment_info',
        label: 'Submit Payment Details',
        description: 'Provide your bank account details so the buyer knows where to send payment.',
        available: true,
        requiredFields: [
          { name: 'payment_bank_name', type: 'text', label: 'Bank Name', required: true },
          { name: 'payment_account_name', type: 'text', label: 'Account Holder Name', required: true },
          { name: 'payment_account_number', type: 'text', label: 'Account Number', required: false },
          { name: 'payment_swift_iban', type: 'text', label: 'SWIFT / IBAN', required: false },
          { name: 'payment_routing_number', type: 'text', label: 'Routing Number', required: false },
          { name: 'payment_reference', type: 'text', label: 'Payment Reference', required: false },
        ],
        confirmationMessage: 'Submit your payment details to the buyer?',
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
    // V2 FLOW: Buyer submits contract (agreed → contract_pending)
    // Primary path for all new marketplace deals.
    if (status === 'agreed' && deal.listing_id) {
      actions.push({
        action: 'submit_contract',
        label: 'Submit Contract',
        description: 'Generate an AI-drafted contract or upload your own. The supplier will review and sign.',
        available: true,
        requiredFields: [
          { name: 'generate_contract', type: 'checkbox', label: 'Auto-generate contract with AI', required: false },
          { name: 'contract_document_id', type: 'document', label: 'Contract Document (if not auto-generating)', required: false },
        ],
        confirmationMessage: 'Submit the contract for supplier signature?',
        isDestructive: false,
      })
    }

    // LEGACY: Scenario B — product_service listing, old flow without contract step
    if (status === 'agreed' && listingType === 'product_service' && !deal.listing_id) {
      actions.push({
        action: 'confirm_invoice',
        label: 'Confirm Invoice',
        description: 'Confirm the supplier\'s invoice to proceed with this deal. Upload the invoice document if available.',
        available: true,
        requiredFields: [
          { name: 'commercial_invoice_id', type: 'document', label: 'Invoice Document (optional)', required: false },
        ],
        confirmationMessage: 'Confirm the invoice and advance this deal?',
        isDestructive: false,
      })
    }

    // LEGACY: Confirm deal (documents_pending, after seller set payment instructions)
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

    // NEW FLOW: Buyer confirms goods received (shipped → goods_received)
    if (status === 'shipped') {
      actions.push({
        action: 'confirm_received',
        label: 'Confirm Goods Received',
        description: 'Confirm that the goods have been delivered to your location.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Confirm you have received the goods?',
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

    // NEW FLOW: Buyer confirms goods condition (goods_received → delivery_confirmed)
    if (status === 'goods_received') {
      actions.push({
        action: 'confirm_goods',
        label: 'Confirm Goods Condition',
        description: 'Confirm that the goods match your order — correct quantity, quality, and description.',
        available: true,
        requiredFields: [],
        confirmationMessage: 'Confirm goods are as expected and accept delivery?',
        isDestructive: false,
      })
      actions.push({
        action: 'raise_dispute',
        label: 'Raise a Dispute',
        description: 'Flag a condition issue with the received goods. Strike Admin will mediate.',
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
      ['delivery_confirmed', 'payment_info_sent', 'payment_due', 'payment_overdue'].includes(status)
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

    // NEW FLOW: Buyer submits payment reference (payment_info_sent → payment_confirmed)
    if (status === 'payment_info_sent') {
      const noaBlocked = fc.structure === 'invoice_factoring' && fc.noaRequired && !fc.noaAcknowledged
      const payLabel = fc.isActive && fc.structure !== 'dynamic_discounting'
        ? `Confirm Repayment Sent to ${bankName}`
        : 'Submit Payment Reference'
      actions.push({
        action: 'confirm_payment_sent',
        label: payLabel,
        description: 'Provide your bank transfer reference to confirm payment has been sent.',
        available: !noaBlocked,
        unavailableReason: noaBlocked ? 'You must acknowledge the Notice of Assignment before confirming payment.' : undefined,
        requiredFields: [
          { name: 'payment_external_reference', type: 'text', label: 'Bank Reference / Transaction ID', required: true },
          { name: 'payment_amount', type: 'number', label: 'Amount Sent', required: false },
        ],
        confirmationMessage: 'Confirm that payment has been sent?',
        financingNote: fc.paymentWarningMessage ?? undefined,
        isDestructive: false,
      })
    }

    // LEGACY: Confirm payment sent (delivery_confirmed without new flow, payment_due, payment_overdue)
    // Only show for old-flow deals (goods_confirmed_at is null = delivery not confirmed via new path)
    if (['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(status) && !deal.goods_confirmed_at) {
      const noaBlocked = fc.structure === 'invoice_factoring' && fc.noaRequired && !fc.noaAcknowledged
      const payLabel = fc.isActive && fc.structure !== 'dynamic_discounting'
        ? `Confirm Repayment Sent to ${bankName}`
        : 'Confirm Payment Sent'

      actions.push({
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
      })
    }

    // DD offer (anchor can present DD offer when delivery_confirmed and DD program exists)
    if (['delivery_confirmed', 'payment_info_sent'].includes(status) && buyerOrgData?.type === 'anchor') {
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

  // ── Bank contract signing (party action when bank has submitted a financing contract) ───

  if (isParty && deal.bank_contract_document_id && !deal.bank_contract_signature) {
    // Determine which party signs: buyer for RF/IF/PO, supplier for DD
    const signerRole: 'buyer' | 'supplier' = fc.structure === 'dynamic_discounting' ? 'supplier' : 'buyer'
    const isCorrectSigner = signerRole === userRole
    if (isCorrectSigner) {
      actions.push({
        action: 'sign_bank_contract',
        label: 'Sign Financing Contract',
        description: 'Review and sign the financing contract submitted by the bank.',
        available: true,
        requiredFields: [
          { name: 'bank_contract_signature', type: 'text', label: 'Full Legal Name (typed signature)', required: true },
        ],
        confirmationMessage: 'Sign the financing contract?',
        isDestructive: false,
      })
    }
  }

  // ── Cancellation (both parties, status-dependent) ─────────────────────────

  const cancellableStatuses = ['agreed', 'contract_pending', 'documents_pending', 'confirmed', 'in_preparation', 'goods_received', 'payment_info_sent']
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

  if (isBankUser) {
    // Bank submits financing contract (after party accepts bank's offer, deal is confirmed/active)
    if (['confirmed', 'shipped', 'goods_received', 'delivery_confirmed'].includes(status) && fc.isActive && !deal.bank_contract_document_id) {
      actions.push({
        action: 'submit_bank_contract',
        label: 'Submit Financing Contract',
        description: 'Submit the financing contract for the borrowing party to review and sign.',
        available: true,
        requiredFields: [
          { name: 'bank_contract_document_id', type: 'document', label: 'Financing Contract Document', required: true },
        ],
        confirmationMessage: 'Submit the financing contract for signature?',
        isDestructive: false,
      })
    }

    // Bank submits payment info when financing is active and delivery is confirmed
    if (status === 'delivery_confirmed' && fc.isActive) {
      actions.push({
        action: 'submit_payment_info',
        label: 'Submit Bank Payment Details',
        description: 'Provide your bank account details for the buyer to repay the financing.',
        available: true,
        requiredFields: [
          { name: 'payment_bank_name', type: 'text', label: 'Bank Name', required: true },
          { name: 'payment_account_name', type: 'text', label: 'Account Name', required: true },
          { name: 'payment_account_number', type: 'text', label: 'Account Number', required: false },
          { name: 'payment_swift_iban', type: 'text', label: 'SWIFT / IBAN', required: false },
          { name: 'payment_routing_number', type: 'text', label: 'Routing Number', required: false },
          { name: 'payment_reference', type: 'text', label: 'Payment Reference', required: false },
        ],
        confirmationMessage: 'Submit your payment details to the buyer?',
        isDestructive: false,
      })
    }

    if (status === 'payment_confirmed') {
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
  }

  return NextResponse.json({
    actions,
    financing_context: fc,
    deal_status: status,
    user_role: isBankUser ? 'bank' : userRole,
  })
}
