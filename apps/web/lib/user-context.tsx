'use client'
import { createContext, useContext } from 'react'

export interface UserProfile {
  id: string
  full_name: string
  email: string
  role: string
  org_id: string | null
  bank_id: string | null
}

const UserContext = createContext<UserProfile | null>(null)

export function useUser() {
  return useContext(UserContext)
}

export function UserProvider({ user, children }: { user: UserProfile; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}
