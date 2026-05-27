import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return Math.round(n).toLocaleString('en-US')
}

function daysSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, role, bank_id')
    .eq('id', user.id)
    .single()

  if (!userRow || !BANK_ROLES.includes(userRow.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const bankId = userRow.bank_id
  const toInsert: Record<string, unknown>[] = []

  const { data: existing } = await adminClient
    .from('recommendations')
    .select('category, org_id, transaction_id')
    .eq('bank_id', bankId)
    .eq('dismissed', false)

  function isDuplicate(category: string, orgId: string | null, txnId: string | null): boolean {
    return (existing ?? []).some(r =>
      r.category === category &&
      (orgId ? r.org_id === orgId : true) &&
      (txnId ? r.transaction_id === txnId : true)
    )
  }

  // CHECK 1 — Suppliers with pending KYB > 7 days
  const { data: kybOrgs } = await adminClient
    .from('organizations')
    .select('id, legal_name, kyb_submitted_at')
    .eq('bank_id', bankId)
    .eq('kyb_status', 'submitted')
    .lt('kyb_submitted_at', new Date(Date.now() - 7 * 86_400_000).toISOString())

  for (const org of kybOrgs ?? []) {
    if (isDuplicate('kyb', org.id, null)) continue
    const days = daysSince(org.kyb_submitted_at)
    toInsert.push({
      bank_id: bankId,
      org_id: org.id,
      priority: 'high',
      category: 'kyb',
      title: 'KYB review overdue',
      body: `${org.legal_name} submitted their KYB application ${days} days ago. Review now to maintain supplier confidence.`,
      action_label: 'Review KYB',
      action_url: `/kyb/${org.id}`,
      estimated_impact: 'Unblock supplier onboarding',
    })
  }

  // CHECK 2 — Transactions pending bank review > 3 days
  const { data: bankPrograms } = await adminClient
    .from('programs')
    .select('id')
    .eq('bank_id', bankId)

  const bankProgramIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)

  if (bankProgramIds.length > 0) {
    const { data: staleTxns } = await adminClient
      .from('transactions')
      .select('id, invoice_number, financing_amount_requested, updated_at, supplier_id')
      .in('program_id', bankProgramIds)
      .eq('status', 'pending_bank_review')
      .lt('updated_at', new Date(Date.now() - 3 * 86_400_000).toISOString())

    for (const txn of staleTxns ?? []) {
      if (isDuplicate('transaction', null, txn.id)) continue

      let supplierName = 'Unknown supplier'
      if (txn.supplier_id) {
        const { data: supplier } = await adminClient
          .from('organizations')
          .select('legal_name')
          .eq('id', txn.supplier_id)
          .single()
        supplierName = supplier?.legal_name ?? supplierName
      }

      const days = daysSince(txn.updated_at)
      toInsert.push({
        bank_id: bankId,
        transaction_id: txn.id,
        priority: 'high',
        category: 'transaction',
        title: 'Financing decision overdue',
        body: `Invoice ${txn.invoice_number} from ${supplierName} has been awaiting your decision for ${days} days.`,
        action_label: 'Review transaction',
        action_url: `/transactions/${txn.id}`,
        estimated_impact: `$${fmtAmount(txn.financing_amount_requested ?? 0)} financing pending`,
      })
    }
  }

  // CHECK 3 — Enrolled suppliers with zero approved transactions > 30 days
  if (bankProgramIds.length > 0) {
    const { data: enrolledOrgs } = await adminClient
      .from('program_enrollments')
      .select('org_id, created_at, organizations(id, legal_name)')
      .in('program_id', bankProgramIds)
      .eq('status', 'active')
      .lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())

    for (const enrollment of enrolledOrgs ?? []) {
      const org = (enrollment as Record<string, unknown>).organizations as { id: string; legal_name: string } | null
      if (!org) continue

      const { count: approvedCount } = await adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('supplier_id', org.id)
        .in('program_id', bankProgramIds)
        .in('status', ['financing_approved', 'funded', 'completed'])

      if ((approvedCount ?? 0) > 0) continue
      if (isDuplicate('opportunity', org.id, null)) continue

      const days = daysSince(enrollment.created_at as string)
      toInsert.push({
        bank_id: bankId,
        org_id: org.id,
        priority: 'medium',
        category: 'opportunity',
        title: 'Untapped financing opportunity',
        body: `${org.legal_name} has been enrolled for ${days} days but hasn't accessed financing. Consider proactive outreach.`,
        action_label: 'View supplier',
        action_url: `/suppliers/${org.id}`,
        estimated_impact: 'Potential new financing volume',
      })
    }
  }

  // CHECK 4 — Programs in draft > 14 days
  const { data: draftPrograms } = await adminClient
    .from('programs')
    .select('id, name, created_at')
    .eq('bank_id', bankId)
    .eq('status', 'draft')
    .lt('created_at', new Date(Date.now() - 14 * 86_400_000).toISOString())

  for (const program of draftPrograms ?? []) {
    if (isDuplicate('program', program.id, null)) continue
    const days = daysSince(program.created_at)
    toInsert.push({
      bank_id: bankId,
      org_id: program.id,
      priority: 'medium',
      category: 'program',
      title: 'Draft program needs activation',
      body: `Program "${program.name}" has been in draft for ${days} days. Activate to start accepting transactions.`,
      action_label: 'Activate program',
      action_url: `/programs/${program.id}`,
      estimated_impact: 'Enable new financing volume',
    })
  }

  let inserted: unknown[] = []
  if (toInsert.length > 0) {
    const { data } = await adminClient
      .from('recommendations')
      .insert(toInsert)
      .select()
    inserted = data ?? []
  }

  return NextResponse.json({ generated: inserted.length, recommendations: inserted })
}
