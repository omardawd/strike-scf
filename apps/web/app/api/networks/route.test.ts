// Regression tests for PR 1b: creating a network had NO admission check.
import { describe, expect, it, beforeEach, vi } from 'vitest'

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

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/networks', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/networks — admission enforcement (PR 1b)', () => {
  const nonAdmittedCases = [
    { label: 'submitted', status: 'kyb_submitted', kyb_status: 'submitted' },
    { label: 'rejected', status: 'rejected', kyb_status: 'rejected' },
    { label: 'suspended', status: 'suspended', kyb_status: 'approved' },
  ]

  for (const { label, status, kyb_status } of nonAdmittedCases) {
    it(`denies a ${label} organization`, async () => {
      const { POST } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
      state.tables.organizations = { data: { status, kyb_status } }

      const res = await POST(postRequest({ name: 'Test Network' }))
      expect(res.status).toBe(403)
    })
  }

  it('allows an approved, active organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.anchor_networks = { data: { id: 'network-1', name: 'Test Network' } }

    const res = await POST(postRequest({ name: 'Test Network' }))
    expect(res.status).toBe(201)
  })
})
