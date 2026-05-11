export const TRANSACTION_REFERRER_KEY = 'transaction_referrer'

/** Store current path before opening a transaction so the detail page back button can return here. */
export function stashTransactionReferrer(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      TRANSACTION_REFERRER_KEY,
      window.location.pathname + window.location.search,
    )
  } catch {
    // ignore quota / private mode
  }
}

export function pushTransactionDetail(
  router: { push: (href: string) => void },
  transactionId: string,
): void {
  stashTransactionReferrer()
  router.push(`/transactions/${transactionId}`)
}

export const TRANSACTION_NEW_REFERRER_KEY = 'transaction_new_referrer'

/** Store current path before opening New Transaction so back on step 0 can return here. */
export function stashTransactionNewReferrer(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      TRANSACTION_NEW_REFERRER_KEY,
      window.location.pathname + window.location.search,
    )
  } catch {
    // ignore
  }
}

export function pushTransactionNew(router: { push: (href: string) => void }): void {
  stashTransactionNewReferrer()
  router.push('/transactions/new')
}
