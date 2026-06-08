import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// TC.4 — program-first / deal-sourcing data for the bank program detail page.
// Returns:
//  - linked_deals:    marketplace transactions attached to this program (the bank has
//                     a funded/active offer) — populated when a financing offer is
//                     accepted (see /api/marketplace/financing/[id]/accept).
//  - offer_pipeline:  this bank's still-pending financing-request offers whose structure
//                     type + currency match the program (in-flight, not yet accepted).
//  - capacity:        program_limit, committed (sum of approved/funded), available.

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!BANK_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Scope: program must belong to this bank.
  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id, financing_types, currency, program_limit')
    .eq('id', id)
    .eq('bank_id', userData.bank_id)
    .single()
  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  // ── Linked deals — marketplace transactions on this program (bank-scoped) ──
  const { data: linkedTxns } = await adminClient
    .from('transactions')
    .select('id, deal_id, supplier_id, anchor_id, type, financing_amount_approved, financing_rate_apr, tenor_days, status, invoice_amount, created_at')
    .eq('program_id', id)
    .eq('bank_id', userData.bank_id)
    .eq('source', 'marketplace')
    .order('created_at', { ascending: false })

  // Enrich linked deals with counterparty names.
  const orgIds = [...new Set((linkedTxns ?? []).flatMap((t: any) => [t.supplier_id, t.anchor_id]).filter(Boolean))]
  const orgNameMap: Record<string, string> = {}
  if (orgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name')
      .in('id', orgIds)
    for (const o of orgs ?? []) orgNameMap[o.id] = o.legal_name
  }

  const linked_deals = (linkedTxns ?? []).map((t: any) => ({
    id: t.id,
    deal_id: t.deal_id,
    type: t.type,
    counterparty: orgNameMap[t.supplier_id] ?? orgNameMap[t.anchor_id] ?? 'Counterparty',
    amount: t.financing_amount_approved ?? t.invoice_amount ?? 0,
    rate_apr: t.financing_rate_apr,
    tenor_days: t.tenor_days,
    status: t.status,
    created_at: t.created_at,
  }))

  // Committed capacity = approved/funded marketplace + non-marketplace transactions on this program.
  const { data: committedTxns } = await adminClient
    .from('transactions')
    .select('financing_amount_approved')
    .eq('program_id', id)
    .in('status', ['financing_approved', 'funded', 'pending_delivery_confirmation', 'delivery_confirmed', 'repayment_due'])

  const committed = (committedTxns ?? []).reduce((s: number, t: any) => s + (t.financing_amount_approved ?? 0), 0)
  const program_limit = program.program_limit ?? null
  const available = program_limit != null ? Math.max(0, program_limit - committed) : null

  // ── Offer pipeline — this bank's pending financing offers matching the program ──
  const programCurrency = program.currency ?? 'USD'
  const programTypes: string[] = Array.isArray(program.financing_types) ? program.financing_types : []

  const { data: pendingOffers } = await adminClient
    .from('financing_request_offers')
    .select('id, request_id, offered_rate_apr, offered_amount, offered_tenor_days, structure_type, status, submitted_at')
    .eq('bank_id', userData.bank_id)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })

  // Filter to offers whose structure type matches the program; cross-check request currency.
  const reqIds = [...new Set((pendingOffers ?? []).map((o: any) => o.request_id))]
  const reqCurrencyMap: Record<string, string> = {}
  if (reqIds.length > 0) {
    const { data: reqs } = await adminClient
      .from('financing_requests')
      .select('id, currency')
      .in('id', reqIds)
    for (const r of reqs ?? []) reqCurrencyMap[r.id] = r.currency ?? 'USD'
  }

  const offer_pipeline = (pendingOffers ?? [])
    .filter((o: any) =>
      programTypes.includes(o.structure_type) &&
      (reqCurrencyMap[o.request_id] ?? 'USD') === programCurrency
    )
    .map((o: any) => ({
      id: o.id,
      request_id: o.request_id,
      rate_apr: o.offered_rate_apr,
      amount: o.offered_amount,
      tenor_days: o.offered_tenor_days,
      structure_type: o.structure_type,
      submitted_at: o.submitted_at,
    }))

  return NextResponse.json({
    linked_deals,
    offer_pipeline,
    capacity: {
      program_limit,
      committed,
      available,
      currency: programCurrency,
    },
  })
}
