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

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}))

vi.mock('@/lib/ai/rfx/core', () => ({
  generateRfxDraft: async () => '## Scope\nDraft content',
  scoreRfxContent: async () => ({
    overall_score: 72,
    section_scores: { completeness: 80, competitiveness: 70, pricing: 65, risk: 75 },
    highlights: [],
    ai_scored: true,
  }),
  benchmarkRfxPricing: async () => ({ price_assessment: null, highlights: [] }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/ai/rfx/generate', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/ai/rfx/generate', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')
    const res = await POST(postRequest({ entity_type: 'listing' }))
    expect(res.status).toBe(401)
  })

  it('rejects an invalid entity_type', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    const res = await POST(postRequest({ entity_type: 'invoice' }))
    expect(res.status).toBe(400)
  })

  it('rejects drafting on a listing owned by another org', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.marketplace_listings = { data: { org_id: 'org-2' } }
    const res = await POST(postRequest({ entity_type: 'listing', entity_id: 'listing-1', context: {} }))
    expect(res.status).toBe(403)
  })

  it('rejects drafting a contract on a deal the caller is not party to', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.deals = { data: { buyer_org_id: 'org-2', supplier_org_id: 'org-3' } }
    const res = await POST(postRequest({ entity_type: 'deal', entity_id: 'deal-1', context: {} }))
    expect(res.status).toBe(403)
  })

  it('generates and scores a draft, returning the combined result', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1' } }
    const res = await POST(postRequest({ entity_type: 'listing', context: { title: 'Steel plates RFQ' } }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.draft_id).toBe('draft-1')
    expect(json.overall_score).toBe(72)
    expect(json.content).toContain('Draft content')
  })
})
