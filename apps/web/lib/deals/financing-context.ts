// G1.1 — Single source of truth for all financing structure logic.
// Nothing else in the codebase makes financing structure decisions.
// Components and API routes import from here.

export type DealFinancingStructure =
  | 'reverse_factoring'
  | 'invoice_factoring'
  | 'po_financing'
  | 'dynamic_discounting'
  | null

export interface PaymentInstructions {
  bankName: string
  accountName: string
  accountNumberMasked: string // last 4 digits only
  routingSwiftIban: string
  currency: string
  reference: string
}

export interface FinancingContext {
  structure: DealFinancingStructure
  isActive: boolean

  paymentRecipient: 'supplier' | 'bank'
  paymentRecipientName: string
  paymentInstructions: PaymentInstructions | null

  paymentAmount: number
  paymentCurrency: string
  paymentDueDate: string | null

  repaymentRouting: 'buyer_to_bank' | 'direct' | null

  isPOFinancingPreShipment: boolean
  poFinancingConverted: boolean

  ddDiscountRate: number | null
  ddDiscountAmount: number | null
  ddEarlyPaymentDate: string | null
  ddFullAmount: number | null

  noaRequired: boolean
  noaAcknowledged: boolean
  noaDocumentId: string | null

  canRequestFinancing: boolean
  cannotRequestReason: string | null

  paymentStepLabel: string
  paymentWarningMessage: string | null
  financingBadgeLabel: string | null

  aiContextSummary: string
}

export interface BankAccountForContext {
  bank_name: string
  account_holder_name: string
  account_number: string
  routing_number?: string | null
  swift_iban?: string | null
  nickname?: string | null
  account_type?: string | null
}

// Minimal deal shape needed by this function
export interface DealForContext {
  status: string
  financing_payment_active: boolean
  total_value?: number | null
  agreed_price?: number | null
  agreed_currency?: string | null
  payment_due_date?: string | null
  // v2: structured bank account record (preferred)
  receiving_bank_account?: BankAccountForContext | null
  // legacy manual fields (fallback for older deals)
  payment_bank_name?: string | null
  payment_account_number?: string | null
  payment_account_name?: string | null
  payment_swift_iban?: string | null
  payment_routing_number?: string | null
  payment_reference?: string | null
  noa_acknowledged_at?: string | null
  noa_document_id?: string | null
}

export interface TransactionForContext {
  type: string
  status: string
  financing_amount_approved?: number | null
  repayment_due_date?: string | null
  discount_rate?: number | null
  discount_amount?: number | null
  early_payment_date?: string | null
  repayment_routing?: string | null
  bank_id?: string | null
}

export interface OrgForContext {
  legal_name?: string | null
  display_name?: string | null
  primary_contact_email?: string | null
}

export interface BankForContext {
  id?: string
  legal_name?: string | null
  display_name?: string | null
}

function buildPaymentInstructions(deal: DealForContext, currency: string): PaymentInstructions | null {
  const acc = deal.receiving_bank_account
  if (acc) {
    return {
      bankName: acc.bank_name,
      accountName: acc.account_holder_name,
      accountNumberMasked: acc.account_number.length > 4
        ? `****${acc.account_number.slice(-4)}`
        : acc.account_number,
      routingSwiftIban: acc.swift_iban ?? acc.routing_number ?? '',
      currency,
      reference: deal.payment_reference ?? '',
    }
  }
  // Legacy fallback
  if (!deal.payment_bank_name) return null
  return {
    bankName: deal.payment_bank_name,
    accountName: deal.payment_account_name ?? '',
    accountNumberMasked: deal.payment_account_number
      ? `****${deal.payment_account_number.slice(-4)}`
      : '',
    routingSwiftIban: deal.payment_swift_iban ?? deal.payment_routing_number ?? '',
    currency,
    reference: deal.payment_reference ?? '',
  }
}

// When financing is active, the buyer repays the bank, not the supplier — build
// payment instructions from the bank's own bank_accounts record. No legacy fallback
// here: legacy payment_* fields on the deal always represent the supplier's account.
function buildBankPaymentInstructions(
  acc: BankAccountForContext | null | undefined,
  reference: string | null | undefined,
  currency: string
): PaymentInstructions | null {
  if (!acc) return null
  return {
    bankName: acc.bank_name,
    accountName: acc.account_holder_name,
    accountNumberMasked: acc.account_number.length > 4
      ? `****${acc.account_number.slice(-4)}`
      : acc.account_number,
    routingSwiftIban: acc.swift_iban ?? acc.routing_number ?? '',
    currency,
    reference: reference ?? '',
  }
}

function mapStructure(txnType: string): DealFinancingStructure {
  switch (txnType) {
    case 'reverse_factoring':   return 'reverse_factoring'
    case 'invoice_factoring':
    case 'factoring':           return 'invoice_factoring'
    case 'po_financing':        return 'po_financing'
    case 'dynamic_discounting': return 'dynamic_discounting'
    default:                    return null
  }
}

const POST_SHIPMENT = ['shipped', 'goods_received', 'delivery_confirmed', 'payment_due', 'payment_overdue', 'payment_info_sent', 'payment_confirmed', 'completed']

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function getFinancingContext(
  deal: DealForContext,
  transaction: TransactionForContext | null,
  _program: unknown | null,
  bankOrg: BankForContext | null,
  supplierOrg: OrgForContext,
  bankBankAccount?: BankAccountForContext | null
): FinancingContext {
  const invoiceAmount = deal.total_value ?? deal.agreed_price ?? 0
  const currency = deal.agreed_currency ?? 'USD'
  const supplierName = supplierOrg.legal_name ?? supplierOrg.display_name ?? 'Supplier'
  const bankName = bankOrg?.display_name ?? bankOrg?.legal_name ?? 'Bank'
  const isActive = (deal.financing_payment_active === true || deal.status === 'financing_active') && transaction !== null
  const structure: DealFinancingStructure = isActive && transaction
    ? mapStructure(transaction.type)
    : null

  // No active financing
  if (!isActive || !transaction || !structure) {
    const canRequest = [
      'agreed', 'documents_pending', 'confirmed', 'in_preparation',
      'shipped', 'goods_received', 'delivery_confirmed', 'payment_due', 'payment_overdue',
    ].includes(deal.status)

    const supplierPayInstr = buildPaymentInstructions(deal, currency)

    return {
      structure: null,
      isActive: false,
      paymentRecipient: 'supplier',
      paymentRecipientName: supplierName,
      paymentInstructions: supplierPayInstr,
      paymentAmount: invoiceAmount,
      paymentCurrency: currency,
      paymentDueDate: deal.payment_due_date ?? null,
      repaymentRouting: null,
      isPOFinancingPreShipment: false,
      poFinancingConverted: false,
      ddDiscountRate: null,
      ddDiscountAmount: null,
      ddEarlyPaymentDate: null,
      ddFullAmount: null,
      noaRequired: false,
      noaAcknowledged: false,
      noaDocumentId: null,
      canRequestFinancing: canRequest,
      cannotRequestReason: canRequest ? null : 'Financing cannot be requested at this deal stage.',
      paymentStepLabel: `Pay ${supplierName}`,
      paymentWarningMessage: null,
      financingBadgeLabel: null,
      aiContextSummary: 'No financing active. Direct payment to supplier applies.',
    }
  }

  // Reverse Factoring
  if (structure === 'reverse_factoring') {
    const amount = invoiceAmount
    const dueDate = transaction.repayment_due_date ?? deal.payment_due_date ?? null
    const canRequest = ['goods_received', 'delivery_confirmed', 'payment_due', 'payment_overdue'].includes(deal.status)
    const bankPayInstr = buildBankPaymentInstructions(bankBankAccount, deal.payment_reference, currency)
    return {
      structure,
      isActive: true,
      paymentRecipient: 'bank',
      paymentRecipientName: bankName,
      paymentInstructions: bankPayInstr,
      paymentAmount: amount,
      paymentCurrency: currency,
      paymentDueDate: dueDate,
      repaymentRouting: 'buyer_to_bank',
      isPOFinancingPreShipment: false,
      poFinancingConverted: false,
      ddDiscountRate: null,
      ddDiscountAmount: null,
      ddEarlyPaymentDate: null,
      ddFullAmount: null,
      noaRequired: false,
      noaAcknowledged: false,
      noaDocumentId: null,
      canRequestFinancing: canRequest,
      cannotRequestReason: canRequest ? null : 'Reverse Factoring requires delivery confirmation before financing can be requested.',
      paymentStepLabel: `Repay ${bankName}`,
      paymentWarningMessage: `${supplierName} has received an advance from ${bankName}. Payment must be made to ${bankName}, not ${supplierName}. Your obligation is unchanged — same amount, same due date.`,
      financingBadgeLabel: 'RF',
      aiContextSummary: `Reverse Factoring active. Buyer repays ${bankName} ${fmt(amount, currency)} on ${fmtDate(dueDate)}. Supplier already received advance.`,
    }
  }

  // Invoice Factoring
  if (structure === 'invoice_factoring') {
    const amount = invoiceAmount
    const dueDate = transaction.repayment_due_date ?? deal.payment_due_date ?? null
    const noaAcknowledged = !!deal.noa_acknowledged_at
    const canRequest = ['shipped', 'goods_received', 'delivery_confirmed', 'payment_due', 'payment_overdue'].includes(deal.status)
    const bankPayInstr = buildBankPaymentInstructions(bankBankAccount, deal.payment_reference, currency)
    return {
      structure,
      isActive: true,
      paymentRecipient: 'bank',
      paymentRecipientName: bankName,
      paymentInstructions: bankPayInstr,
      paymentAmount: amount,
      paymentCurrency: currency,
      paymentDueDate: dueDate,
      repaymentRouting: 'buyer_to_bank',
      isPOFinancingPreShipment: false,
      poFinancingConverted: false,
      ddDiscountRate: null,
      ddDiscountAmount: null,
      ddEarlyPaymentDate: null,
      ddFullAmount: null,
      noaRequired: true,
      noaAcknowledged,
      noaDocumentId: deal.noa_document_id ?? null,
      canRequestFinancing: canRequest,
      cannotRequestReason: canRequest ? null : 'Invoice Factoring requires the deal to be at shipped status or later.',
      paymentStepLabel: `Repay ${bankName}`,
      paymentWarningMessage: `${supplierName} has sold this invoice to ${bankName}. Payment must be made to ${bankName}. Amount and due date are unchanged.`,
      financingBadgeLabel: 'IF',
      aiContextSummary: `Invoice Factoring active. Buyer repays ${bankName} ${fmt(amount, currency)} on ${fmtDate(dueDate)}. NOA ${noaAcknowledged ? 'acknowledged' : 'PENDING ACKNOWLEDGMENT'}.`,
    }
  }

  // PO Financing
  if (structure === 'po_financing') {
    const preShipment = !POST_SHIPMENT.includes(deal.status)
    const converted = POST_SHIPMENT.includes(deal.status)
    const amount = transaction.financing_amount_approved ?? invoiceAmount
    const dueDate = transaction.repayment_due_date ?? deal.payment_due_date ?? null
    const canRequest = ['confirmed', 'in_preparation'].includes(deal.status)
    const bankPayInstr = buildBankPaymentInstructions(bankBankAccount, deal.payment_reference, currency)
    return {
      structure,
      isActive: true,
      paymentRecipient: 'bank',
      paymentRecipientName: bankName,
      paymentInstructions: bankPayInstr,
      paymentAmount: amount,
      paymentCurrency: currency,
      paymentDueDate: dueDate,
      repaymentRouting: 'buyer_to_bank',
      isPOFinancingPreShipment: preShipment,
      poFinancingConverted: converted,
      ddDiscountRate: null,
      ddDiscountAmount: null,
      ddEarlyPaymentDate: null,
      ddFullAmount: null,
      noaRequired: false,
      noaAcknowledged: false,
      noaDocumentId: null,
      canRequestFinancing: canRequest,
      cannotRequestReason: canRequest ? null : 'PO Financing must be requested before shipment.',
      paymentStepLabel: `Repay ${bankName} — PO Financing`,
      paymentWarningMessage: `PO Financing was activated to fund production. Repayment is due to ${bankName} after delivery.`,
      financingBadgeLabel: 'PO',
      aiContextSummary: `PO Financing active. ${preShipment ? 'Pre-shipment — production funded.' : 'Converted post-delivery.'} Buyer repays ${bankName} ${fmt(amount, currency)} on ${fmtDate(dueDate)}.`,
    }
  }

  // Dynamic Discounting
  if (structure === 'dynamic_discounting') {
    const fullAmount = invoiceAmount
    const ddRate = transaction.discount_rate ?? null
    const earlyDate = transaction.early_payment_date ?? deal.payment_due_date ?? null
    const originalDue = deal.payment_due_date ?? null

    let ddDiscountAmount: number | null = null
    let paymentAmount = fullAmount

    if (ddRate && earlyDate && originalDue) {
      const daysEarly = Math.max(
        0,
        Math.ceil((new Date(originalDue).getTime() - new Date(earlyDate).getTime()) / (1000 * 60 * 60 * 24))
      )
      ddDiscountAmount = fullAmount * (ddRate / 100) * (daysEarly / 360)
      paymentAmount = fullAmount - ddDiscountAmount
    }

    return {
      structure,
      isActive: true,
      paymentRecipient: 'supplier',
      paymentRecipientName: supplierName,
      paymentInstructions: null,
      paymentAmount,
      paymentCurrency: currency,
      paymentDueDate: earlyDate,
      repaymentRouting: 'direct',
      isPOFinancingPreShipment: false,
      poFinancingConverted: false,
      ddDiscountRate: ddRate,
      ddDiscountAmount,
      ddEarlyPaymentDate: earlyDate,
      ddFullAmount: fullAmount,
      noaRequired: false,
      noaAcknowledged: false,
      noaDocumentId: null,
      canRequestFinancing: false,
      cannotRequestReason: 'Dynamic Discounting is active on this deal.',
      paymentStepLabel: `Early Payment to ${supplierName}`,
      paymentWarningMessage: null,
      financingBadgeLabel: 'DD',
      aiContextSummary: `Dynamic Discounting active. Buyer pays supplier ${fmt(paymentAmount, currency)} (discounted from ${fmt(fullAmount, currency)}) on ${fmtDate(earlyDate)}. Discount: ${ddDiscountAmount != null ? fmt(ddDiscountAmount, currency) : '—'} at ${ddRate ?? '—'}% annualized.`,
    }
  }

  // Fallback (shouldn't reach)
  return {
    structure: null,
    isActive: false,
    paymentRecipient: 'supplier',
    paymentRecipientName: supplierName,
    paymentInstructions: null,
    paymentAmount: invoiceAmount,
    paymentCurrency: currency,
    paymentDueDate: deal.payment_due_date ?? null,
    repaymentRouting: null,
    isPOFinancingPreShipment: false,
    poFinancingConverted: false,
    ddDiscountRate: null,
    ddDiscountAmount: null,
    ddEarlyPaymentDate: null,
    ddFullAmount: null,
    noaRequired: false,
    noaAcknowledged: false,
    noaDocumentId: null,
    canRequestFinancing: false,
    cannotRequestReason: null,
    paymentStepLabel: 'Payment',
    paymentWarningMessage: null,
    financingBadgeLabel: null,
    aiContextSummary: 'No financing active.',
  }
}
