'use client'
import { createContext, useContext } from 'react'

// Portal is derived at the (portal) layout from the user's role:
//   bank_admin / bank_credit_officer → 'bank'
//   org_admin / org_member           → 'org'   (any org — no more anchor/supplier sub-portal)
//   strike_admin                     → 'admin'
export type PortalType = 'bank' | 'org' | 'admin'

export const PortalContext = createContext<PortalType>('bank')

export function usePortal() {
  return useContext(PortalContext)
}

export function PortalProvider({ portal, children }: { portal: PortalType; children: React.ReactNode }) {
  return <PortalContext.Provider value={portal}>{children}</PortalContext.Provider>
}
