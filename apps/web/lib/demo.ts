// The one account that gets the cinematic product-tour experience. Nothing else
// reads/branches on this in a way that changes real customers' behavior — every
// other account renders the portal exactly as it always has.
export const DEMO_EMAIL = 'demo@demo.com'

export function isDemoAccount(email: string | null | undefined): boolean {
  return email === DEMO_EMAIL
}
