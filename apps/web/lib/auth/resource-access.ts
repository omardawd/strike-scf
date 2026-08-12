import { createClient as createAdmin } from '@supabase/supabase-js'
import type { SessionContext } from './session'
import { isStrikeAdmin } from './session'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Resource-level authorization helpers. Each takes the caller's
 * SessionContext plus enough of the target resource to decide, and returns
 * a plain boolean — never throws, never itself queries beyond what's
 * passed in (the route is still responsible for fetching the resource;
 * these just centralize the *comparison* logic that was previously
 * hand-rolled per route, including the organizations.bank_id/
 * primary_bank_id bug fixed in this engagement — see ASSESSMENT.md P0-6).
 *
 * Migrated so far: app/api/risk/score, app/api/kyb/[org_id]/decision.
 * NOT yet migrated: the remaining ~150 routes doing this inline — see
 * docs/enterprise-readiness/ROADMAP.md 1.D for the follow-up inventory.
 * This is intentional: the engagement rules explicitly forbid a mass
 * rewrite of all routes in one change.
 */

/** strike_admin always passes; otherwise the org must be the caller's own. */
export function canAccessOwnOrganization(context: SessionContext, targetOrgId: string): boolean {
  if (isStrikeAdmin(context.role)) return true
  return context.orgId === targetOrgId
}

/**
 * strike_admin always passes; a bank-role caller must belong to the same
 * bank the org is serviced by (organizations.primary_bank_id — NOT
 * organizations.bank_id, which does not exist on the live schema).
 */
export function canBankAccessOrganization(
  context: SessionContext,
  orgPrimaryBankId: string | null
): boolean {
  if (isStrikeAdmin(context.role)) return true
  if (!context.bankId || !orgPrimaryBankId) return false
  return context.bankId === orgPrimaryBankId
}

/** strike_admin always passes; otherwise the bank must be the caller's own. */
export function canAccessOwnBank(context: SessionContext, targetBankId: string): boolean {
  if (isStrikeAdmin(context.role)) return true
  return context.bankId === targetBankId
}

/** For a deal: strike_admin, or either named party org. */
export function canAccessDealParty(
  context: SessionContext,
  deal: { buyer_org_id: string; supplier_org_id: string }
): boolean {
  if (isStrikeAdmin(context.role)) return true
  if (!context.orgId) return false
  return context.orgId === deal.buyer_org_id || context.orgId === deal.supplier_org_id
}

/**
 * Fetches an organization's `primary_bank_id` and evaluates
 * canBankAccessOrganization in one call, for the common case where the
 * route hasn't already fetched the org row for other reasons.
 */
export async function bankCanAccessOrgById(context: SessionContext, orgId: string): Promise<boolean> {
  if (isStrikeAdmin(context.role)) return true
  const { data: org } = await adminClient
    .from('organizations')
    .select('primary_bank_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return false
  return canBankAccessOrganization(context, org.primary_bank_id)
}
