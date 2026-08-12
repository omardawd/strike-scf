import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Read-only status + results for a Strike Sourcing job. Never mutates —
// advancing the job is POST /api/ai/sourcing/[id]/advance only.

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
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

  const { data: job } = await adminClient
    .from('sourcing_searches')
    .select('*')
    .eq('id', id)
    .single()
  if (!job || job.org_id !== userData.org_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: candidates } = await adminClient
    .from('sourcing_candidates')
    .select('*')
    .eq('search_id', id)
    .order('spec_match_score', { ascending: false, nullsFirst: false })

  return NextResponse.json({ job, candidates: candidates ?? [] })
}
