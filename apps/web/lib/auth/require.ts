import { NextResponse } from 'next/server'
import type { UserRole } from '@strike-scf/types'
import { getSessionContext, type SessionContext } from './session'

export type AuthResult =
  | { ok: true; context: SessionContext }
  | { ok: false; response: NextResponse }

/**
 * Resolves the caller's session, returning a 401 response when there isn't
 * one (including a deactivated user — see getSessionContext's doc comment).
 * Use at the top of a route handler:
 *
 *   const auth = await requireSession()
 *   if (!auth.ok) return auth.response
 *   const { userId, role, orgId, bankId } = auth.context
 */
export async function requireSession(): Promise<AuthResult> {
  const context = await getSessionContext()
  if (!context) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, context }
}

/**
 * Resolves the session AND checks the role is in the allowed set, in one
 * call. Returns 401 for no session, 403 for a wrong-role session.
 *
 *   const auth = await requireRole(['bank_admin', 'bank_credit_officer'])
 *   if (!auth.ok) return auth.response
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<AuthResult> {
  const auth = await requireSession()
  if (!auth.ok) return auth

  if (!allowedRoles.includes(auth.context.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

/** Standard 403, for resource-ownership checks that happen after requireSession(). */
export function forbidden(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 })
}

/** Standard 404 — prefer over forbidden() when existence itself shouldn't be disclosed (see AUTHORIZATION_MATRIX.md's network-visibility pattern). */
export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}
