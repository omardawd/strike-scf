// Regression tests for PR 3: an award_recommendation task must become
// unapprovable if the underlying offer changed (a new counter round) or is
// no longer actionable (withdrawn/rejected/accepted elsewhere) since the
// recommendation was made — approving it must NOT execute
// accept_marketplace_offer in that case.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface TableResponse { data: unknown; error?: unknown }
const state: { tables: Record<string, TableResponse> } = { tables: {} }

const executeToolSpy = vi.fn(async () => ({ offer_id: 'offer-1', deal_id: 'deal-1' }))
const postSystemMessageSpy = vi.fn(async () => {})

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'in', 'not', 'order', 'update', 'insert', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve?: (value: TableResponse) => void
  ) => { if (resolve) resolve(response) }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('./tools/execute', () => ({
  executeTool: (...args: Parameters<typeof executeToolSpy>) => executeToolSpy(...args),
}))

vi.mock('./agent-task-chat', () => ({
  postSystemMessage: (...args: Parameters<typeof postSystemMessageSpy>) => postSystemMessageSpy(...args),
}))

const baseTask = {
  id: 'task-1',
  org_id: 'buyer-org',
  type: 'award_recommendation',
  root_task_id: null,
  proposed_action: {
    tool_name: 'accept_marketplace_offer',
    tool_input: { offer_id: 'offer-1', acting_org_id: 'buyer-org' },
  },
  plan: { listing_id: 'listing-1', proposed_offer_id: 'offer-1', snapshot_round: 1 },
}

beforeEach(() => {
  state.tables = {}
  executeToolSpy.mockClear()
  postSystemMessageSpy.mockClear()
})

describe('executeApproval() — award_recommendation staleness guard (PR 3)', () => {
  it('refuses to execute when the offer moved to a new round since the recommendation', async () => {
    const { executeApproval } = await import('./agent-approve')
    state.tables.marketplace_offers = { data: { current_round: 2, status: 'countered' } }

    const result = await executeApproval(baseTask, 'approver-user')
    expect(executeToolSpy).not.toHaveBeenCalled()
    expect(result.result.error).toBe('stale_recommendation')
  })

  it('refuses to execute when the offer is no longer actionable (withdrawn/rejected/accepted)', async () => {
    const { executeApproval } = await import('./agent-approve')
    state.tables.marketplace_offers = { data: { current_round: 1, status: 'withdrawn' } }

    const result = await executeApproval(baseTask, 'approver-user')
    expect(executeToolSpy).not.toHaveBeenCalled()
    expect(result.result.error).toBe('stale_recommendation')
  })

  it('refuses to execute when the offer no longer exists at all', async () => {
    const { executeApproval } = await import('./agent-approve')
    state.tables.marketplace_offers = { data: null }

    const result = await executeApproval(baseTask, 'approver-user')
    expect(executeToolSpy).not.toHaveBeenCalled()
    expect(result.result.error).toBe('stale_recommendation')
  })

  it('executes accept_marketplace_offer when the offer is unchanged and still actionable', async () => {
    const { executeApproval } = await import('./agent-approve')
    state.tables.marketplace_offers = { data: { current_round: 1, status: 'pending' } }
    state.tables.agent_actions = { data: null }

    const result = await executeApproval(baseTask, 'approver-user')
    expect(executeToolSpy).toHaveBeenCalledTimes(1)
    expect(executeToolSpy).toHaveBeenCalledWith(
      'accept_marketplace_offer',
      expect.objectContaining({ offer_id: 'offer-1', acting_org_id: 'buyer-org' }),
      expect.objectContaining({ actor: { userId: 'approver-user', orgId: 'buyer-org', bankId: null } })
    )
    expect(result.result.deal_id).toBe('deal-1')
  })

  it('does not apply the staleness guard to other (non-award) task types', async () => {
    const { executeApproval } = await import('./agent-approve')
    const otherTask = {
      id: 'task-2', org_id: 'buyer-org', type: 'negotiation_ready_to_finalize', root_task_id: null,
      proposed_action: { tool_name: 'accept_marketplace_offer', tool_input: { offer_id: 'offer-1', acting_org_id: 'buyer-org' } },
      plan: { negotiation_id: 'neg-1' },
    }
    state.tables.agent_negotiations = { data: null }
    state.tables.agent_actions = { data: null }

    await executeApproval(otherTask, 'approver-user')
    expect(executeToolSpy).toHaveBeenCalledTimes(1)
  })
})
