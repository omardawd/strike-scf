import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function buildMonths(): { label: string; year: number; month: number }[] {
  const now = new Date()
  const months: { label: string; year: number; month: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      year:  d.getFullYear(),
      month: d.getMonth(),
    })
  }
  return months
}

export async function GET() {
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

    // Get program IDs for this bank — transactions link via program_id, not bank_id directly at early stages
    const { data: bankPrograms } = await adminClient
      .from('programs')
      .select('id')
      .eq('bank_id', bankId)

    const programIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)
    console.log('Bank reporting — bankId:', bankId, 'programIds:', programIds)

    if (programIds.length === 0) {
      const emptyMonths = buildMonths().map(m => ({ label: m.label, count: 0, volume: 0 }))
      return NextResponse.json({
        role: 'bank',
        monthly_volume:   emptyMonths,
        status_breakdown: [],
        top_suppliers:    [],
        portfolio:        { active_deals: 0, outstanding_balance: 0, total_repaid: 0, avg_rate: null, total_transactions: 0 },
      })
    }

    // Fetch all transactions for this bank's programs
    const [txnResult, supplierResult] = await Promise.all([
      adminClient
        .from('transactions')
        .select('id, status, financing_amount_approved, financing_amount_requested, apr, created_at, repaid_at, supplier_id, supplier_name')
        .in('program_id', programIds),
      adminClient
        .from('transactions')
        .select('supplier_id, supplier_name, financing_amount_approved, status')
        .in('program_id', programIds)
        .not('financing_amount_approved', 'is', null),
    ])

    const txns = txnResult.data ?? []

    // ── Monthly volume (last 6 months) ──
    const months = buildMonths()
    const monthlyMap = new Map<string, { count: number; volume: number }>()
    for (const m of months) monthlyMap.set(`${m.year}-${m.month}`, { count: 0, volume: 0 })
    for (const t of txns) {
      const d = new Date(t.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const bucket = monthlyMap.get(key)
      if (bucket) {
        bucket.count += 1
        bucket.volume += t.financing_amount_approved ?? t.financing_amount_requested ?? 0
      }
    }
    const monthly_volume = months.map(m => ({
      label:  m.label,
      count:  monthlyMap.get(`${m.year}-${m.month}`)!.count,
      volume: monthlyMap.get(`${m.year}-${m.month}`)!.volume,
    }))

    // ── Status breakdown ──
    const statusMap = new Map<string, number>()
    for (const t of txns) statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1)
    const status_breakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)
    console.log('Bank status_breakdown:', status_breakdown, 'total txns:', txns.length)

    // ── Top suppliers ──
    const supplierTxns = supplierResult.data ?? []
    const supplierMap = new Map<string, { name: string; total: number; count: number }>()
    for (const t of supplierTxns) {
      if (!t.supplier_id) continue
      const existing = supplierMap.get(t.supplier_id)
      if (existing) {
        existing.total += t.financing_amount_approved ?? 0
        existing.count += 1
      } else {
        supplierMap.set(t.supplier_id, {
          name:  t.supplier_name ?? t.supplier_id,
          total: t.financing_amount_approved ?? 0,
          count: 1,
        })
      }
    }
    const top_suppliers = Array.from(supplierMap.entries())
      .map(([id, v]) => ({ id, name: v.name, total_financed: v.total, deal_count: v.count }))
      .sort((a, b) => b.total_financed - a.total_financed)
      .slice(0, 5)

    // ── Portfolio summary ──
    const activeDealStatuses = new Set(['pending_anchor_approval', 'pending_bank_review', 'more_info_requested', 'financing_approved', 'funded'])
    let active_deals = 0, outstanding_balance = 0, total_repaid = 0, rateSum = 0, rateCount = 0
    for (const t of txns) {
      if (activeDealStatuses.has(t.status)) {
        active_deals += 1
        outstanding_balance += t.financing_amount_approved ?? 0
      }
      if (t.status === 'completed') total_repaid += t.financing_amount_approved ?? 0
      if (t.apr != null) { rateSum += t.apr; rateCount += 1 }
    }
    const avg_rate = rateCount > 0 ? parseFloat((rateSum / rateCount).toFixed(2)) : null

    return NextResponse.json({
      role: 'bank',
      monthly_volume,
      status_breakdown,
      top_suppliers,
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
        .eq('status', 'active'),
      adminClient
        .from('transactions')
        .select('id, status, invoice_amount, created_at, supplier_id, supplier_name')
        .eq('anchor_id', orgId),
    ])

    const enrolled_programs = enrolledResult.count ?? 0
    const txns = txnResult.data ?? []
    console.log('Anchor reporting — orgId:', orgId, 'txn count:', txns.length, 'statuses:', txns.map(t => t.status))

    // Monthly volume
    const months = buildMonths()
    const monthlyMap = new Map<string, { count: number; volume: number }>()
    for (const m of months) monthlyMap.set(`${m.year}-${m.month}`, { count: 0, volume: 0 })
    for (const t of txns) {
      const d = new Date(t.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const bucket = monthlyMap.get(key)
      if (bucket) {
        bucket.count += 1
        bucket.volume += t.invoice_amount ?? 0
      }
    }
    const monthly_volume = months.map(m => ({
      label:                m.label,
      count:                monthlyMap.get(`${m.year}-${m.month}`)!.count,
      total_invoice_amount: monthlyMap.get(`${m.year}-${m.month}`)!.volume,
    }))

    // Payables summary
    const payablesMap: Record<string, { count: number; total: number }> = {}
    for (const t of txns) {
      if (payablesMap[t.status]) {
        payablesMap[t.status]!.count += 1
        payablesMap[t.status]!.total += t.invoice_amount ?? 0
      } else {
        payablesMap[t.status] = {
          count: 1,
          total: t.invoice_amount ?? 0,
        }
      }
    }

    // Top suppliers by invoice volume
    const supplierMap = new Map<string, { name: string; count: number; volume: number }>()
    for (const t of txns) {
      if (!t.supplier_id) continue
      const existing = supplierMap.get(t.supplier_id)
      if (existing) {
        existing.count += 1
        existing.volume += t.invoice_amount ?? 0
      } else {
        supplierMap.set(t.supplier_id, {
          name:   t.supplier_name ?? t.supplier_id,
          count:  1,
          volume: t.invoice_amount ?? 0,
        })
      }
    }
    const top_suppliers = Array.from(supplierMap.values())
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5)
      .map(s => ({
        legal_name:        s.name,
        transaction_count: s.count,
        total_volume:      parseFloat(s.volume.toFixed(2)),
      }))

    return NextResponse.json({
      role: 'anchor',
      enrolled_programs,
      monthly_volume,
      payables_summary: payablesMap,
      top_suppliers,
    })
  }

  // ── SUPPLIER ──────────────────────────────────────────────────────────────
  if (profile.role.startsWith('supplier')) {
    const orgId = profile.org_id
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

    const [enrolledResult, txnResult] = await Promise.all([
      adminClient
        .from('program_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
      adminClient
        .from('transactions')
        .select('id, invoice_number, status, invoice_amount, financing_amount_approved, apr, fee_amount, created_at')
        .eq('supplier_id', orgId)
        .order('created_at', { ascending: false }),
    ])

    const enrolled_programs = enrolledResult.count ?? 0
    const txns = txnResult.data ?? []

    // Monthly volume
    const months = buildMonths()
    const monthlyMap = new Map<string, { count: number; financed: number }>()
    for (const m of months) monthlyMap.set(`${m.year}-${m.month}`, { count: 0, financed: 0 })
    for (const t of txns) {
      const d = new Date(t.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const bucket = monthlyMap.get(key)
      if (bucket) {
        bucket.count   += 1
        bucket.financed += t.financing_amount_approved ?? 0
      }
    }
    const monthly_volume = months.map(m => ({
      label:          m.label,
      count:          monthlyMap.get(`${m.year}-${m.month}`)!.count,
      total_financed: monthlyMap.get(`${m.year}-${m.month}`)!.financed,
    }))

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
      if (t.apr != null)       { rateSum += t.apr; rateCount += 1 }
      if (t.fee_amount != null) total_fees_paid += t.fee_amount
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
    })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
