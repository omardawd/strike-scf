'use client'

import { createContext, useContext } from 'react'

export const WIZARD_STEPS = ['Business', 'Contact', 'Financial', 'Documents', 'Review'] as const
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
