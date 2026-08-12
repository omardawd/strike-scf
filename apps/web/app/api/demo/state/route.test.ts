// Regression test for the Phase 0.4 fix (ASSESSMENT.md P0-3): every
// /api/demo/* route must 404 when DEMO_ROUTES_ENABLED is unset, before any
// auth/account check runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'demo-user', email: 'demo@demo.com' } } }) },
  }),
}))

describe('GET /api/demo/state — production guard (P0-3 regression)', () => {
  const original = process.env.DEMO_ROUTES_ENABLED

  beforeEach(() => {
    delete process.env.DEMO_ROUTES_ENABLED
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_ROUTES_ENABLED
    else process.env.DEMO_ROUTES_ENABLED = original
  })

  it('returns 404 when DEMO_ROUTES_ENABLED is unset, even for the real demo account', async () => {
    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('proceeds past the guard when DEMO_ROUTES_ENABLED=true', async () => {
    process.env.DEMO_ROUTES_ENABLED = 'true'
    const { GET } = await import('./route')
    const res = await GET()
    // Guard no longer 404s; whatever status follows is not 404.
    expect(res.status).not.toBe(404)
  })
})
