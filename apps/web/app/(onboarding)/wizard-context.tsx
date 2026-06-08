'use client'

import { createContext, useContext } from 'react'

// TD.3 — Passport activation wizard, 7 steps.
export const WIZARD_STEPS = [
  'Identity & Legal',
  'Address & Contact',
  'Ownership & Compliance',
  'Financial & Trade',
  'Systems & Intent',
  'Documents',
  'Review & Submit',
] as const
export const TOTAL_STEPS = WIZARD_STEPS.length

export interface WizardContextValue {
  step: number
  setStep: (n: number) => void
}

export const WizardContext = createContext<WizardContextValue | null>(null)

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used inside the onboarding layout')
  return ctx
}
