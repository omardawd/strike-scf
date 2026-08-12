import { isOrgAdmitted } from '@/lib/auth/admission'

/**
 * Admission policy for actions on an EXISTING deal (closure item 3).
 *
 * A non-admitted org (submitted/under_review/more_info_requested/rejected/
 * suspended) already has a deal — it existed before they lost/never reached
 * admission. Cutting off every action on it would strand a real commercial
 * obligation (unshipped goods, unpaid invoices, an open dispute). The policy
 * is deliberately narrow and split by INTENT, not by route:
 *
 *   ALLOWED  — necessary fulfillment (ship, confirm delivery/receipt, submit
 *              payment info), repayment (confirm payment sent/received),
 *              dispute (raise/respond), cancellation/withdrawal, and
 *              compliance steps required to complete the existing deal
 *              (contract signing, uploading required documents). These are
 *              exactly the canonical status transitions in
 *              lib/deals/transitions.ts's PERMITTED_TRANSITIONS — none of
 *              them create new commercial terms, they only carry an already-
 *              agreed deal to its conclusion. transition/route.ts is
 *              therefore NOT admission-gated at all — gating it would be
 *              "blindly gate every deal transition," which is explicitly
 *              what this policy avoids.
 *
 *   BLOCKED  — proposing or agreeing to something OPTIONAL that changes or
 *              expands the deal: proposing an amendment, presenting or
 *              ACCEPTING a Dynamic Discounting early-payment offer, and
 *              proposing or ACCEPTING an ad-hoc workflow step. Declining any
 *              of these (rejecting an amendment, declining a DD offer,
 *              declining a workflow step) stays allowed — declining reduces
 *              exposure, same principle as offer withdraw/reject.
 *              New financing requests are already blocked platform-wide
 *              (PR 1b) — not repeated here.
 */
export async function assertOrgCanExpandDeal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  orgId: string | null,
  actionLabel: string
): Promise<string | null> {
  if (!orgId) return null
  const { data: org } = await adminClient
    .from('organizations')
    .select('status, kyb_status')
    .eq('id', orgId)
    .single()
  if (!isOrgAdmitted(org)) {
    return `Your organization must be KYB-approved to ${actionLabel}.`
  }
  return null
}
