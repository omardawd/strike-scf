import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']
const ADMIN_ROLES = ['bank_admin', 'bank_credit_officer', 'org_admin']

const BANK_FIELDS = ['legal_name', 'display_name', 'website', 'primary_contact_name', 'primary_contact_email']
const ORG_FIELDS  = ['legal_name', 'doing_business_as', 'address_line1', 'city', 'state', 'zip', 'primary_contact_phone']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (BANK_ROLES.includes(userData.role)) {
    const { data: profile } = await adminClient
      .from('banks')
      .select('*')
      .eq('id', userData.bank_id)
      .single()
    return NextResponse.json({ profile })
  }

  const { data: profile } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', userData.org_id)
    .single()

  return NextResponse.json({ profile })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!ADMIN_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (BANK_ROLES.includes(userData.role)) {
    for (const field of BANK_FIELDS) {
      if (body[field] !== undefined) update[field] = String(body[field])
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data: profile, error } = await adminClient
      .from('banks')
      .update(update)
      .eq('id', userData.bank_id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    return NextResponse.json({ profile })
  }

  for (const field of ORG_FIELDS) {
    if (body[field] !== undefined) update[field] = String(body[field])
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: profile, error } = await adminClient
    .from('organizations')
    .update(update)
    .eq('id', userData.org_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  return NextResponse.json({ profile })
}
