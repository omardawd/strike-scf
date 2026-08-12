import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import type { UserRole } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface SessionContext {
  userId: string
  role: UserRole
  orgId: string | null
  bankId: string | null
}

export const BANK_ROLES: UserRole[] = ['bank_admin', 'bank_credit_officer']
export const ORG_ROLES: UserRole[] = ['org_admin', 'org_member']

/**
 * The one place the getUser() -> users-table lookup pattern lives.
 * Returns null for: no Supabase session, no matching `users` row, OR a
 * user row with `is_active = false` — a deactivated user must be treated
 * as unauthenticated everywhere, which today (before this helper) nothing
 * in the app actually enforced (see docs/enterprise-readiness/
 * ASSESSMENT.md's inactive-user finding). Routes should not query
 * `is_active` for their own gating logic; use this helper instead so the
 * check can never be forgotten on a new route.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id, is_active')
    .eq('id', user.id)
    .single()

  if (!me || !me.is_active) return null

  return {
    userId: me.id,
    role: me.role as UserRole,
    orgId: me.org_id,
    bankId: me.bank_id,
  }
}

export function isBankRole(role: UserRole): boolean {
  return BANK_ROLES.includes(role)
}

export function isOrgRole(role: UserRole): boolean {
  return ORG_ROLES.includes(role)
}

export function isStrikeAdmin(role: UserRole): boolean {
  return role === 'strike_admin'
}
