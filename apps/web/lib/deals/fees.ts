// Strike platform fees — procurement (deal) and financing.
// Single source of truth for fee rates and the shipping-cost incoterm rule.
// Both fees are computed on the fly from already-stored values (never persisted)
// so they can never drift from total_value / financing_amount_approved.

// 0.3% of deal value (excludes shipping), procurement deals only — charged to
// both the buyer (anchor) and the supplier separately.
export const STRIKE_PROCUREMENT_FEE_RATE = 0.003

// 0.15% of the financed amount, charged to both the bank and the party
// requesting financing separately.
export const STRIKE_FINANCING_FEE_RATE = 0.0015

// Incoterms where the seller arranges/pays main carriage — supplier must
// specify a shipping cost. The remaining incoterms (EXW, FCA, FAS, FOB) put
// main carriage on the buyer, who handles shipping internally.
export const SHIPPING_REQUIRED_INCOTERMS = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const

export function isShippingCostRequired(incoterms: string | null | undefined): boolean {
  return !!incoterms && (SHIPPING_REQUIRED_INCOTERMS as readonly string[]).includes(incoterms)
}

export interface ProcurementFees {
  buyerFee: number | null
  supplierFee: number | null
}

// dealValue excludes shipping (goods value only).
export function calcProcurementFees(dealValue: number | null | undefined): ProcurementFees {
  if (dealValue == null || !Number.isFinite(dealValue)) return { buyerFee: null, supplierFee: null }
  const fee = dealValue * STRIKE_PROCUREMENT_FEE_RATE
  return { buyerFee: fee, supplierFee: fee }
}

// What the buyer must actually remit: goods + shipping + their own Strike fee.
export function calcBuyerTotalDue(
  dealValue: number | null | undefined,
  shippingCost: number | null | undefined,
  buyerFee: number | null | undefined
): number | null {
  if (dealValue == null || !Number.isFinite(dealValue)) return null
  return dealValue + (shippingCost ?? 0) + (buyerFee ?? 0)
}

// What the supplier actually nets: goods + shipping reimbursement - their own Strike fee.
export function calcSupplierNetReceivable(
  dealValue: number | null | undefined,
  shippingCost: number | null | undefined,
  supplierFee: number | null | undefined
): number | null {
  if (dealValue == null || !Number.isFinite(dealValue)) return null
  return dealValue + (shippingCost ?? 0) - (supplierFee ?? 0)
}

export interface FinancingFees {
  requesterFee: number | null
  bankFee: number | null
}

export function calcFinancingFees(financedAmount: number | null | undefined): FinancingFees {
  if (financedAmount == null || !Number.isFinite(financedAmount)) return { requesterFee: null, bankFee: null }
  const fee = financedAmount * STRIKE_FINANCING_FEE_RATE
  return { requesterFee: fee, bankFee: fee }
}

// Net amount the bank actually wires to the requester after its 0.15% cut.
export function calcNetDisbursement(
  financedAmount: number | null | undefined,
  requesterFee: number | null | undefined
): number | null {
  if (financedAmount == null || !Number.isFinite(financedAmount)) return null
  return financedAmount - (requesterFee ?? 0)
}
