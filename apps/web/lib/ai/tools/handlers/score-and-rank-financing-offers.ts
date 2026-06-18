import { adminClient } from '../admin'

type Priority = 'lowest_cost' | 'fastest_funding' | 'most_flexible' | 'balanced'

export interface ScoreAndRankFinancingOffersInput {
  financing_request_id: string
  priority: Priority
  requesting_org_id?: string
}

const PRIORITY_WEIGHTS: Record<Priority, Record<string, number>> = {
  lowest_cost:    { rate: 40, amount: 20, tenor: 15, structure: 15, bank_reputation: 10 },
  fastest_funding:{ rate: 10, amount: 20, tenor: 30, structure: 25, bank_reputation: 15 },
  most_flexible:  { rate: 15, amount: 20, tenor: 25, structure: 30, bank_reputation: 10 },
  balanced:       { rate: 25, amount: 20, tenor: 20, structure: 20, bank_reputation: 15 },
}

function scoreRate(apr: number, allAprs: number[]): number {
  if (allAprs.length === 0) return 50
  const min = Math.min(...allAprs)
  const max = Math.max(...allAprs)
  if (max === min) return 80
  return Math.round(100 - ((apr - min) / (max - min)) * 80)
}

function scoreAmount(offered: number, requested: number | null, allOffered: number[]): number {
  if (!requested || allOffered.length === 0) return 70
  const coverageRatio = Math.min(1, offered / requested)
  const relativeRank = offered / Math.max(...allOffered)
  return Math.round((coverageRatio * 0.6 + relativeRank * 0.4) * 100)
}

function scoreTenor(days: number, priority: Priority): number {
  if (priority === 'fastest_funding') return days <= 30 ? 100 : days <= 60 ? 75 : days <= 90 ? 55 : 30
  if (priority === 'most_flexible') return days >= 60 && days <= 120 ? 90 : days >= 30 ? 65 : 40
  return days >= 60 && days <= 90 ? 90 : days >= 30 ? 70 : 50
}

function scoreStructure(structureType: string, priority: Priority): number {
  const ideal: Record<Priority, string[]> = {
    lowest_cost:    ['reverse_factoring', 'dynamic_discounting'],
    fastest_funding:['factoring', 'po_financing'],
    most_flexible:  ['open', 'factoring'],
    balanced:       ['reverse_factoring', 'factoring', 'open'],
  }
  return (ideal[priority] ?? []).includes(structureType) ? 90 : 60
}

export async function scoreAndRankFinancingOffers(input: ScoreAndRankFinancingOffersInput) {
  const [{ data: request }, { data: offers }] = await Promise.all([
    adminClient
      .from('financing_requests')
      .select('id, requesting_org_id, status, created_at')
      .eq('id', input.financing_request_id)
      .single(),
    adminClient
      .from('financing_request_offers')
      .select(
        'id, bank_id, offered_rate_apr, offered_amount, offered_tenor_days, ' +
        'structure_type, conditions, notes, status, ai_score, ai_score_reasoning, submitted_at, program_id'
      )
      .eq('request_id', input.financing_request_id)
      .order('submitted_at', { ascending: true }),
  ])

  if (!request) return { error: `Financing request ${input.financing_request_id} not found` }
  if (!offers || offers.length === 0) return { financing_request_id: input.financing_request_id, offers: [], message: 'No offers received yet.' }

  const bankIds = [...new Set(offers.map((o: { bank_id: string }) => o.bank_id))]
  const { data: banks } = await adminClient
    .from('banks')
    .select('id, legal_name, display_name, status')
    .in('id', bankIds)

  const bankMap = Object.fromEntries((banks ?? []).map((b: { id: string; legal_name: string; display_name: string; status: string }) => [b.id, b]))

  const allAprs = offers.filter((o: { offered_rate_apr: number | null }) => o.offered_rate_apr != null).map((o: { offered_rate_apr: number }) => Number(o.offered_rate_apr))
  const allAmounts = offers.filter((o: { offered_amount: number | null }) => o.offered_amount != null).map((o: { offered_amount: number }) => Number(o.offered_amount))
  const requestedAmount = allAmounts.length > 0 ? Math.max(...allAmounts) : null

  const weights = PRIORITY_WEIGHTS[input.priority]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredOffers = offers.map((offer: any) => {
    const rateScore = offer.offered_rate_apr != null ? scoreRate(Number(offer.offered_rate_apr), allAprs) : 50
    const amountScore = offer.offered_amount != null ? scoreAmount(Number(offer.offered_amount), requestedAmount, allAmounts) : 50
    const tenorScore = offer.offered_tenor_days != null ? scoreTenor(Number(offer.offered_tenor_days), input.priority) : 50
    const structureScore = offer.structure_type ? scoreStructure(offer.structure_type, input.priority) : 50
    const bankReputationScore = bankMap[offer.bank_id]?.status === 'active' ? 85 : 50

    const w = weights as Record<string, number>
    const totalScore = Math.round(
      rateScore * ((w['rate'] ?? 25) / 100) +
      amountScore * ((w['amount'] ?? 20) / 100) +
      tenorScore * ((w['tenor'] ?? 20) / 100) +
      structureScore * ((w['structure'] ?? 20) / 100) +
      bankReputationScore * ((w['bank_reputation'] ?? 15) / 100)
    )

    const reasoning = [
      `Rate (${offer.offered_rate_apr}% APR): ${rateScore}/100`,
      `Amount ($${Number(offer.offered_amount).toLocaleString()}): ${amountScore}/100`,
      `Tenor (${offer.offered_tenor_days} days): ${tenorScore}/100`,
      `Structure (${offer.structure_type}): ${structureScore}/100`,
      `Bank standing: ${bankReputationScore}/100`,
      `Priority: ${input.priority} → overall ${totalScore}/100`,
    ].join('. ')

    return {
      offer_id: offer.id,
      bank_id: offer.bank_id,
      bank_name: bankMap[offer.bank_id]?.display_name ?? bankMap[offer.bank_id]?.legal_name ?? offer.bank_id,
      offered_rate_apr: offer.offered_rate_apr,
      offered_amount: offer.offered_amount,
      offered_tenor_days: offer.offered_tenor_days,
      structure_type: offer.structure_type,
      conditions: offer.conditions,
      notes: offer.notes,
      status: offer.status,
      submitted_at: offer.submitted_at,
      ai_score: totalScore,
      ai_score_reasoning: reasoning,
      score_breakdown: { rate: rateScore, amount: amountScore, tenor: tenorScore, structure: structureScore, bank_reputation: bankReputationScore },
    }
  })

  scoredOffers.sort((a: { ai_score: number }, b: { ai_score: number }) => b.ai_score - a.ai_score)

  await Promise.allSettled(
    scoredOffers.map((o: { offer_id: string; ai_score: number; ai_score_reasoning: string }) =>
      adminClient
        .from('financing_request_offers')
        .update({ ai_score: o.ai_score, ai_score_reasoning: o.ai_score_reasoning })
        .eq('id', o.offer_id)
    )
  )

  const top = scoredOffers[0]
  return {
    financing_request_id: input.financing_request_id,
    priority: input.priority,
    offers_ranked: scoredOffers,
    top_recommendation: {
      offer_id: top.offer_id,
      bank_name: top.bank_name,
      score: top.ai_score,
      summary: `Best offer for "${input.priority}" priority: ${top.bank_name} at ${top.offered_rate_apr}% APR for $${Number(top.offered_amount).toLocaleString()} over ${top.offered_tenor_days} days (score: ${top.ai_score}/100).`,
    },
    weights_applied: weights,
    scores_written_to_db: true,
  }
}
