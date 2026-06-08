'use client'
import { createContext, useContext } from 'react'

export interface UserOrg {
  type: 'anchor' | 'supplier'
  status: string
  kyb_status: string
  network_visible: boolean
  passport_score: number | null
}

export interface UserProfile {
  id: string
  full_name: string
  email: string
  role: string
  org_id: string | null
  bank_id: string | null
  // Present for org_admin / org_member users; null for bank and strike_admin users.
  org: UserOrg | null
}

const UserContext = createContext<UserProfile | null>(null)

export function useUser() {
  return useContext(UserContext)
}

export function UserProvider({ user, children }: { user: UserProfile; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}
