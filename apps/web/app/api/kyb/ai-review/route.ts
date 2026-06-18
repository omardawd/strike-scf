import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runKybAiReview } from '@/lib/kyb-review'

export type { KybReviewResult } from '@/lib/kyb-review'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

// POST /api/kyb/ai-review  { org_id }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users').select('id, role, org_id, bank_id').eq('id', user.id).single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { org_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  const isOwnOrg      = me.org_id === orgId
  const isBank        = BANK_ROLES.includes(me.role)
  const isStrikeAdmin = me.role === 'strike_admin'
  if (!isOwnOrg && !isBank && !isStrikeAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await runKybAiReview(orgId, { triggeredByUserId: me.id })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[kyb/ai-review] failed:', e)
    return NextResponse.json({ error: 'KYB review failed' }, { status: 500 })
  }
}
