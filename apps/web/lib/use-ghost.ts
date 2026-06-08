'use client'

import { useUser } from '@/lib/user-context'
import type { UserOrg } from '@/lib/user-context'

// ─────────────────────────────────────────────────────────────────────────────
// Ghost mode (Tier 0) — the single source of truth for the whole app.
//
// An org is a GHOST when it has NOT activated its Passport: it has not submitted
// KYB AND it is not network-visible. Banks and Strike admins have no org, so they
// are NEVER ghost — this is what keeps the central feature gate a strict no-op
// for every non-org user (Track C's bank pages stay fully open).
//
// AUTH-CRITICAL: the platform unlocks on SUBMISSION (TD.4), so `network_visible`
// — which is only ever set true on Passport submission — is the load-bearing
// signal. We also treat kyb_status 'not_started' / 'in_progress' as ghost because
// the onboarding wizard flips kyb_status to 'in_progress' on the first save, well
// before submission; a half-filled wizard is still Tier 0 and must stay locked.
// ─────────────────────────────────────────────────────────────────────────────

const PRE_SUBMISSION_KYB = new Set(['not_started', 'in_progress'])

export function isGhostOrg(org: UserOrg | null | undefined): boolean {
  if (!org) return false // no org → bank / strike_admin → never ghost
  if (org.network_visible) return false // visible to the network → activated
  return PRE_SUBMISSION_KYB.has(org.kyb_status)
}

export interface GhostState {
  /** True only for Tier-0 org users. Always false for bank/admin/non-ghost orgs. */
  isGhost: boolean
  /** The caller's org, or null for bank/admin users. */
  org: UserOrg | null
}

/**
 * Hook form of the ghost check. Reads the org off UserContext (hydrated by the
 * portal layout), so it is correct on first render with no extra fetch.
 */
export function useGhost(): GhostState {
  const user = useUser()
  const org = user?.org ?? null
  return { isGhost: isGhostOrg(org), org }
}
