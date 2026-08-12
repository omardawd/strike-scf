import { createHash, randomBytes } from 'node:crypto'

// erp_connections.dispatch_token_hash stores sha256(rawToken), never the
// raw value. The raw value exists only transiently in memory when
// generated, and once in the API response that returns it — see
// app/api/erp/connect/route.ts. See ASSESSMENT.md P0-4.

export interface GeneratedDispatchToken {
  token: string
  hash: string
  prefix: string
}

export function generateDispatchToken(): GeneratedDispatchToken {
  const token = randomBytes(32).toString('hex')
  return { token, hash: hashDispatchToken(token), prefix: token.slice(0, 8) }
}

export function hashDispatchToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface DispatchTokenRow {
  status: string
  dispatch_token_revoked_at: string | null
  dispatch_token_expires_at: string | null
  dispatch_token_scopes: string[] | null
}

export function isDispatchTokenValid(row: DispatchTokenRow): boolean {
  if (row.status !== 'active') return false
  if (row.dispatch_token_revoked_at) return false
  if (row.dispatch_token_expires_at && new Date(row.dispatch_token_expires_at) <= new Date()) return false
  return true
}

/** '*' grants every scope; otherwise the requested scope must be listed explicitly. */
export function dispatchTokenHasScope(row: DispatchTokenRow, scope: string): boolean {
  const scopes = row.dispatch_token_scopes ?? ['*']
  return scopes.includes('*') || scopes.includes(scope)
}
