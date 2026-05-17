import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Period = 'daily' | 'weekly' | 'monthly'
type Bucket = { label: string; start: Date; end: Date }

function buildBuckets(period: Period): Bucket[] {
  const now = new Date()
  if (period === 'daily') {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (29 - i))
      d.setHours(0, 0, 0, 0)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, start: d, end }
    })
  }
  if (period === 'weekly') {
    return Array.from({ length: 12 }, (_, i) => {
      const end = new Date(now)
      end.setDate(end.getDate() - (11 - i) * 7)
      end.setHours(23, 59, 59, 999)
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return { label: `Wk ${i + 1}`, start, end }
    })
  }
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1)
    return { label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), start: d, end }
  })
}

async function fetchOrgNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await adminClient
    .from('organizations')
    .select('id, legal_name')
    .in('id', ids)
  return new Map((data ?? []).map((o: { id: string; legal_name: string }) => [o.id, o.legal_name]))
}

export async function GET(request: Request) {
  const url    = new URL(request.url)
  const period = (url.searchParams.get('period') ?? 'monthly') as Period

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await adminClient
    .from('users')
    .select('role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // ── BANK ──────────────────────────────────────────────────────────────────
  if (profile.role.startsWith('bank')) {
    const bankId = profile.bank_id

    const { data: bankPrograms } = await adminClient
      .from('programs')
      .select('id, name')
      .eq('bank_id', bankId)

    const programIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)

    if (programIds.length === 0) {
      const emptyMonths = buildBuckets(period).map(b => ({ label: b.label, count: 0, volume: 0 }))
      return NextResponse.json({
        role: 'bank',
        monthly_volume:   emptyMonths,
        status_breakdown: [],
        top_suppliers:    [],
        portfolio: { active_deals: 0, outstanding_balance: 0, total_repaid: 0, avg_rate: null, total_transactions: 0 },
      })
    }

    const [txnResult, supplierTxnResult] = await Promise.all([
      adminClient
        .from('transactions')
        .select('id, status, financing_amount_approved, financing_amount_requested, financing_rate_apr, created_at, repaid_at, supplier_id, program_id')
        .in('program_id', programIds),
      adminClient
        .from('transactions')
        .select('supplier_id, financing_amount_approved, status')
        .in('program_id', programIds)
        .not('financing_amount_approved', 'is', null),
    ])

    const txns         = txnResult.data         ?? []
    const supplierTxns = supplierTxnResult.data  ?? []

    // ── Volume by period ──
    const buckets = buildBuckets(period)
    const monthly_volume = buckets.map(b => {
      const slice = txns.filter(t => {
        const d = new Date(t.created_at)
        return d >= b.start && d < b.end
      })
      return {
        label:  b.label,
        count:  slice.length,
        volume: slice.reduce((s, t) => s + (t.financing_amount_approved ?? t.financing_amount_requested ?? 0), 0),
      }
    })

    // ── Status breakdown ──
    const statusMap = new Map<string, number>()
    for (const t of txns) statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1)
    const status_breakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // ── Top suppliers ──
    const supplierVolMap = new Map<string, { total: number; count: number }>()
    for (const t of supplierTxns) {
      if (!t.supplier_id) continue
      const existing = supplierVolMap.get(t.supplier_id)
      if (existing) {
        existing.total += t.financing_amount_approved ?? 0
        existing.count += 1
      } else {
        supplierVolMap.set(t.supplier_id, { total: t.financing_amount_approved ?? 0, count: 1 })
      }
    }
    const sortedSupplierIds = Array.from(supplierVolMap.keys())
      .sort((a, b) => supplierVolMap.get(b)!.total - supplierVolMap.get(a)!.total)
      .slice(0, 5)
    const orgNames = await fetchOrgNames(sortedSupplierIds)
    const top_suppliers = sortedSupplierIds.map(id => ({
      id,
      name:           orgNames.get(id) ?? id,
      total_financed: parseFloat((supplierVolMap.get(id)!.total).toFixed(2)),
      deal_count:     supplierVolMap.get(id)!.count,
    }))

    // ── Portfolio summary ──
    const activeDealStatuses = new Set([
      'pending_anchor_approval', 'pending_bank_review', 'more_info_requested',
      'financing_approved', 'funded', 'pending_supplier_counter_review',
    ])
    let active_deals = 0, outstanding_balance = 0, total_repaid = 0, rateSum = 0, rateCount = 0
    for (const t of txns) {
      if (activeDealStatuses.has(t.status)) {
        active_deals        += 1
        outstanding_balance += t.financing_amount_approved ?? 0
      }
      if (t.status === 'completed') total_repaid += t.financing_amount_approved ?? 0
      if (t.financing_rate_apr != null) { rateSum += t.financing_rate_apr; rateCount += 1 }
    }
    const avg_rate = rateCount > 0 ? parseFloat((rateSum / rateCount).toFixed(2)) : null

    const programNameMap = new Map((bankPrograms ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
    const programVolMap = new Map<string, { name: string; volume: number }>()
    for (const t of txns) {
      if (!t.program_id) continue
      const name = programNameMap.get(t.program_id) ?? t.program_id
      const cur = programVolMap.get(t.program_id) ?? { name, volume: 0 }
      cur.volume += t.financing_amount_approved ?? 0
      programVolMap.set(t.program_id, cur)
    }
    const program_breakdown = Array.from(programVolMap.values())
      .sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      role: 'bank',
      monthly_volume,
      status_breakdown,
      top_suppliers,
      program_breakdown,
      portfolio: {
        active_deals,
        outstanding_balance: parseFloat(outstanding_balance.toFixed(2)),
        total_repaid:        parseFloat(total_repaid.toFixed(2)),
        avg_rate,
        total_transactions:  txns.length,
      },
    })
  }

  // ── ANCHOR ────────────────────────────────────────────────────────────────
  if (profile.role.startsWith('anchor')) {
    const orgId = profile.org_id
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

    const [enrolledResult, txnResult] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['active', 'invited', 'onboarding']),
      adminClient
        .from('transactions')
        .select('id, status, invoice_amount, created_at, supplier_id, program_id')
        .eq('anchor_id', orgId),
    ])

    const enrolled_programs = enrolledResult.count ?? 0
    const txns = txnResult.data ?? []

    // Resolve program names from transaction program_ids
    const txnProgramIds = [...new Set(txns.map((t: { program_id: string }) => t.program_id).filter(Boolean))]
    const anchorProgramData: Array<{ id: string; name: string }> = txnProgramIds.length > 0
      ? ((await adminClient.from('programs').select('id, name').in('id', txnProgramIds)).data ?? [])
      : []
    const anchorProgramNameMap = new Map(anchorProgramData.map(p => [p.id, p.name]))

    // Volume by period
    const anchorBuckets = buildBuckets(period)
    const monthly_volume = anchorBuckets.map(b => {
      const slice = txns.filter(t => {
        const d = new Date(t.created_at)
        return d >= b.start && d < b.end
      })
      return {
        label:                b.label,
        count:                slice.length,
        total_invoice_amount: slice.reduce((s, t) => s + (t.invoice_amount ?? 0), 0),
      }
    })

    // Payables summary
    const payablesMap: Record<string, { count: number; total: number }> = {}
    for (const t of txns) {
      if (payablesMap[t.status]) {
        payablesMap[t.status]!.count += 1
        payablesMap[t.status]!.total += t.invoice_amount ?? 0
      } else {
        payablesMap[t.status] = { count: 1, total: t.invoice_amount ?? 0 }
      }
    }

    // Top suppliers
    const supplierMap = new Map<string, { count: number; volume: number }>()
    for (const t of txns) {
      if (!t.supplier_id) continue
      const existing = supplierMap.get(t.supplier_id)
      if (existing) {
        existing.count  += 1
        existing.volume += t.invoice_amount ?? 0
      } else {
        supplierMap.set(t.supplier_id, { count: 1, volume: t.invoice_amount ?? 0 })
      }
    }
    const sortedSupplierIds = Array.from(supplierMap.keys())
      .sort((a, b) => supplierMap.get(b)!.volume - supplierMap.get(a)!.volume)
      .slice(0, 5)
    const orgNames = await fetchOrgNames(sortedSupplierIds)
    const top_suppliers = sortedSupplierIds.map(id => ({
      legal_name:        orgNames.get(id) ?? id,
      transaction_count: supplierMap.get(id)!.count,
      total_volume:      parseFloat((supplierMap.get(id)!.volume).toFixed(2)),
    }))

    const anchorProgramVolMap = new Map<string, { name: string; volume: number }>()
    for (const t of txns) {
      if (!t.program_id) continue
      const name = anchorProgramNameMap.get(t.program_id) ?? t.program_id
      const cur = anchorProgramVolMap.get(t.program_id) ?? { name, volume: 0 }
      cur.volume += t.invoice_amount ?? 0
      anchorProgramVolMap.set(t.program_id, cur)
    }
    const anchor_program_breakdown = Array.from(anchorProgramVolMap.values()).sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      role: 'anchor',
      enrolled_programs,
      monthly_volume,
      payables_summary: payablesMap,
      top_suppliers,
      program_breakdown: anchor_program_breakdown,
    })
  }

  // ── SUPPLIER ──────────────────────────────────────────────────────────────
  if (profile.role.startsWith('supplier')) {
    const orgId = profile.org_id
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

    const [enrolledResult, txnResult, supplierProgramsResult] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
      adminClient
        .from('transactions')
        .select('id, invoice_number, status, invoice_amount, financing_amount_approved, financing_rate_apr, fee_amount, created_at, program_id')
        .eq('supplier_id', orgId)
        .order('created_at', { ascending: false }),
      adminClient
        .from('programs')
        .select('id, name')
        .in('id',
          (await adminClient
            .from('program_enrollments')
            .select('program_id')
            .eq('org_id', orgId)
            .eq('status', 'active')
          ).data?.map((e: { program_id: string }) => e.program_id) ?? []
        ),
    ])

    const enrolled_programs = enrolledResult.count ?? 0
    const txns = txnResult.data ?? []

    // Volume by period
    const supplierBuckets = buildBuckets(period)
    const monthly_volume = supplierBuckets.map(b => {
      const slice = txns.filter(t => {
        const d = new Date(t.created_at)
        return d >= b.start && d < b.end
      })
      return {
        label:          b.label,
        count:          slice.length,
        total_financed: slice.reduce((s, t) => s + (t.financing_amount_approved ?? 0), 0),
      }
    })

    // Receivables summary
    let outstanding_count = 0, outstanding_balance = 0
    let approved_count = 0, approved_balance = 0
    let rateSum = 0, rateCount = 0, total_fees_paid = 0

    for (const t of txns) {
      if (t.status === 'funded') {
        outstanding_count   += 1
        outstanding_balance += t.financing_amount_approved ?? 0
      }
      if (t.status === 'financing_approved') {
        approved_count   += 1
        approved_balance += t.financing_amount_approved ?? 0
      }
      if (t.financing_rate_apr != null) { rateSum += t.financing_rate_apr; rateCount += 1 }
      if (t.fee_amount != null)          total_fees_paid += t.fee_amount
    }

    const avg_rate = rateCount > 0 ? parseFloat((rateSum / rateCount).toFixed(2)) : null

    const recent_transactions = txns.slice(0, 5).map(t => ({
      id:                        t.id,
      invoice_number:            t.invoice_number,
      invoice_amount:            t.invoice_amount,
      financing_amount_approved: t.financing_amount_approved,
      status:                    t.status,
      created_at:                t.created_at,
    }))

    const acceptedStatuses = new Set(['financing_approved', 'funded', 'completed'])
    const accepted_count = txns.filter(t => acceptedStatuses.has(t.status)).length
    const acceptance_rate = txns.length > 0 ? parseFloat((accepted_count / txns.length * 100).toFixed(1)) : null

    const supplierProgramNameMap = new Map((supplierProgramsResult.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
    const supplierProgramVolMap = new Map<string, { name: string; volume: number }>()
    for (const t of txns) {
      if (!t.program_id) continue
      const name = supplierProgramNameMap.get(t.program_id) ?? t.program_id
      const cur = supplierProgramVolMap.get(t.program_id) ?? { name, volume: 0 }
      cur.volume += t.financing_amount_approved ?? 0
      supplierProgramVolMap.set(t.program_id, cur)
    }
    const supplier_program_breakdown = Array.from(supplierProgramVolMap.values()).sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      role: 'supplier',
      enrolled_programs,
      monthly_volume,
      receivables: {
        outstanding_count,
        outstanding_balance: parseFloat(outstanding_balance.toFixed(2)),
        approved_count,
        approved_balance:    parseFloat(approved_balance.toFixed(2)),
        avg_rate,
        total_fees_paid:     parseFloat(total_fees_paid.toFixed(2)),
      },
      recent_transactions,
      acceptance_rate,
      program_breakdown: supplier_program_breakdown,
    })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
