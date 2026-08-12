import { NextResponse } from 'next/server'

// The one account that gets the cinematic product-tour experience. Nothing else
// reads/branches on this in a way that changes real customers' behavior — every
// other account renders the portal exactly as it always has.
export const DEMO_EMAIL = 'demo@demo.com'

export function isDemoAccount(email: string | null | undefined): boolean {
  return email === DEMO_EMAIL
}

// Server-only kill switch for the entire /api/demo/* surface, independent of
// the isDemoAccount(email) check every route also performs. Unset/false by
// default: production deployments must opt in explicitly. This is deliberately
// NOT a NEXT_PUBLIC_ var — it must never be readable from the client bundle.
export function demoRoutesEnabled(): boolean {
  return process.env.DEMO_ROUTES_ENABLED === 'true'
}

// Call as the very first line of every /api/demo/* route handler. Returns a
// 404 (not 403) when demo routes are disabled, so the surface looks like it
// doesn't exist rather than revealing a gated feature.
export function assertDemoRoutesEnabled(): NextResponse | null {
  if (!demoRoutesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}
