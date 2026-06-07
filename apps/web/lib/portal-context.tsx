'use client'
import { createContext, useContext } from 'react'

// Portal is derived at the (portal) layout from the user's role + org type:
//   bank_admin / bank_credit_officer → 'bank'
//   org_admin / org_member           → org.type ('anchor' | 'supplier')  ← sub-portal
//   strike_admin                     → 'admin'
// 'anchor' and 'supplier' are kept as first-class values so the existing
// design-system accents ([data-portal]) and dashboards keep working.
export type PortalType = 'bank' | 'anchor' | 'supplier' | 'admin'

export const PortalContext = createContext<PortalType>('bank')

export function usePortal() {
  return useContext(PortalContext)
}

export function PortalProvider({ portal, children }: { portal: PortalType; children: React.ReactNode }) {
  return <PortalContext.Provider value={portal}>{children}</PortalContext.Provider>
}
