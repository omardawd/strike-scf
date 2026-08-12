import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { advanceSourcingSearch } from '@/lib/ai/sourcing/advance'

export const runtime = 'nodejs'
export const maxDuration = 60

// Mutating — does ONE bounded stage of work per call and persists before
// returning. The sourcing_job STRIKE_BLOCK component polls this on an
// interval to drive the job forward; GET on the sibling route never mutates.
// This is the function a cron-driven worker would call later to make a job
// survive a closed laptop — same engine, different trigger, no redesign.

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job } = await adminClient.from('sourcing_searches').select('org_id').eq('id', id).single()
  if (!job || job.org_id !== userData.org_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await advanceSourcingSearch(id)

  const { data: candidates } = await adminClient
    .from('sourcing_candidates')
    .select('*')
    .eq('search_id', id)
    .order('spec_match_score', { ascending: false, nullsFirst: false })

  return NextResponse.json({ job: updated, candidates: candidates ?? [] })
}
