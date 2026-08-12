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

  // Fully-qualified (evidence-extracted + scored) results are the ideal
  // output, but a job can legitimately end with zero of those — e.g. every
  // shortlisted page turned out to be a directory/category listing rather
  // than a single supplier's page, so there was nothing coherent to
  // evidence-extract. Without this, "show me the candidates" had no real
  // answer once qualification failed: raw discovery data existed in the DB
  // but no tool ever surfaced it, so the model either claimed it couldn't be
  // shown or fabricated a "one more round" option that doesn't exist for a
  // completed job. Surface the raw (unqualified) leads as a clearly-labeled
  // fallback so there's always something concrete to hand the buyer.
  let rawLeads: Array<{ title: string | null; domain: string | null; url: string | null; snippet: string | null }> = []
  if ((extractedCount ?? 0) === 0) {
    const { data: leads } = await adminClient
      .from('sourcing_candidates')
      .select('title, domain, source_url, discovery_snippet, status')
      .eq('search_id', job.id)
      .neq('status', 'rejected')
      .order('created_at', { ascending: true })
      .limit(15)
    rawLeads = (leads ?? []).map((c: { title: string | null; domain: string | null; source_url: string | null; discovery_snippet: string | null }) => ({
      title: c.title, domain: c.domain, url: c.source_url, snippet: c.discovery_snippet?.slice(0, 200) ?? null,
    }))
  }

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
    // Only populated when there are zero qualified (extracted+scored)
    // candidates — these are unverified leads a human still has to vet, not
    // evidence-backed results. Always label them as such if relaying to the user.
    unqualified_leads: rawLeads.length > 0 ? rawLeads : undefined,
    resumable: job.stage !== 'completed' && job.stage !== 'failed',
    note: job.stage === 'completed' || job.stage === 'failed'
      ? 'This search is finished and cannot be resumed or extended with more rounds. To try again with broader or different terms, start a new request_sourcing_search call — do not tell the user a round can be added to this job.'
      : undefined,
  }
}
