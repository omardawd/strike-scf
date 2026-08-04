'use client'

import { createContext, useContext, useMemo, useRef } from 'react'

// Lets a real, live form (currently: the deal page's financing-request form)
// opt into demo-scripted auto-fill without DemoConductor ever dispatching
// synthetic DOM events against React-controlled inputs. The form registers
// its own setters/submit function; DemoConductor calls them directly. Any
// page outside demo mode never sees a provider, so `useDemoFormBridge()`
// returns null and registration is a no-op — zero behavior change for real
// customers.
export interface FinancingFormApi {
  setShowForm: (show: boolean) => void
  setType: (type: string) => void
  setAmount: (amount: string) => void
  setRateMax: (rate: string) => void
  submit: () => void
}

// Registered by app/(portal)/home/page.tsx so DemoAgentActivityFeed (Scene 7)
// can drive the exact same real /api/ai/chat send path a viewer typing into
// the chat box would use — same request shape, same conversation state, same
// rendering. `sendMessage` resolves once the assistant's reply has landed
// (success or handled failure), so the caller can safely poll for follow-on
// server state (e.g. a new agent_tasks row) right after awaiting it.
export interface ChatApi {
  /** `cacheKey`, when set, is forwarded to /api/ai/chat as `demoCacheKey` — the
   *  server replays a cached response for the demo org instead of calling
   *  Claude again once one exists, so repeated tour replays stop spending
   *  real API credits. See lib/ai/demo-ai-cache.ts. */
  sendMessage: (text: string, cacheKey?: string) => Promise<void>
}

interface DemoFormBridgeValue {
  registerFinancingForm: (api: FinancingFormApi | null) => void
  getFinancingForm: () => FinancingFormApi | null
  registerChatApi: (api: ChatApi | null) => void
  getChatApi: () => ChatApi | null
}

const DemoFormBridgeContext = createContext<DemoFormBridgeValue | null>(null)

export function DemoFormBridgeProvider({ children }: { children: React.ReactNode }) {
  const apiRef = useRef<FinancingFormApi | null>(null)
  const chatApiRef = useRef<ChatApi | null>(null)

  const value = useMemo<DemoFormBridgeValue>(() => ({
    registerFinancingForm: (api) => { apiRef.current = api },
    getFinancingForm: () => apiRef.current,
    registerChatApi: (api) => { chatApiRef.current = api },
    getChatApi: () => chatApiRef.current,
  }), [])

  return (
    <DemoFormBridgeContext.Provider value={value}>
      {children}
    </DemoFormBridgeContext.Provider>
  )
}

export function useDemoFormBridge(): DemoFormBridgeValue | null {
  return useContext(DemoFormBridgeContext)
}
