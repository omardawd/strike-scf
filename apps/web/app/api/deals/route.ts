import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!userData.org_id) return NextResponse.json({ deals: [] })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = adminClient
    .from('deals')
    .select('*, marketplace_listings(id, title, listing_type)')
    .or(`buyer_org_id.eq.${userData.org_id},supplier_org_id.eq.${userData.org_id}`)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: deals, error } = await query
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  // Gather counterparty org IDs
  const orgIds = new Set<string>()
  for (const d of deals ?? []) {
    if (d.buyer_org_id !== userData.org_id) orgIds.add(d.buyer_org_id)
    if (d.supplier_org_id !== userData.org_id) orgIds.add(d.supplier_org_id)
  }

  let orgsMap: Record<string, { id: string; legal_name: string | null; passport_score: number | null; risk_tier: string | null }> = {}
  if (orgIds.size > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, passport_score, risk_tier')
      .in('id', Array.from(orgIds))
    for (const o of orgs ?? []) orgsMap[o.id] = o
  }

  // Gather linked financing requests so the deals list can surface financing
  // status + structure (the closest "program context" we have pre-program-linkage).
  const finReqIds = (deals ?? [])
    .map(d => d.financing_request_id)
    .filter((id): id is string => !!id)

  let finMap: Record<string, {
    id: string
    status: string
    structure_type: string
    financing_type: string
    amount_requested: number | null
    offer_count: number | null
    accepted_bank_id: string | null
  }> = {}
  if (finReqIds.length > 0) {
    const { data: finReqs } = await adminClient
      .from('financing_requests')
      .select('id, status, structure_type, financing_type, amount_requested, offer_count, accepted_bank_id')
      .in('id', finReqIds)
    for (const f of finReqs ?? []) finMap[f.id] = f
  }

  const enriched = (deals ?? []).map(d => {
    const counterpartyId = d.buyer_org_id === userData.org_id ? d.supplier_org_id : d.buyer_org_id
    return {
      ...d,
      counterparty: orgsMap[counterpartyId] ?? null,
      user_role: d.buyer_org_id === userData.org_id ? 'buyer' : 'supplier',
      financing_request: d.financing_request_id ? (finMap[d.financing_request_id] ?? null) : null,
    }
  })

  return NextResponse.json({ deals: enriched })
}
