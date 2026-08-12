/**
 * Marketplace admission — distinct from Ghost Mode.
 *
 * Ghost Mode (`org.network_visible && org.kyb_status !== 'not_started'`,
 * documented in apps/web/CLAUDE.md) intentionally unlocks browsing the
 * instant an org SUBMITS KYB, before a human approves it. That check must
 * stay as-is for browsing/read surfaces it already governs.
 *
 * Admission is stricter and gates marketplace MUTATIONS (publish a listing,
 * submit/accept an offer, open a room) and cross-org DISCOVERY: an org must
 * be fully approved, not merely submitted. `status` and `kyb_status` are set
 * together on approval/rejection (see app/api/kyb/[org_id]/decision/route.ts)
 * but nothing enforces that pairing at the DB level, so both are checked.
 */
export interface AdmissionCheckableOrg {
  status: string | null
  kyb_status: string | null
}

export function isOrgAdmitted(org: AdmissionCheckableOrg | null | undefined): boolean {
  if (!org) return false
  return org.status === 'active' && org.kyb_status === 'approved'
}
