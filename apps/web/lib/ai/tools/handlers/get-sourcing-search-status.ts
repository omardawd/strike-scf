import { adminClient } from '../admin'
import type { ToolActor } from './deal-workflow'

export interface GetSourcingSearchStatusInput {
  job_id: string
}

// Read-only — never advances the job (that's POST /api/ai/sourcing/[id]/advance,
// driven by the UI's polling, not by Claude). This exists so Claude can narrate
// progress or answer "did it finish?" in plain chat without a tool loop side effect.
export async function getSourcingSearchStatus(input: GetSourcingSearchStatusInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }

  const { data: job } = await adminClient
    .from('sourcing_searches')
    .select('id, org_id, stage, round, max_rounds, summary, error, requirements')
    .eq('id', input.job_id)
    .single()

  if (!job || job.org_id !== actor.orgId) return { error: 'Sourcing search not found' }

  const { count: candidateCount } = await adminClient
    .from('sourcing_candidates').select('id', { count: 'exact', head: true }).eq('search_id', job.id)
  const { count: shortlistedCount } = await adminClient
    .from('sourcing_candidates').select('id', { count: 'exact', head: true }).eq('search_id', job.id).eq('status', 'shortlisted')
  const { count: extractedCount } = await adminClient
    .from('sourcing_candidates').select('id', { count: 'exact', head: true }).eq('search_id', job.id).eq('status', 'extracted')

  return {
    job_id: job.id,
    stage: job.stage,
    round: job.round,
    max_rounds: job.max_rounds,
    candidates_discovered: candidateCount ?? 0,
    candidates_shortlisted: shortlistedCount ?? 0,
    candidates_extracted: extractedCount ?? 0,
    summary: job.summary,
    error: job.error,
  }
}
