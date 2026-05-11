import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES   = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES = ['anchor_admin', 'anchor_member']

function buildMonths(n = 6) {
  const months: Array<{ label: string; start: string; end: string }> = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const start = d.toISOString().slice(0, 10)
    const next  = new Date(d)
    next.setMonth(next.getMonth() + 1)
    months.push({
      label: d.toLocaleString('en-US', { month: 'short' }),
      start,
      end: next.toISOString().slice(0, 10),
    })
  }
  return months
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: programId } = await params
  const url        = new URL(request.url)
  const anchorId   = url.searchParams.get('anchor_id')   ?? undefined
  const supplierId = url.searchParams.get('supplier_id') ?? undefined

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id')
    .eq('id', programId)
    .single()
  if (!program) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (BANK_ROLES.includes(userData.role)) {
    if (program.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (ANCHOR_ROLES.includes(userData.role)) {
    const { data: enrollment } = await adminClient
      .from('program_enrollments')
      .select('id')
      .eq('program_id', programId)
      .eq('org_id', userData.org_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!enrollment) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else {
    const { data: enrollment } = await adminClient
      .from('program_enrollments')
      .select('id')
      .eq('program_id', programId)
      .eq('org_id', userData.org_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!enrollment) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let txQuery = adminClient
    .from('transactions')
    .select('id, invoice_amount, financing_amount_approved, status, created_at, anchor_id, supplier_id')
    .eq('program_id', programId)
  if (anchorId)   txQuery = txQuery.eq('anchor_id', anchorId)
  if (supplierId) txQuery = txQuery.eq('supplier_id', supplierId)

  const [txResult, enrollResult] = await Promise.all([
    txQuery,
    !anchorId && !supplierId && BANK_ROLES.includes(userData.role)
      ? adminClient
          .from('program_enrollments')
          .select('org_id, anchor_org_id')
          .eq('program_id', programId)
          .eq('status', 'active')
      : Promise.resolve({ data: [] as Array<{ org_id: string; anchor_org_id: string | null }> }),
  ])

  const txns        = txResult.data ?? []
  const enrollments = enrollResult.data ?? []

  const total_transactions   = txns.length
  const total_invoice_amount = txns.reduce((s, t) => s + (t.invoice_amount ?? 0), 0)
  const total_financed       = txns.reduce((s, t) => s + (t.financing_amount_approved ?? 0), 0)
  const total_completed      = txns.filter(t => t.status === 'completed').length
  const total_funded         = txns.filter(t => t.status === 'funded').length
  const total_pending        = txns.filter(t =>
    ['pending_anchor_approval', 'pending_bank_review', 'more_info_requested'].includes(t.status)
  ).length

  let active_anchors   = 0
  let active_suppliers = 0
  let supplier_count   = 0

  if (!anchorId && !supplierId) {
    const anchorSet   = new Set<string>()
    const supplierSet = new Set<string>()
    for (const e of enrollments) {
      if (e.anchor_org_id) anchorSet.add(e.anchor_org_id)
      if (e.org_id && e.anchor_org_id && e.org_id !== e.anchor_org_id) supplierSet.add(e.org_id)
    }
    active_anchors   = anchorSet.size
    active_suppliers = supplierSet.size
  } else if (anchorId && !supplierId) {
    const supplierSet = new Set(txns.map(t => t.supplier_id).filter(Boolean))
    supplier_count   = supplierSet.size
    active_anchors   = 1
  } else {
    active_anchors   = 1
    active_suppliers = 1
  }

  const months = buildMonths(6)
  const monthly_volume = months.map(m => {
    const slice = txns.filter(t => t.created_at >= m.start && t.created_at < m.end)
    return {
      label: m.label,
      count: slice.length,
      value: slice.reduce((s, t) => s + (t.invoice_amount ?? 0), 0),
    }
  })

  return NextResponse.json({
    total_transactions,
    total_invoice_amount,
    total_financed,
    total_completed,
    total_funded,
    total_pending,
    active_anchors,
    active_suppliers,
    ...(anchorId && !supplierId ? { supplier_count } : {}),
    avg_financing_rate: 0,
    monthly_volume,
  })
}
