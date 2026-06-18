import { adminClient } from '../admin'

type AlertType =
  | 'overdue_payments'
  | 'stuck_deals'
  | 'deteriorating_performance'
  | 'high_risk_flags'
  | 'upcoming_maturities'
  | 'concentration_risk'

export interface ProactivePortfolioAlertsInput {
  bank_id: string
  alert_types?: AlertType[]
  days_horizon?: number
}

type Severity = 'critical' | 'high' | 'medium' | 'low'

interface Alert {
  alert_type: AlertType
  severity: Severity
  title: string
  description: string
  entity_type: 'deal' | 'transaction' | 'organization' | 'portfolio'
  entity_id: string | null
  entity_name?: string
  recommended_action: string
  metadata?: Record<string, unknown>
}

const ALL_ALERT_TYPES: AlertType[] = [
  'overdue_payments', 'stuck_deals', 'deteriorating_performance',
  'high_risk_flags', 'upcoming_maturities', 'concentration_risk',
]

const FINAL_STATUSES = ['completed', 'cancelled', 'rejected']

const STUCK_THRESHOLDS_DAYS: Record<string, number> = {
  negotiating: 7, agreed: 5, contract_pending: 3, documents_pending: 5,
  confirmed: 14, in_preparation: 21, shipped: 14, delivery_confirmed: 7, payment_due: 3,
}

export async function proactivePortfolioAlerts(input: ProactivePortfolioAlertsInput) {
  const alertTypes = input.alert_types ?? ALL_ALERT_TYPES
  const horizon = input.days_horizon ?? 30
  const alerts: Alert[] = []
  const now = new Date()
  const horizonDate = new Date(now.getTime() + horizon * 86400000).toISOString()

  // Fetch data needed for selected alert types in parallel
  const needs = {
    txns: alertTypes.some((t) => ['overdue_payments', 'upcoming_maturities'].includes(t)),
    deals: alertTypes.some((t) => ['stuck_deals', 'overdue_payments', 'concentration_risk'].includes(t)),
    perfs: alertTypes.includes('deteriorating_performance'),
    riskOrgs: alertTypes.includes('high_risk_flags'),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [txnsRes, dealsRes, perfsRes, riskOrgsRes] = await Promise.all([
    needs.txns
      ? adminClient
          .from('transactions')
          .select('id, type, status, anchor_id, supplier_id, repayment_due_date, financing_amount_approved')
          .eq('bank_id', input.bank_id)
          .not('status', 'in', `(${FINAL_STATUSES.join(',')})`)
          .order('repayment_due_date', { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [] }),
    needs.deals
      ? adminClient
          .from('deals')
          .select('id, status, created_at, buyer_org_id, supplier_org_id, payment_due_date, financing_payment_active')
          .not('status', 'in', `(${FINAL_STATUSES.join(',')})`)
          .limit(500)
      : Promise.resolve({ data: [] }),
    needs.perfs
      ? adminClient
          .from('supplier_performance')
          .select('org_id, performance_score, performance_tier, on_time_payment_rate, dispute_rate')
          .eq('bank_id', input.bank_id)
      : Promise.resolve({ data: [] }),
    needs.riskOrgs
      ? adminClient
          .from('organizations')
          .select('id, legal_name, risk_score, risk_tier, risk_flags, kyb_status')
          .eq('bank_id', input.bank_id)
          .eq('network_visible', true)
          .not('risk_flags', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txns: any[] = txnsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals: any[] = dealsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supplierPerfs: any[] = perfsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const riskOrgs: any[] = riskOrgsRes.data ?? []

  // Fetch org names for deals and perfs
  const dealOrgIds = [...new Set([...deals.flatMap((d) => [d.buyer_org_id, d.supplier_org_id]), ...supplierPerfs.map((p) => p.org_id)])]
  const txnOrgIds = [...new Set(txns.map((t) => t.anchor_id).filter(Boolean))]
  const allLookupIds = [...new Set([...dealOrgIds, ...txnOrgIds])]

  let orgNameMap: Record<string, string> = {}
  if (allLookupIds.length > 0) {
    const { data: orgNames } = await adminClient
      .from('organizations')
      .select('id, legal_name')
      .in('id', allLookupIds)
    orgNameMap = Object.fromEntries((orgNames ?? []).map((o: { id: string; legal_name: string }) => [o.id, o.legal_name]))
  }

  // 1. Overdue payments
  if (alertTypes.includes('overdue_payments')) {
    for (const d of deals.filter((d) => d.status === 'payment_overdue')) {
      alerts.push({
        alert_type: 'overdue_payments', severity: 'critical',
        title: 'Overdue Payment — Deal',
        description: `Deal ${d.id.slice(0, 8)} is overdue. Buyer: ${orgNameMap[d.buyer_org_id] ?? d.buyer_org_id}. Financing active: ${d.financing_payment_active}.`,
        entity_type: 'deal', entity_id: d.id, entity_name: orgNameMap[d.buyer_org_id],
        recommended_action: 'Contact the buyer immediately. If financing is active, initiate collection process.',
        metadata: { payment_due_date: d.payment_due_date, financing_active: d.financing_payment_active },
      })
    }
    for (const t of txns.filter((t) => t.status === 'repayment_due' && t.repayment_due_date && new Date(t.repayment_due_date) < now)) {
      alerts.push({
        alert_type: 'overdue_payments', severity: 'critical',
        title: 'Overdue Transaction Repayment',
        description: `Transaction ${t.id.slice(0, 8)} repayment overdue since ${t.repayment_due_date}. Amount: $${Number(t.financing_amount_approved).toLocaleString()}.`,
        entity_type: 'transaction', entity_id: t.id, entity_name: orgNameMap[t.anchor_id],
        recommended_action: "Initiate collection per your bank's repayment protocol.",
        metadata: { repayment_due_date: t.repayment_due_date, amount: t.financing_amount_approved },
      })
    }
  }

  // 2. Stuck deals
  if (alertTypes.includes('stuck_deals')) {
    for (const d of deals) {
      const threshold = STUCK_THRESHOLDS_DAYS[d.status]
      if (!threshold) continue
      const daysSince = (now.getTime() - new Date(d.created_at).getTime()) / 86400000
      if (daysSince > threshold) {
        alerts.push({
          alert_type: 'stuck_deals',
          severity: daysSince > threshold * 2 ? 'high' : 'medium',
          title: `Stuck Deal — ${d.status}`,
          description: `Deal ${d.id.slice(0, 8)} has been in "${d.status}" for ${Math.round(daysSince)} days (threshold: ${threshold}).`,
          entity_type: 'deal', entity_id: d.id, entity_name: orgNameMap[d.buyer_org_id],
          recommended_action: `Follow up with ${orgNameMap[d.buyer_org_id] ?? 'buyer'} and ${orgNameMap[d.supplier_org_id] ?? 'supplier'} to unblock.`,
          metadata: { days_in_status: Math.round(daysSince), threshold_days: threshold },
        })
      }
    }
  }

  // 3. Deteriorating performance
  if (alertTypes.includes('deteriorating_performance')) {
    for (const p of supplierPerfs.filter((p) => (p.performance_score ?? 100) < 40)) {
      alerts.push({
        alert_type: 'deteriorating_performance', severity: 'high',
        title: `Low Supplier Performance — ${orgNameMap[p.org_id] ?? p.org_id}`,
        description: `Performance score: ${p.performance_score}/100. On-time rate: ${Math.round((p.on_time_payment_rate ?? 0) * 100)}%. Dispute rate: ${Math.round((p.dispute_rate ?? 0) * 100)}%.`,
        entity_type: 'organization', entity_id: p.org_id, entity_name: orgNameMap[p.org_id],
        recommended_action: 'Consider reducing financing exposure or requiring collateral from this supplier.',
        metadata: { performance_score: p.performance_score, on_time_payment_rate: p.on_time_payment_rate, dispute_rate: p.dispute_rate },
      })
    }
  }

  // 4. High risk flags
  if (alertTypes.includes('high_risk_flags')) {
    for (const o of riskOrgs) {
      const flags = Array.isArray(o.risk_flags) ? o.risk_flags : []
      if (flags.length > 0 || (o.risk_score ?? 0) > 70) {
        alerts.push({
          alert_type: 'high_risk_flags',
          severity: (o.risk_score ?? 0) > 80 ? 'critical' : 'high',
          title: `Risk Flag — ${o.legal_name}`,
          description: `Risk score: ${o.risk_score} (tier ${o.risk_tier}). Flags: ${flags.map((f: unknown) => (typeof f === 'string' ? f : JSON.stringify(f))).join('; ')}.`,
          entity_type: 'organization', entity_id: o.id, entity_name: o.legal_name,
          recommended_action: 'Review with compliance. Consider pausing new financing for this organization.',
          metadata: { risk_score: o.risk_score, risk_tier: o.risk_tier, flags },
        })
      }
    }
  }

  // 5. Upcoming maturities
  if (alertTypes.includes('upcoming_maturities')) {
    for (const t of txns.filter((t) => t.repayment_due_date && new Date(t.repayment_due_date) >= now && new Date(t.repayment_due_date) <= new Date(horizonDate) && t.status !== 'completed')) {
      const daysUntil = Math.round((new Date(t.repayment_due_date).getTime() - now.getTime()) / 86400000)
      alerts.push({
        alert_type: 'upcoming_maturities',
        severity: daysUntil <= 7 ? 'high' : 'medium',
        title: `Upcoming Maturity in ${daysUntil} Day(s)`,
        description: `Transaction ${t.id.slice(0, 8)} matures on ${t.repayment_due_date}. Amount: $${Number(t.financing_amount_approved).toLocaleString()}.`,
        entity_type: 'transaction', entity_id: t.id, entity_name: orgNameMap[t.anchor_id],
        recommended_action: `Send repayment reminder to ${orgNameMap[t.anchor_id] ?? 'buyer'} ${daysUntil <= 7 ? 'immediately' : 'this week'}.`,
        metadata: { repayment_due_date: t.repayment_due_date, days_until: daysUntil, amount: t.financing_amount_approved },
      })
    }
  }

  // 6. Concentration risk
  if (alertTypes.includes('concentration_risk')) {
    const dealCounts: Record<string, number> = {}
    for (const d of deals) {
      dealCounts[d.buyer_org_id] = (dealCounts[d.buyer_org_id] ?? 0) + 1
      dealCounts[d.supplier_org_id] = (dealCounts[d.supplier_org_id] ?? 0) + 1
    }
    for (const [orgId, count] of Object.entries(dealCounts)) {
      const pct = deals.length > 0 ? Math.round((count / deals.length) * 100) : 0
      if (pct >= 30 && count >= 3) {
        alerts.push({
          alert_type: 'concentration_risk',
          severity: pct >= 50 ? 'high' : 'medium',
          title: `Concentration Risk — ${orgNameMap[orgId] ?? orgId}`,
          description: `${orgNameMap[orgId] ?? orgId} is in ${pct}% of active deals (${count} of ${deals.length}).`,
          entity_type: 'organization', entity_id: orgId, entity_name: orgNameMap[orgId],
          recommended_action: 'Review concentration limits and consider diversifying the portfolio.',
          metadata: { deal_count: count, portfolio_pct: pct },
        })
      }
    }
  }

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return {
    bank_id: input.bank_id,
    generated_at: now.toISOString(),
    horizon_days: horizon,
    alert_types_scanned: alertTypes,
    total_alerts: alerts.length,
    summary: {
      critical: alerts.filter((a) => a.severity === 'critical').length,
      high: alerts.filter((a) => a.severity === 'high').length,
      medium: alerts.filter((a) => a.severity === 'medium').length,
      low: alerts.filter((a) => a.severity === 'low').length,
    },
    alerts,
  }
}
