// Regression test for PR 1b: posting a room message had NO admission check
// beyond being a participant — a non-admitted org already in a room (e.g.
// suspended mid-negotiation) could keep posting.
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

vi.mock('@/lib/ai', () => ({
  callClaude: async () => ({ text: 'APPROVE', usage: { input_tokens: 1, output_tokens: 1 } }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/rooms/room-1/messages', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/rooms/[id]/messages — admission enforcement (PR 1b)', () => {
  it('denies a submitted (not yet approved) participant from posting', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.room_participants = { data: { id: 'participant-1' } }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await POST(postRequest({ content: 'hello' }), { params: Promise.resolve({ id: 'room-1' }) })
    expect(res.status).toBe(403)
  })

  it('does not deny an approved participant at the admission gate', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.room_participants = { data: { id: 'participant-1' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.rooms = { data: { id: 'room-1', room_type: 'private', status: 'active' } }
    state.tables.room_messages = { data: { id: 'msg-1', content: 'hello', status: 'visible' } }

    const res = await POST(postRequest({ content: 'hello' }), { params: Promise.resolve({ id: 'room-1' }) })
    expect(res.status).toBe(201)
  })
})
