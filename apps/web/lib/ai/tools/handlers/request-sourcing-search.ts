import { adminClient } from '../admin'
import { advanceSourcingSearch } from '../../sourcing/advance'
import type { ToolActor } from './deal-workflow'

export interface RequestSourcingSearchInput {
  org_id: string
  query: string
}

// Kicks off a staged sourcing job and runs its first (fast) stage inline so
// the reply already has a parsed brief to show the buyer. Every later stage
// (discovery rounds, deep extraction, ranking) runs via repeated calls to
// POST /api/ai/sourcing/[id]/advance, driven by the sourcing_job STRIKE_BLOCK
// component's polling — not by this tool call, which must return quickly.
export async function requestSourcingSearch(input: RequestSourcingSearchInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }

  const { data: job, error } = await adminClient
    .from('sourcing_searches')
    .insert({
      org_id: actor.orgId,
      requested_by_user_id: actor.userId,
      raw_query: input.query,
    })
    .select('*')
    .single()

  if (error || !job) return { error: `Could not start sourcing search: ${error?.message ?? 'unknown error'}` }

  const advanced = await advanceSourcingSearch(job.id).catch(() => job)

  return {
    job_id: job.id,
    stage: advanced.stage,
    requirements: advanced.requirements,
  }
}
