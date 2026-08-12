import { describe, expect, it } from 'vitest'
import { assertOrgCanExpandDeal } from './admission-policy'

function mockAdminClient(orgData: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['from', 'select', 'eq', 'single']
  for (const m of methods) chain[m] = () => chain
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: orgData, error: null })
  return chain
}

describe('assertOrgCanExpandDeal() — closure item 3 policy primitive', () => {
  it('allows an approved, active org', async () => {
    const client = mockAdminClient({ status: 'active', kyb_status: 'approved' })
    const result = await assertOrgCanExpandDeal(client, 'org-1', 'do the thing')
    expect(result).toBeNull()
  })

  it('blocks a submitted org', async () => {
    const client = mockAdminClient({ status: 'kyb_submitted', kyb_status: 'submitted' })
    const result = await assertOrgCanExpandDeal(client, 'org-1', 'do the thing')
    expect(result).toMatch(/KYB-approved/i)
    expect(result).toMatch(/do the thing/)
  })

  it('blocks a suspended org', async () => {
    const client = mockAdminClient({ status: 'suspended', kyb_status: 'approved' })
    const result = await assertOrgCanExpandDeal(client, 'org-1', 'do the thing')
    expect(result).toMatch(/KYB-approved/i)
  })

  it('is a no-op (null) when orgId is null — bank users are never subject to this', async () => {
    const client = mockAdminClient(null)
    const result = await assertOrgCanExpandDeal(client, null, 'do the thing')
    expect(result).toBeNull()
  })
})
