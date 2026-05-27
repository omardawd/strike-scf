import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  const isBank = me?.role === 'bank_admin' || me?.role === 'bank_credit_officer'
  const isSupplier = me?.role === 'supplier_admin' || me?.role === 'supplier_member'

  if (!me || (!isBank && !isSupplier)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as { org_id?: string }
  const { org_id } = body
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  // Suppliers may only score their own organization
  if (isSupplier && me.org_id !== org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch organization
  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', org_id)
    .single()

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const countryOfOrigin: string | null = org.country_of_origin ?? null
  const sourcingCountries: string[] = Array.isArray(org.sourcing_countries) ? org.sourcing_countries : []

  // Fetch market signal for country_of_origin
  let countrySignal: { value: number; metadata: Record<string, unknown> } | null = null
  if (countryOfOrigin) {
    const { data: signal } = await adminClient
      .from('market_signals')
      .select('value, metadata')
      .eq('signal_type', 'country_risk')
      .eq('country_code', countryOfOrigin)
      .maybeSingle()
    if (signal) countrySignal = signal as { value: number; metadata: Record<string, unknown> }
  }

  // Fetch transaction history
  const { data: txns } = await adminClient
    .from('transactions')
    .select('id, status')
    .eq('supplier_id', org_id)

  const transactionCount = txns?.length ?? 0
  const disputedCount = (txns ?? []).filter((t: { status: string }) => t.status === 'rejected').length

  // Fetch KYB / credit data
  const { data: creditScoreRow } = await adminClient
    .from('credit_scores')
    .select('total_score')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const creditScore: number | null = creditScoreRow?.total_score ?? org.credit_score ?? null

  // ── Component 1: KYB / Compliance (25 pts) ──
  let kybScore = 0
  switch (org.kyb_status) {
    case 'approved':    kybScore = 25; break
    case 'submitted':   kybScore = 15; break
    case 'in_progress': kybScore = 5;  break
    default:            kybScore = 0
  }

  // ── Component 2: Tariff / Geo exposure (25 pts) ──
  let tariffScore: number
  if (countrySignal) {
    tariffScore = Math.round(25 * (1 - countrySignal.value / 100))
  } else {
    tariffScore = 12
  }

  // ── Component 3: Transaction performance (25 pts) ──
  let performanceScore: number
  if (transactionCount === 0) {
    performanceScore = 12
  } else {
    const onTimeRate = (transactionCount - disputedCount) / transactionCount
    performanceScore = Math.round(25 * onTimeRate)
  }

  // ── Component 4: Financial health (25 pts) ──
  let financialScore: number
  if (creditScore == null) {
    financialScore = 12
  } else if (creditScore > 70) {
    financialScore = 25
  } else if (creditScore >= 50) {
    financialScore = 15
  } else {
    financialScore = 5
  }

  const totalScore = kybScore + tariffScore + performanceScore + financialScore

  const tier = totalScore >= 70 ? 'green' : totalScore >= 45 ? 'amber' : 'red'

  // ── Risk flags ──
  const flags: Array<{ code: string; label: string; detail: string; severity: string }> = []

  const meta = countrySignal?.metadata as Record<string, unknown> | undefined

  if (meta?.tariff_risk === 'high') {
    flags.push({
      code: 'tariff_exposed',
      label: 'High tariff exposure',
      detail: `${meta.label}: ${meta.hts_tariff_pct}% HTS tariff`,
      severity: 'high',
    })
  }
  if (meta?.tariff_risk === 'medium') {
    flags.push({
      code: 'tariff_medium',
      label: 'Moderate tariff exposure',
      detail: `${meta.label}: ${meta.hts_tariff_pct}% HTS tariff`,
      severity: 'medium',
    })
  }

  if (meta?.geo_risk === 'high' || meta?.geo_risk === 'medium') {
    flags.push({
      code: 'geo_risk',
      label: 'Geopolitical risk',
      detail: `Operations in ${meta.label}`,
      severity: meta.geo_risk as string,
    })
  }

  if (sourcingCountries.length === 1) {
    flags.push({
      code: 'single_source',
      label: 'Single-country sourcing',
      detail: 'All production from one geography',
      severity: 'medium',
    })
  }

  if (org.kyb_status === 'rejected') {
    flags.push({
      code: 'kyb_rejected',
      label: 'KYB rejected',
      detail: 'KYB application was rejected',
      severity: 'high',
    })
  }
  if (org.kyb_status !== 'approved') {
    flags.push({
      code: 'kyb_incomplete',
      label: 'KYB not approved',
      detail: 'Counterparty KYB is not complete',
      severity: 'medium',
    })
  }

  if (transactionCount === 0) {
    flags.push({
      code: 'no_history',
      label: 'No transaction history',
      detail: 'New counterparty on the platform',
      severity: 'low',
    })
  }

  // Update organization
  await adminClient
    .from('organizations')
    .update({
      risk_score: totalScore,
      risk_tier: tier,
      risk_flags: flags,
      tariff_exposure: meta ?? null,
    })
    .eq('id', org_id)

  return NextResponse.json({
    org_id,
    risk_score: totalScore,
    risk_tier: tier,
    risk_flags: flags,
    tariff_exposure: meta ?? null,
    breakdown: {
      kyb_score:         kybScore,
      tariff_score:      tariffScore,
      performance_score: performanceScore,
      financial_score:   financialScore,
    },
  })
}
