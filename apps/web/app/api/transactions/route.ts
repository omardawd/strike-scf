import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ORG_ROLES  = ['org_admin', 'org_member']
const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  let query = adminClient
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })

  if (ORG_ROLES.includes(userData.role)) {
    if (!userData.org_id) return NextResponse.json({ transactions: [] })
    // Look up org type to scope transactions correctly
    const { data: txnOrgRow } = await adminClient.from('organizations').select('type').eq('id', userData.org_id).single()
    if (txnOrgRow?.type === 'anchor') {
      query = query.eq('anchor_id', userData.org_id)
    } else {
      query = query.eq('supplier_id', userData.org_id)
    }
  } else if (BANK_ROLES.includes(userData.role)) {
    if (!userData.bank_id) return NextResponse.json({ transactions: [] })
    query = query.eq('bank_id', userData.bank_id)
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: transactions, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })

  return NextResponse.json({ transactions: transactions ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!ORG_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!userData.org_id) {
    return NextResponse.json({ error: 'Supplier organization not set up' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    program_id,
    invoice_number,
    invoice_date,
    invoice_due_date,
    invoice_amount,
    financing_amount_requested,
    goods_services_description,
    discount_rate,
    early_payment_date,
    discount_amount,
  } = body

  if (!program_id || !invoice_number || !invoice_date || !invoice_amount || !financing_amount_requested || !goods_services_description) {
    return NextResponse.json(
      { error: 'Missing required fields: program_id, invoice_number, invoice_date, invoice_amount, financing_amount_requested, goods_services_description' },
      { status: 400 }
    )
  }

  const invoiceAmt   = Number(invoice_amount)
  const financingAmt = Number(financing_amount_requested)

  if (isNaN(invoiceAmt) || isNaN(financingAmt)) {
    return NextResponse.json({ error: 'invoice_amount and financing_amount_requested must be numbers' }, { status: 400 })
  }

  if (financingAmt > invoiceAmt) {
    return NextResponse.json({ error: 'financing_amount_requested cannot exceed invoice_amount' }, { status: 400 })
  }

  // Verify supplier is enrolled and get anchor_org_id
  let enrollment: { program_id: string; org_id: string; anchor_org_id: string; status: string } | null = null

  const { data: existingEnroll } = await adminClient
    .from('program_enrollments')
    .select('program_id, org_id, anchor_org_id, status')
    .eq('program_id', program_id as string)
    .eq('org_id', userData.org_id)
    .eq('status', 'active')
    .maybeSingle()

  enrollment = existingEnroll

  if (!enrollment) {
    const { data: inv } = await adminClient
      .from('invitations')
      .select('anchor_org_id')
      .eq('program_id', program_id as string)
      .eq('email', user.email!)
      .eq('status', 'accepted')
      .maybeSingle()

    if (inv?.anchor_org_id) {
      const { data: created } = await adminClient
        .from('program_enrollments')
        .insert({
          program_id:          program_id as string,
          org_id:              userData.org_id,
          anchor_org_id:       inv.anchor_org_id,
          enrolled_by_user_id: user.id,
          status:              'active',
          enrolled_at:         new Date().toISOString(),
        })
        .select('program_id, org_id, anchor_org_id, status')
        .single()
      enrollment = created
    }
  }

  if (!enrollment) {
    return NextResponse.json({ error: 'Supplier is not enrolled in this program' }, { status: 403 })
  }

  // Reject duplicate invoice numbers for the same anchor+supplier relationship
  const { data: existing } = await adminClient
    .from('transactions')
    .select('id')
    .eq('anchor_id', enrollment.anchor_org_id)
    .eq('supplier_id', userData.org_id)
    .eq('invoice_number', String(invoice_number))
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'Invoice number already exists for this anchor relationship. Please use a unique invoice number.' },
      { status: 400 }
    )
  }

  // Get program for bank_id and type
  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id, financing_types, status')
    .eq('id', program_id as string)
    .single()

  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })
  if (program.status !== 'active') return NextResponse.json({ error: 'Program is not active' }, { status: 400 })

  const financingType = (program.financing_types as string[])[0] ?? 'factoring'
  const initialStatus = (financingType === 'invoice_factoring' || financingType === 'po_financing')
    ? 'pending_bank_review'
    : 'pending_anchor_approval'

  console.log('[transaction create] type:', financingType, 'initialStatus:', initialStatus)

  const isDD = financingType === 'dynamic_discounting'

  const { data: transaction, error: txnError } = await adminClient
    .from('transactions')
    .insert({
      program_id:                  program_id as string,
      bank_id:                     program.bank_id,
      anchor_id:                   enrollment.anchor_org_id,
      supplier_id:                 userData.org_id,
      created_by_user_id:          user.id,
      type:                        financingType,
      status:                      initialStatus,
      invoice_number:              String(invoice_number),
      invoice_date:                String(invoice_date),
      invoice_due_date:            invoice_due_date ? String(invoice_due_date) : null,
      invoice_amount:              invoiceAmt,
      financing_amount_requested:  financingAmt,
      goods_services_description:  String(goods_services_description),
      ...(isDD ? {
        discount_rate:      discount_rate != null ? Number(discount_rate) : null,
        early_payment_date: early_payment_date ? String(early_payment_date) : null,
        discount_amount:    discount_amount != null ? Number(discount_amount) : null,
      } : {}),
    })
    .select()
    .single()

  if (txnError || !transaction) {
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  }

  await adminClient.from('transaction_events').insert({
    transaction_id: transaction.id,
    event_type:     'created',
    from_status:    null,
    to_status:      initialStatus,
    actor_id:       user.id,
    actor_type:     'supplier',
    notes:          `Supplier initial offer: ${((financingAmt / invoiceAmt) * 100).toFixed(1)}% advance rate, ${financingAmt} requested`,
  })

  return NextResponse.json({ transaction_id: transaction.id, transaction }, { status: 201 })
}
