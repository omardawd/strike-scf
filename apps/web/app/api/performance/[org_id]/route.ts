import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getBankIdForSupplier(orgId: string, client: typeof adminClient) {
  const { data: org } = await client
    .from('organizations')
    .select('bank_id')
    .eq('id', orgId)
    .maybeSingle()
  if (org?.bank_id) return org.bank_id

  const { data } = await client
    .from('program_enrollments')
    .select('programs(bank_id)')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle()
  return (data?.programs as unknown as { bank_id: string } | null)?.bank_id ?? null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  console.log('[performance] fetching for org:', org_id, 'user role:', userRow.role)

  const isBank = userRow.role === 'bank_admin' || userRow.role === 'bank_credit_officer'
  const isOrgUser = userRow.role === 'org_admin' || userRow.role === 'org_member'
  const isOwnOrg = isOrgUser && userRow.org_id === org_id

  let isAnchor = false
  if (isOrgUser && !isOwnOrg) {
    // Determine if the caller is an anchor org
    const { data: callerOrgRow } = await adminClient.from('organizations').select('type').eq('id', userRow.org_id).single()
    isAnchor = callerOrgRow?.type === 'anchor'
  }

  if (!isBank && !isOwnOrg && !isAnchor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Anchor must have this supplier enrolled in one of their programs
  if (isAnchor) {
    const { data: enrollment } = await adminClient
      .from('program_enrollments')
      .select('id')
      .eq('anchor_org_id', userRow.org_id)
      .eq('org_id', org_id)
      .maybeSingle()
    if (!enrollment) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data: txns } = await adminClient
    .from('transactions')
    .select('id, status, created_at, updated_at, financing_amount_approved, financing_rate_apr, invoice_amount, invoice_due_date')
    .eq('supplier_id', org_id)
    .not('status', 'in', '("draft","cancelled")')

  console.log('[performance] txns found:', txns?.length, 'for org:', org_id)

  const total = txns?.length ?? 0

  const completed = txns?.filter(t => t.status === 'completed') ?? []
  const onTime = completed.filter(t => {
    if (!t.invoice_due_date) return true
    return new Date(t.updated_at) <= new Date(t.invoice_due_date)
  })
  const onTimeRate = completed.length > 0
    ? Math.round((onTime.length / completed.length) * 100)
    : null

  const disputed = txns?.filter(t => t.status === 'in_dispute') ?? []
  const disputeRate = total > 0
    ? Math.round((disputed.length / total) * 100)
    : null

  const financed = txns?.filter(t =>
    ['funded', 'completed', 'repayment_due'].includes(t.status)
  ) ?? []
  const utilizationRate = total > 0
    ? Math.round((financed.length / total) * 100)
    : null

  const ratedTxns = txns?.filter(t => t.financing_rate_apr) ?? []
  const avgRate = ratedTxns.length > 0
    ? Math.round(
        ratedTxns.reduce((s, t) => s + t.financing_rate_apr, 0) /
        ratedTxns.length * 10
      ) / 10
    : null

  const totalFinanced = financed.reduce(
    (s, t) => s + (t.financing_amount_approved ?? 0), 0
  )

  let score = 0
  let components = 0

  if (onTimeRate !== null) {
    score += onTimeRate * 0.4
    components++
  }
  if (disputeRate !== null) {
    score += (100 - disputeRate) * 0.3
    components++
  }
  if (utilizationRate !== null) {
    score += Math.min(utilizationRate, 100) * 0.3
    components++
  }

  const performanceScore = components > 0 ? Math.round(score) : null

  let tier = 'standard'
  if (performanceScore !== null) {
    if (performanceScore >= 80) tier = 'preferred'
    else if (performanceScore < 40) tier = 'under_review'
  }
  if (total === 0) tier = 'standard'

  const bankId =
    userRow.bank_id ?? (await getBankIdForSupplier(org_id, adminClient))

  if (bankId) {
    await adminClient
      .from('supplier_performance')
      .upsert(
        {
          org_id: org_id,
          bank_id: bankId,
          on_time_payment_rate: onTimeRate,
          dispute_rate: disputeRate,
          financing_utilization_rate: utilizationRate,
          avg_advance_rate: avgRate,
          total_transactions: total,
          total_financed: totalFinanced,
          performance_tier: tier,
          performance_score: performanceScore,
          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,bank_id' }
      )
  }

  await adminClient
    .from('organizations')
    .update({ performance_tier: tier })
    .eq('id', org_id)

  return NextResponse.json({
    org_id: org_id,
    performance_score: performanceScore,
    performance_tier: tier,
    metrics: {
      on_time_payment_rate: onTimeRate,
      dispute_rate: disputeRate,
      financing_utilization_rate: utilizationRate,
      avg_advance_rate: avgRate,
      total_transactions: total,
      total_financed: totalFinanced,
    },
    last_calculated_at: new Date().toISOString(),
  })
}
