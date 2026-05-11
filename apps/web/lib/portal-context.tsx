'use client'
import { createContext, useContext } from 'react'

export type PortalType = 'bank' | 'anchor' | 'supplier'

export const PortalContext = createContext<PortalType>('bank')

export function usePortal() {
  return useContext(PortalContext)
}

export function PortalProvider({ portal, children }: { portal: PortalType; children: React.ReactNode }) {
  return <PortalContext.Provider value={portal}>{children}</PortalContext.Provider>
}
