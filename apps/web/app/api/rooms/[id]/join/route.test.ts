// Regression test for PR 1b: joining a public room had NO admission check.
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

function postRequest(): Request {
  return new Request('https://example.com/api/rooms/room-1/join', { method: 'POST' })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/rooms/[id]/join — admission enforcement (PR 1b)', () => {
  it('denies a submitted (not yet approved) org from joining a public room', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await POST(new Request('https://example.com'), { params: Promise.resolve({ id: 'room-1' }) })
    expect(res.status).toBe(403)
  })

  it('does not deny an approved org at the admission gate', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.rooms = { data: { id: 'room-1', room_type: 'public', status: 'active' } }
    state.tables.room_participants = { data: null }

    const res = await POST(postRequest(), { params: Promise.resolve({ id: 'room-1' }) })
    expect(res.status).toBe(200)
  })

  it('does not gate a bank user (no org_id) at all', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'bank-user-1' }
    state.tables.users = { data: { id: 'bank-user-1', role: 'bank_admin', org_id: null, bank_id: 'bank-1' } }
    // No 'organizations' stub — if the gate incorrectly applied to bank
    // users it would 403 by default (isOrgAdmitted(null) === false).
    state.tables.rooms = { data: { id: 'room-1', room_type: 'public', status: 'active' } }
    state.tables.room_participants = { data: null }

    const res = await POST(postRequest(), { params: Promise.resolve({ id: 'room-1' }) })
    expect(res.status).toBe(200)
  })
})
