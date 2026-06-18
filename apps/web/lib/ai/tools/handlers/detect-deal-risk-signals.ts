import { adminClient } from '../admin'

export interface DetectDealRiskSignalsInput {
  deal_id: string
  org_ids?: string[]
  include_document_scan?: boolean
}

type Severity = 'critical' | 'high' | 'medium' | 'low'

interface RiskSignal {
  signal_type: string
  severity: Severity
  description: string
  entity: string
  recommended_action: string
  metadata?: Record<string, unknown>
}

export async function detectDealRiskSignals(input: DetectDealRiskSignalsInput) {
  const includeDocScan = input.include_document_scan !== false
  const signals: RiskSignal[] = []

  const { data: deal } = await adminClient
    .from('deals')
    .select(
      'id, status, deal_source, buyer_org_id, supplier_org_id, ' +
      'payment_bank_name, payment_account_number, payment_routing_number, payment_swift_iban, ' +
      'payment_instructions_set_at, dispute_reason, dispute_category, cancelled_by, ' +
      'amendment_history, financing_payment_active, created_at'
    )
    .eq('id', input.deal_id)
    .single()

  if (!deal) return { error: `Deal ${input.deal_id} not found` }

  const allOrgIds = [...new Set([deal.buyer_org_id, deal.supplier_org_id, ...(input.org_ids ?? [])].filter(Boolean))] as string[]

  const [{ data: orgs }, { data: events }] = await Promise.all([
    adminClient
      .from('organizations')
      .select('id, legal_name, risk_score, risk_tier, risk_flags, tariff_exposure, kyb_status')
      .in('id', allOrgIds),
    adminClient
      .from('deal_events')
      .select('event_type, description, metadata, created_at')
      .eq('deal_id', input.deal_id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  let docs: { id: string; document_kind: string; name: string; ai_fraud_score: number; ai_fraud_flags: unknown; entity_type: string; entity_id: string }[] = []
  if (includeDocScan) {
    const { data: docsData } = await adminClient
      .from('documents')
      .select('id, document_kind, name, ai_fraud_score, ai_fraud_flags, entity_type, entity_id')
      .in('entity_id', [input.deal_id, ...allOrgIds])
      .not('ai_fraud_score', 'is', null)
    docs = docsData ?? []
  }

  const orgMap = Object.fromEntries((orgs ?? []).map((o: { id: string }) => [o.id, o]))

  // 1. Document fraud signals
  for (const doc of docs) {
    const fraudScore = Number(doc.ai_fraud_score ?? 0)
    if (fraudScore >= 0.7) {
      signals.push({
        signal_type: 'document_fraud_high',
        severity: 'critical',
        description: `Document "${doc.name}" has a high AI fraud score (${Math.round(fraudScore * 100)}%).`,
        entity: orgMap[doc.entity_id]?.legal_name ?? doc.entity_id,
        recommended_action: 'Halt the deal and request fresh document verification from a third party.',
        metadata: { document_kind: doc.document_kind, fraud_score: fraudScore, flags: doc.ai_fraud_flags },
      })
    } else if (fraudScore >= 0.4) {
      signals.push({
        signal_type: 'document_fraud_medium',
        severity: 'medium',
        description: `Document "${doc.name}" has an elevated fraud score (${Math.round(fraudScore * 100)}%).`,
        entity: orgMap[doc.entity_id]?.legal_name ?? doc.entity_id,
        recommended_action: 'Request the original document and verify independently before proceeding.',
        metadata: { document_kind: doc.document_kind, fraud_score: fraudScore, flags: doc.ai_fraud_flags },
      })
    }
  }

  // 2. Org risk flags
  for (const org of orgs ?? []) {
    const riskFlags = Array.isArray(org.risk_flags) ? org.risk_flags : []
    for (const flag of riskFlags) {
      signals.push({
        signal_type: 'org_risk_flag',
        severity: 'high',
        description: `${org.legal_name}: risk flag — ${typeof flag === 'string' ? flag : JSON.stringify(flag)}`,
        entity: org.legal_name,
        recommended_action: 'Review the risk flag with your compliance team before proceeding.',
        metadata: { risk_score: org.risk_score, risk_tier: org.risk_tier },
      })
    }

    if ((org.risk_score ?? 0) > 70) {
      signals.push({
        signal_type: 'high_risk_score',
        severity: 'high',
        description: `${org.legal_name} has a risk score of ${org.risk_score} (tier ${org.risk_tier}).`,
        entity: org.legal_name,
        recommended_action: 'Request additional financial documentation and consider collateral.',
      })
    }

    if (org.kyb_status && !['approved', 'under_review', 'submitted'].includes(org.kyb_status)) {
      signals.push({
        signal_type: 'kyb_incomplete',
        severity: org.kyb_status === 'not_started' ? 'critical' : 'medium',
        description: `${org.legal_name} KYB status is "${org.kyb_status}" — identity not fully verified.`,
        entity: org.legal_name,
        recommended_action: 'Ensure KYB is submitted and under review before advancing the deal.',
      })
    }

    if (org.tariff_exposure && Object.keys(org.tariff_exposure as object).length > 0) {
      signals.push({
        signal_type: 'tariff_exposure',
        severity: 'medium',
        description: `${org.legal_name} has tariff exposure: ${JSON.stringify(org.tariff_exposure)}.`,
        entity: org.legal_name,
        recommended_action: 'Clarify incoterms and who bears tariff risk in the deal contract.',
        metadata: { tariff_exposure: org.tariff_exposure },
      })
    }
  }

  // 3. Payment instruction anomalies
  if (deal.payment_account_number && deal.payment_bank_name) {
    const paymentChangeEvents = (events ?? []).filter(
      (e: { event_type: string; description: string }) =>
        e.event_type?.includes('payment_instructions') ||
        (e.description ?? '').toLowerCase().includes('payment')
    )
    if (paymentChangeEvents.length > 1) {
      signals.push({
        signal_type: 'payment_instructions_changed',
        severity: 'high',
        description: `Payment instructions changed ${paymentChangeEvents.length} times. May indicate account tampering.`,
        entity: 'deal',
        recommended_action: 'Call the supplier directly to verify the current bank account number before sending payment.',
        metadata: { change_count: paymentChangeEvents.length },
      })
    }
  }

  // 4. Stuck deal
  const dealAgeHours = (Date.now() - new Date(deal.created_at).getTime()) / 3600000
  if (['negotiating', 'agreed', 'contract_pending', 'documents_pending'].includes(deal.status) && dealAgeHours > 168) {
    signals.push({
      signal_type: 'stuck_deal',
      severity: 'low',
      description: `Deal has been in "${deal.status}" for ${Math.round(dealAgeHours / 24)} days.`,
      entity: 'deal',
      recommended_action: 'Follow up with both parties to unblock progress.',
    })
  }

  // 5. Active dispute
  if (deal.status === 'in_dispute') {
    signals.push({
      signal_type: 'active_dispute',
      severity: 'critical',
      description: `Deal is in active dispute. Reason: ${deal.dispute_reason ?? 'Not specified'}. Category: ${deal.dispute_category ?? 'Unknown'}.`,
      entity: 'deal',
      recommended_action: 'Submit evidence to Strike Admin for resolution.',
      metadata: { dispute_reason: deal.dispute_reason, dispute_category: deal.dispute_category },
    })
  }

  // 6. Excessive amendments
  const amendments = Array.isArray(deal.amendment_history) ? deal.amendment_history : []
  if (amendments.length > 2) {
    signals.push({
      signal_type: 'excessive_amendments',
      severity: 'medium',
      description: `Deal has ${amendments.length} amendments — indicates unstable terms.`,
      entity: 'deal',
      recommended_action: 'Review all amendments to confirm both parties are aligned on current terms.',
    })
  }

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  signals.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  const criticalCount = signals.filter((s) => s.severity === 'critical').length
  const highCount = signals.filter((s) => s.severity === 'high').length
  const overallRisk = criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : signals.length > 0 ? 'medium' : 'low'

  return {
    deal_id: input.deal_id,
    deal_status: deal.status,
    overall_risk: overallRisk,
    signal_count: signals.length,
    signals_by_severity: {
      critical: criticalCount,
      high: highCount,
      medium: signals.filter((s) => s.severity === 'medium').length,
      low: signals.filter((s) => s.severity === 'low').length,
    },
    signals,
    parties_scanned: allOrgIds.map((id) => ({
      org_id: id,
      legal_name: orgMap[id]?.legal_name ?? id,
      risk_score: orgMap[id]?.risk_score,
      risk_tier: orgMap[id]?.risk_tier,
    })),
    financing_active: deal.financing_payment_active,
  }
}
