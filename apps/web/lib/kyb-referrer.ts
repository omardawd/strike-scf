export const KYB_REFERRER_KEY = 'kyb_referrer'

/** Store current path before opening a KYB org detail so the back button can return here. */
export function stashKybReferrer(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      KYB_REFERRER_KEY,
      window.location.pathname + window.location.search,
    )
  } catch {
    // ignore quota / private mode
  }
}

export function pushKybDetail(router: { push: (href: string) => void }, orgId: string): void {
  stashKybReferrer()
  router.push(`/kyb/${orgId}`)
}
