import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, transactionStatusEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const filterOrgId     = searchParams.get('org_id')
  const filterTxnId     = searchParams.get('transaction_id')
  const filterStatus    = searchParams.get('status')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any

  if (BANK_ROLES.includes(userData.role)) {
    const { data: bankPrograms } = await adminClient
      .from('programs')
      .select('id')
      .eq('bank_id', userData.bank_id)

    const bankProgramIds = (bankPrograms ?? []).map((p: { id: string }) => p.id)
    if (bankProgramIds.length === 0) return NextResponse.json({ collateral: [] })

    const [enrollmentResult, txnResult] = await Promise.all([
      adminClient.from('program_enrollments').select('org_id').in('program_id', bankProgramIds),
      adminClient.from('transactions').select('id').in('program_id', bankProgramIds),
    ])

    const enrolledOrgIds = [...new Set((enrollmentResult.data ?? []).map((e: { org_id: string }) => e.org_id))]
    const bankTxnIds     = (txnResult.data ?? []).map((t: { id: string }) => t.id)

    const orParts: string[] = []
    if (enrolledOrgIds.length > 0) orParts.push(`org_id.in.(${enrolledOrgIds.join(',')})`)
    if (bankTxnIds.length > 0)     orParts.push(`transaction_id.in.(${bankTxnIds.join(',')})`)
    if (orParts.length === 0) return NextResponse.json({ collateral: [] })

    query = adminClient
      .from('collateral_requirements')
      .select('*')
      .or(orParts.join(','))

  } else if (ORG_ROLES.includes(userData.role)) {
    // Look up org type to determine anchor vs supplier path
    const { data: orgRow } = await adminClient.from('organizations').select('type').eq('id', userData.org_id).single()
    const orgType = orgRow?.type  // 'anchor' | 'supplier'

    if (orgType === 'supplier') {
      // Supplier sees collateral for their org or their transactions
      const { data: txns } = await adminClient
        .from('transactions')
        .select('id')
        .eq('supplier_id', userData.org_id)

      const txnIds = (txns ?? []).map((t: { id: string }) => t.id)

      query = adminClient.from('collateral_requirements').select('*')
      if (txnIds.length > 0) {
        query = query.or(`org_id.eq.${userData.org_id},transaction_id.in.(${txnIds.join(',')})`)
      } else {
        query = query.eq('org_id', userData.org_id)
      }
    } else if (orgType === 'anchor') {
      // Anchor sees collateral for transactions they're on
      const { data: txns } = await adminClient
        .from('transactions')
        .select('id')
        .eq('anchor_id', userData.org_id)

      const txnIds = (txns ?? []).map((t: { id: string }) => t.id)
      if (txnIds.length === 0) return NextResponse.json({ collateral: [] })

      query = adminClient
        .from('collateral_requirements')
        .select('*')
        .in('transaction_id', txnIds)
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (filterOrgId)  query = query.eq('org_id', filterOrgId)
  if (filterTxnId)  query = query.eq('transaction_id', filterTxnId)
  if (filterStatus) query = query.eq('status', filterStatus)

  query = query.order('created_at', { ascending: false })

  const { data: collateral, error } = await query
  if (error) {
    console.error('Collateral fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch collateral' }, { status: 500 })
  }

  // Enrich with org names
  const items = collateral ?? []
  const rawOrgIds = [...new Set(
    items.map((c: { org_id: string | null }) => c.org_id).filter((id: string | null): id is string => id != null)
  )]
  const orgNameMap: Record<string, string> = {}
  if (rawOrgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name')
      .in('id', rawOrgIds)
    for (const org of orgs ?? []) {
      const o = org as { id: string; legal_name: string }
      orgNameMap[o.id] = o.legal_name
    }
  }

  const enriched = items.map((c: Record<string, unknown>) => ({
    ...c,
    org_name: c.org_id ? (orgNameMap[c.org_id as string] ?? null) : null,
  }))

  return NextResponse.json({ collateral: enriched })
}

export async function POST(request: Request) {
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    level, org_id, transaction_id,
    collateral_type, description,
    required_value, deadline,
  } = body as {
    level?: string
    org_id?: string
    transaction_id?: string
    collateral_type?: string
    description?: string
    required_value?: number
    deadline?: string
  }

  if (!level || !collateral_type || !description || !deadline) {
    return NextResponse.json({ error: 'level, collateral_type, description, and deadline are required' }, { status: 400 })
  }
  if (!org_id && !transaction_id) {
    return NextResponse.json({ error: 'org_id or transaction_id is required' }, { status: 400 })
  }
  if (new Date(deadline) <= new Date()) {
    return NextResponse.json({ error: 'Deadline must be in the future' }, { status: 400 })
  }

  const record: Record<string, unknown> = {
    level,
    collateral_type,
    description,
    deadline,
    required_by_user_id: user.id,
    status: 'pending',
  }
  if (org_id)         record.org_id         = org_id
  if (transaction_id) record.transaction_id = transaction_id
  if (required_value) record.required_value = required_value

  const { data: collateral, error: insertError } = await adminClient
    .from('collateral_requirements')
    .insert(record)
    .select()
    .single()

  if (insertError) {
    console.error('Collateral insert error:', insertError)
    return NextResponse.json({ error: 'Failed to create collateral requirement' }, { status: 500 })
  }

  // Insert transaction event if linked to a transaction
  if (transaction_id) {
    await adminClient.from('transaction_events').insert({
      transaction_id,
      event_type: 'collateral_updated',
      actor_id:   user.id,
      actor_type: 'bank',
      notes:      String(description),
    })
  }

  // Email supplier admin — fire and forget
  ;(async () => {
    let targetOrgId: string | null = org_id ?? null
    if (!targetOrgId && transaction_id) {
      const { data: txn } = await adminClient
        .from('transactions')
        .select('supplier_id')
        .eq('id', transaction_id)
        .single()
      targetOrgId = txn?.supplier_id ?? null
    }

    if (!targetOrgId) return

    const { data: supplierAdmin } = await adminClient
      .from('users')
      .select('email, full_name')
      .eq('org_id', targetOrgId)
      .eq('role', 'org_admin')
      .limit(1)
      .maybeSingle()

    if (!supplierAdmin?.email) return

    const deadlineFmt = new Date(String(deadline)).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })

    await sendEmail({
      to:      supplierAdmin.email,
      subject: 'Collateral required — Strike SCF',
      html:    transactionStatusEmailHtml({
        recipientName: supplierAdmin.full_name ?? 'Supplier Admin',
        eventBody:     `A new collateral requirement has been added: ${description}. Deadline: ${deadlineFmt}.`,
        transactionId: String(transaction_id ?? collateral.id),
      }),
    })
  })().catch(() => {})

  return NextResponse.json({ collateral_id: collateral.id, collateral }, { status: 201 })
}
