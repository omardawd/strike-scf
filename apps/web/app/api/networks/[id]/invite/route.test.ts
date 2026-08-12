// Regression test for PR 1b: inviting a network member had NO admission check.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'order', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete', 'single', 'maybeSingle', 'upsert']
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

vi.mock('@/lib/email', () => ({
  sendEmail: async () => {},
  networkInviteExistingOrgHtml: () => '',
  networkInviteNewEmailHtml: () => '',
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/networks/network-1/invite', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/networks/[id]/invite — admission enforcement (PR 1b)', () => {
  it('denies a submitted (not yet approved) inviting organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.anchor_networks = { data: { id: 'network-1', anchor_org_id: 'org-1', name: 'Net' } }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await POST(postRequest({ type: 'existing_org', org_id: 'org-2' }), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(403)
  })

  it('does not deny an approved inviting organization at the admission gate', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.anchor_networks = { data: { id: 'network-1', anchor_org_id: 'org-1', name: 'Net' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await POST(postRequest({ type: 'existing_org' }), { params: Promise.resolve({ id: 'network-1' }) })
    // Falls through to a body-validation 400 ("org_id required"), never the admission 403.
    expect(res.status).not.toBe(403)
  })
})
