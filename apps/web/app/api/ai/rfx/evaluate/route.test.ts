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

vi.mock('@/lib/ai', () => ({
  callClaude: async () => ({ text: 'transcribed text', usage: {}, model: 'claude-haiku-4-5-20251001' }),
  extractJson: () => null,
}))

vi.mock('@/lib/ai/rfx/core', () => ({
  scoreRfxContent: async () => ({
    overall_score: 55,
    section_scores: { completeness: 50, competitiveness: 50, pricing: 50, risk: 60 },
    highlights: [],
    ai_scored: true,
  }),
  benchmarkRfxPricing: async () => ({ price_assessment: null, highlights: [] }),
  fileToContentBlockOrText: async () => ({ text: 'uploaded doc text' }),
}))

function jsonRequest(body: unknown): Request {
  return new Request('https://example.com/api/ai/rfx/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/ai/rfx/evaluate — re-score path', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')
    const res = await POST(jsonRequest({ draft_id: 'draft-1', content: 'x' }))
    expect(res.status).toBe(401)
  })

  it('404s on a missing draft', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: null }
    const res = await POST(jsonRequest({ draft_id: 'draft-1', content: 'x' }))
    expect(res.status).toBe(404)
  })

  it('rejects re-scoring a draft owned by another org', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-2', content_version: 1 } }
    const res = await POST(jsonRequest({ draft_id: 'draft-1', content: 'x' }))
    expect(res.status).toBe(403)
  })

  it('re-scores edited content and returns the updated result', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-1', content_version: 1 } }
    const res = await POST(jsonRequest({ draft_id: 'draft-1', content: 'edited content' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.overall_score).toBe(55)
  })
})

describe('POST /api/ai/rfx/evaluate — upload path', () => {
  function uploadRequest(file: File, entityType = 'listing'): Request {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('entity_type', entityType)
    return new Request('https://example.com/api/ai/rfx/evaluate', { method: 'POST', body: fd })
  }

  it('rejects an unsupported entity_type', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    const file = new File(['hello'], 'rfx.txt', { type: 'text/plain' })
    const res = await POST(uploadRequest(file, 'invoice'))
    expect(res.status).toBe(400)
  })

  it('evaluates an uploaded document and creates a draft', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.marketplace_listings = { data: { org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-2' } }
    const file = new File(['hello world'], 'rfx.txt', { type: 'text/plain' })
    const res = await POST(uploadRequest(file))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.draft_id).toBe('draft-2')
    expect(json.overall_score).toBe(55)
  })
})
