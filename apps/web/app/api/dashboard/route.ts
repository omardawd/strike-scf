import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // ── BANK ──────────────────────────────────────────────────────────────────
  if (BANK_ROLES.includes(userData.role)) {
    let bank_name: string | null = null
    try {
      const { data: bank } = await adminClient
        .from('banks')
        .select('name')
        .eq('id', userData.bank_id)
        .single()
      bank_name = bank?.name ?? null
    } catch {}

    const [
      { count: program_count },
      { count: active_program_count },
      { count: kyb_pending },
      { data: bankPrograms },
    ] = await Promise.all([
      adminClient.from('programs').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id),
      adminClient.from('programs').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).eq('status', 'active'),
      adminClient.from('organizations').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).eq('kyb_status', 'submitted'),
      adminClient.from('programs').select('id').eq('bank_id', userData.bank_id),
    ])

    // Transactions link via program_id, not bank_id directly at early stages
    const programIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)
    let pending_bank_review = 0
    let active_transactions = 0
    let enrolled_org_count = 0

    if (programIds.length > 0) {
      const [reviewResult, activeResult, enrolledResult] = await Promise.all([
        adminClient
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .in('program_id', programIds)
          .eq('status', 'pending_bank_review'),
        adminClient
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .in('program_id', programIds)
          .in('status', ['pending_anchor_approval', 'pending_bank_review', 'financing_approved', 'funded', 'pending_supplier_counter_review']),
        adminClient
          .from('program_enrollments')
          .select('org_id', { count: 'exact', head: true })
          .in('program_id', programIds)
          .eq('status', 'active'),
      ])
      pending_bank_review = reviewResult.count ?? 0
      active_transactions = activeResult.count ?? 0
      enrolled_org_count  = enrolledResult.count ?? 0
    }

    // Suppliers at risk (red tier)
    const { data: riskOrgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, risk_tier, risk_score, risk_flags')
      .eq('bank_id', userData.bank_id)
      .eq('risk_tier', 'red')
      .not('risk_score', 'is', null)

    // Tariff-exposed volume
    const { data: tariffOrgs } = await adminClient
      .from('organizations')
      .select('id')
      .eq('bank_id', userData.bank_id)
      .contains('risk_flags', '[{"code":"tariff_exposed"}]')

    // Total outstanding funded balance
    const { data: fundedTxns } = await adminClient
      .from('transactions')
      .select('financing_amount_approved')
      .in('program_id', programIds.length > 0 ? programIds : ['__none__'])
      .eq('status', 'funded')

    const outstandingBalance = (fundedTxns ?? []).reduce(
      (sum, t) => sum + (t.financing_amount_approved ?? 0), 0
    )

    const marginAtRisk = (riskOrgs?.length ?? 0) > 0
      ? `${riskOrgs!.length} supplier${riskOrgs!.length > 1 ? 's' : ''} at risk`
      : 'No suppliers flagged'

    const { data: pendingTxns } = await adminClient
      .from('transactions')
      .select(`
        id, invoice_number, invoice_amount,
        financing_amount_requested,
        financing_rate_apr, status, created_at,
        type, supplier_id,
        organizations!transactions_supplier_id_fkey(
          legal_name, risk_tier, risk_score,
          risk_flags, performance_tier,
          country_of_origin
        )
      `)
      .in('program_id', programIds.length > 0 ? programIds : ['__none__'])
      .in('status', ['pending_bank_review', 'pending_supplier_counter_review'])
      .order('created_at', { ascending: true })

    const rankedQueue = (pendingTxns ?? [])
      .map((t: any) => {
        const org = t.organizations
        let score = 0
        score += Math.min((t.invoice_amount ?? 0) / 10000, 30)
        if (org?.risk_tier === 'red') score += 40
        else if (org?.risk_tier === 'amber') score += 20
        const flags = org?.risk_flags ?? []
        if (flags.some((f: any) => f.code === 'tariff_exposed')) score += 25
        if (org?.performance_tier === 'preferred') score += 15
        const daysWaiting = Math.floor(
          (Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24))
        score += Math.min(daysWaiting * 5, 25)
        return { ...t, priority_score: Math.round(score), days_waiting: daysWaiting }
      })
      .sort((a: any, b: any) => b.priority_score - a.priority_score)
      .slice(0, 10)

    console.log('Bank dashboard raw:', {
      kyb_pending, pending_bank_review, active_transactions,
      programIds, program_count, active_program_count, enrolled_org_count,
    })

    return NextResponse.json({
      portal: 'bank',
      bank_name,
      program_count:        program_count        ?? 0,
      active_program_count: active_program_count ?? 0,
      enrolled_org_count,
      kyb_pending:          kyb_pending          ?? 0,
      pending_bank_review,
      active_transactions,
      suppliers_at_risk:    riskOrgs?.length     ?? 0,
      tariff_exposed_count: tariffOrgs?.length   ?? 0,
      outstanding_balance:  outstandingBalance,
      margin_at_risk_label: marginAtRisk,
      at_risk_suppliers:    riskOrgs?.slice(0, 5) ?? [],
      funding_queue:        rankedQueue,
    })
  }

  // ── SHARED: org + enrolled programs ───────────────────────────────────────
  const { data: org } = await adminClient
    .from('organizations')
    .select('legal_name')
    .eq('id', userData.org_id)
    .single()

  const org_name = org?.legal_name ?? null

  const { data: enrollments } = await adminClient
    .from('program_enrollments')
    .select('program_id, programs(id, name, status, financing_types, program_limit, created_at)')
    .eq('org_id', userData.org_id)
    .eq('status', 'active')

  const programs = (enrollments ?? [])
    .map((e: Record<string, unknown>) => e.programs)
    .filter(Boolean)

  // ── ANCHOR ────────────────────────────────────────────────────────────────
  if (userData.role === 'anchor_admin' || userData.role === 'anchor_member') {
    const programIds = (programs as Array<{ id: string }>).map((p) => p.id)
    let enrolled_supplier_count = 0

    const [{ count: pendingCount }, { data: ddSavingsRows }] = await Promise.all([
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('anchor_id', userData.org_id)
        .eq('status', 'pending_anchor_approval'),
      adminClient
        .from('transactions')
        .select('discount_amount')
        .eq('anchor_id', userData.org_id)
        .eq('type', 'dynamic_discounting')
        .eq('status', 'completed'),
    ])

    const pending_approval = pendingCount ?? 0
    const dd_savings = (ddSavingsRows ?? []).reduce(
      (sum: number, t: { discount_amount: number | null }) => sum + (t.discount_amount ?? 0), 0
    )

    if (programIds.length > 0) {
      const { count: supCount } = await adminClient
        .from('program_enrollments')
        .select('org_id', { count: 'exact', head: true })
        .in('program_id', programIds)
        .eq('status', 'active')
        .neq('org_id', userData.org_id)
      enrolled_supplier_count = supCount ?? 0
    }

    return NextResponse.json({ portal: 'anchor', org_name, programs, enrolled_supplier_count, pending_approval, dd_savings })
  }

  // ── SUPPLIER ──────────────────────────────────────────────────────────────
  const [{ count: active_transactions }, { data: perfData }] = await Promise.all([
    adminClient
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('supplier_id', userData.org_id)
      .not('status', 'in', '("completed","rejected","cancelled")'),
    adminClient
      .from('supplier_performance')
      .select('*')
      .eq('org_id', userData.org_id)
      .maybeSingle(),
  ])

  return NextResponse.json({
    portal: 'supplier',
    org_name,
    programs,
    active_transactions: active_transactions ?? 0,
    performance_tier: perfData?.performance_tier ?? 'standard',
    performance_score: perfData?.performance_score ?? null,
    on_time_rate: perfData?.on_time_payment_rate ?? null,
    total_financed: perfData?.total_financed ?? 0,
  })
}
