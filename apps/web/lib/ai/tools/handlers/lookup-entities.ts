import { adminClient } from '../admin'

export interface LookupEntitiesInput {
  entity_type: 'organization' | 'deal' | 'financing_request'
  query: string
  org_id?: string  // scope deals / financing requests to this org
  limit?: number
}

export async function lookupEntities(input: LookupEntitiesInput) {
  const limit = Math.min(input.limit ?? 5, 20)
  const q = input.query.trim()

  if (input.entity_type === 'organization') {
    const { data } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as, type, kyb_status, network_visible, passport_score, risk_tier')
      .or(`legal_name.ilike.%${q}%,doing_business_as.ilike.%${q}%`)
      .eq('network_visible', true)
      .limit(limit)

    return {
      entity_type: 'organization',
      query: q,
      results: (data ?? []).map((o: {
        id: string; legal_name: string; doing_business_as: string | null;
        type: string; kyb_status: string; network_visible: boolean;
        passport_score: number | null; risk_tier: string | null;
      }) => ({
        id: o.id,
        name: o.doing_business_as ?? o.legal_name,
        legal_name: o.legal_name,
        type: o.type,
        kyb_status: o.kyb_status,
        passport_score: o.passport_score,
        risk_tier: o.risk_tier,
      })),
      tip: 'Pass the "id" field as supplier_org_id / buyer_org_id in the relevant tool.',
    }
  }

  if (input.entity_type === 'deal') {
    // Search by counterparty name or status
    let qb = adminClient
      .from('deals')
      .select(
        'id, status, deal_source, created_at, buyer_org_id, supplier_org_id, ' +
        'buyer:organizations!deals_buyer_org_id_fkey(legal_name, doing_business_as), ' +
        'supplier:organizations!deals_supplier_org_id_fkey(legal_name, doing_business_as)'
      )

    if (input.org_id) {
      qb = qb.or(`buyer_org_id.eq.${input.org_id},supplier_org_id.eq.${input.org_id}`)
    }

    const { data } = await qb
      .order('created_at', { ascending: false })
      .limit(50)

    // Filter client-side by counterparty name match
    const lower = q.toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = (data ?? []).filter((d: any) => {
      const buyerName = (d.buyer?.doing_business_as ?? d.buyer?.legal_name ?? '').toLowerCase()
      const supplierName = (d.supplier?.doing_business_as ?? d.supplier?.legal_name ?? '').toLowerCase()
      const status = (d.status ?? '').toLowerCase()
      return buyerName.includes(lower) || supplierName.includes(lower) || status.includes(lower) || lower === 'all'
    }).slice(0, limit)

    return {
      entity_type: 'deal',
      query: q,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: filtered.map((d: any) => ({
        id: d.id,
        status: d.status,
        deal_source: d.deal_source,
        buyer: d.buyer?.doing_business_as ?? d.buyer?.legal_name,
        supplier: d.supplier?.doing_business_as ?? d.supplier?.legal_name,
        created_at: d.created_at,
      })),
      tip: 'Pass the "id" field as deal_id in the relevant tool.',
    }
  }

  if (input.entity_type === 'financing_request') {
    let qb = adminClient
      .from('financing_requests')
      .select(
        'id, status, created_at, requesting_org_id, ' +
        'requester:organizations!financing_requests_requesting_org_id_fkey(legal_name, doing_business_as)'
      )

    if (input.org_id) {
      qb = qb.eq('requesting_org_id', input.org_id)
    }

    const { data } = await qb
      .order('created_at', { ascending: false })
      .limit(limit)

    const lower = q.toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = lower === 'all' || !q ? (data ?? []) : (data ?? []).filter((r: any) => {
      const orgName = (r.requester?.doing_business_as ?? r.requester?.legal_name ?? '').toLowerCase()
      return orgName.includes(lower) || (r.status ?? '').includes(lower)
    })

    return {
      entity_type: 'financing_request',
      query: q,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: filtered.slice(0, limit).map((r: any) => ({
        id: r.id,
        status: r.status,
        requester: r.requester?.doing_business_as ?? r.requester?.legal_name,
        created_at: r.created_at,
      })),
      tip: 'Pass the "id" field as financing_request_id in score_and_rank_financing_offers.',
    }
  }

  return { error: `Unknown entity_type: ${input.entity_type as string}` }
}
