// Regression test for PR 1b: importing a deal from ERP had NO admission check.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'order', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => resolve(response)
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.currentUser } }) },
  }),
}))

vi.mock('@/lib/ai/tools/handlers/get-importable-erp-deals', () => ({
  getImportableErpDeals: async () => ({ deals: [] }),
}))

function postRequest(body: unknown): NextRequest {
  return new Request('https://example.com/api/deals/import-erp', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/deals/import-erp — admission enforcement (PR 1b)', () => {
  it('denies a submitted (not yet approved) organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'org-1', role: 'org_admin' } }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await POST(postRequest({ erp_reference: 'INV-1' }))
    expect(res.status).toBe(403)
  })

  it('does not deny an approved organization at the admission gate', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'org-1', role: 'org_admin' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await POST(postRequest({ erp_reference: 'INV-1' }))
    // Falls through to "Invoice not found" (404), never the admission 403.
    expect(res.status).not.toBe(403)
  })
})
