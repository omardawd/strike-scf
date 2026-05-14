import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { OrgType, OrgStatus, KYBStatus, BusinessType, BankStatus, InstitutionType } from '@strike-scf/types'

const adminClient = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface StartBody {
  legal_name: string
  // Bank-specific (role = bank_admin)
  display_business_as?: string
  institution_type?: InstitutionType
  routing_number?: string
  // Supplier / Anchor
  bank_id?: string
  type?: OrgType
  ein?: string
  doing_business_as?: string
  business_type?: BusinessType
  state_of_incorporation?: string
  address_line1?: string
  city?: string
  state?: string
  zip?: string
  anchor_org_id?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isBankAdmin = user.user_metadata?.role === 'bank_admin'

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('org_id, bank_id, full_name, email')
    .eq('id', user.id)
    .single()

  if (userError) {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  // Idempotent checks
  if (isBankAdmin && userData.bank_id) {
    return NextResponse.json({ bank_id: userData.bank_id })
  }
  if (!isBankAdmin && userData.org_id) {
    return NextResponse.json({ org_id: userData.org_id })
  }

  let body: StartBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.legal_name) {
    return NextResponse.json({ error: 'legal_name is required' }, { status: 400 })
  }

  // ── Bank admin: create a banks row ──────────────────────────
  if (isBankAdmin) {
    const { data: bank, error: bankError } = await adminClient
      .from('banks')
      .insert({
        legal_name: body.legal_name,
        display_name: body.display_business_as ?? body.legal_name,
        institution_type: (body.institution_type ?? 'commercial_bank') satisfies InstitutionType,
        primary_contact_name: (userData.full_name as string) ?? '',
        primary_contact_email: (userData.email as string) ?? user.email ?? '',
        routing_number: body.routing_number ?? '',
        status: 'setup_pending' satisfies BankStatus,
      })
      .select('id')
      .single()

    if (bankError || !bank) {
      return NextResponse.json({ error: 'Failed to create bank' }, { status: 500 })
    }

    const { error: updateError } = await adminClient
      .from('users')
      .update({ bank_id: bank.id, org_id: null })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to link bank to user' }, { status: 500 })
    }

    return NextResponse.json({ bank_id: bank.id }, { status: 201 })
  }

  // ── Supplier / Anchor: create an organization row ───────────
  const { bank_id, type, ein, doing_business_as, business_type,
    state_of_incorporation, address_line1, city, state, zip, anchor_org_id } = body

  if (!bank_id || !type || !ein) {
    return NextResponse.json(
      { error: 'bank_id, type, and ein are required' },
      { status: 400 }
    )
  }

  const orgRow = {
    bank_id,
    type,
    legal_name: body.legal_name,
    ein,
    doing_business_as: doing_business_as ?? null,
    business_type: business_type ?? null,
    state_of_incorporation: state_of_incorporation ?? null,
    address_line1: address_line1 ?? null,
    city: city ?? null,
    state: state ?? null,
    zip: zip ?? null,
    kyb_status: 'in_progress' satisfies KYBStatus,
    status: 'in_progress' satisfies OrgStatus,
    ...(anchor_org_id ? { anchor_org_id } : {}),
  }

  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(orgRow as any)
    .select('id')
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
  }

  const { error: updateError } = await adminClient
    .from('users')
    .update({ org_id: org.id })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to link organization to user' }, { status: 500 })
  }

  return NextResponse.json({ org_id: org.id }, { status: 201 })
}
