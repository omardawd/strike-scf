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
      { count: pending_bank_review },
      { count: active_transactions },
      { data: bankPrograms },
    ] = await Promise.all([
      adminClient.from('programs').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id),
      adminClient.from('programs').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).eq('status', 'active'),
      adminClient.from('organizations').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).eq('kyb_status', 'submitted'),
      adminClient.from('transactions').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).eq('status', 'pending_bank_review'),
      adminClient.from('transactions').select('*', { count: 'exact', head: true }).eq('bank_id', userData.bank_id).in('status', ['pending_anchor_approval', 'pending_bank_review', 'financing_approved', 'funded']),
      adminClient.from('programs').select('id').eq('bank_id', userData.bank_id),
    ])

    const programIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)
    let enrolled_org_count = 0
    if (programIds.length > 0) {
      const { count: enrolledCount } = await adminClient
        .from('program_enrollments')
        .select('org_id', { count: 'exact', head: true })
        .in('program_id', programIds)
        .eq('status', 'active')
      enrolled_org_count = enrolledCount ?? 0
    }

    return NextResponse.json({
      portal: 'bank',
      bank_name,
      program_count:        program_count        ?? 0,
      active_program_count: active_program_count ?? 0,
      enrolled_org_count,
      kyb_pending:          kyb_pending          ?? 0,
      pending_bank_review:  pending_bank_review  ?? 0,
      active_transactions:  active_transactions  ?? 0,
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
    .select('program_id, programs(id, name, financing_types, status, standard_tenor_days)')
    .eq('org_id', userData.org_id)
    .eq('status', 'active')

  const programs = (enrollments ?? [])
    .map((e: Record<string, unknown>) => e.programs)
    .filter(Boolean)

  // ── ANCHOR ────────────────────────────────────────────────────────────────
  if (userData.role === 'anchor_admin' || userData.role === 'anchor_member') {
    const programIds = (programs as Array<{ id: string }>).map((p) => p.id)
    let enrolled_supplier_count = 0

    // Count pending approval directly by anchor_id — no program_id gate
    const { count: pendingCount } = await adminClient
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('anchor_id', userData.org_id)
      .eq('status', 'pending_anchor_approval')

    const pending_approval = pendingCount ?? 0

    if (programIds.length > 0) {
      const { count: supCount } = await adminClient
        .from('program_enrollments')
        .select('org_id', { count: 'exact', head: true })
        .in('program_id', programIds)
        .eq('status', 'active')
        .neq('org_id', userData.org_id)
      enrolled_supplier_count = supCount ?? 0
    }

    return NextResponse.json({ portal: 'anchor', org_name, programs, enrolled_supplier_count, pending_approval })
  }

  // ── SUPPLIER ──────────────────────────────────────────────────────────────
  const { count: active_transactions } = await adminClient
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('supplier_id', userData.org_id)
    .not('status', 'in', '("completed","rejected","cancelled")')

  return NextResponse.json({ portal: 'supplier', org_name, programs, active_transactions: active_transactions ?? 0 })
}
