// Regression tests for PR 1 (org-admission enforcement): creating a room
// previously required only network_visible + kyb_status!=='not_started'
// (Ghost Mode) — a submitted/under_review/rejected/suspended org could open one.
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
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
    },
  }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/rooms — admission enforcement (PR 1)', () => {
  it('denies a submitted (not yet approved) organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { id: 'org-1', status: 'kyb_submitted', kyb_status: 'submitted', network_visible: true } }

    const res = await POST(postRequest({ name: 'Test room' }))
    expect(res.status).toBe(403)
  })

  it('denies a rejected organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { id: 'org-1', status: 'rejected', kyb_status: 'rejected', network_visible: true } }

    const res = await POST(postRequest({ name: 'Test room' }))
    expect(res.status).toBe(403)
  })

  it('allows an approved, active organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { id: 'org-1', status: 'active', kyb_status: 'approved', network_visible: true } }
    state.tables.rooms = { data: { id: 'room-1', name: 'Test room' } }
    state.tables.room_participants = { data: null }

    const res = await POST(postRequest({ name: 'Test room' }))
    expect(res.status).toBe(200)
  })
})
