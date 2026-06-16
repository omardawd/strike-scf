import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const WRITE_ROLES = ['bank_admin', 'org_admin']

async function resolveEntity(userId: string) {
  const { data } = await adminClient
    .from('users')
    .select('role, org_id, bank_id')
    .eq('id', userId)
    .single()
  if (!data) return null
  const isBankUser = ['bank_admin', 'bank_credit_officer'].includes(data.role)
  return {
    role: data.role,
    entity_type: isBankUser ? 'bank' : 'organization',
    entity_id: isBankUser ? data.bank_id : data.org_id,
    canWrite: WRITE_ROLES.includes(data.role),
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entity = await resolveEntity(user.id)
  if (!entity || !entity.entity_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data, error } = await adminClient
    .from('bank_accounts')
    .select('*')
    .eq('entity_type', entity.entity_type)
    .eq('entity_id', entity.entity_id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entity = await resolveEntity(user.id)
  if (!entity || !entity.entity_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!entity.canWrite) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { nickname, bank_name, account_holder_name, account_number, routing_number, swift_iban, account_type, is_primary } = body

  if (!bank_name?.trim()) return NextResponse.json({ error: 'Bank name is required' }, { status: 400 })
  if (!account_number?.trim()) return NextResponse.json({ error: 'Account number is required' }, { status: 400 })
  if (!routing_number?.trim()) return NextResponse.json({ error: 'Routing number is required' }, { status: 400 })

  // If setting as primary, clear existing primary first
  if (is_primary) {
    await adminClient
      .from('bank_accounts')
      .update({ is_primary: false })
      .eq('entity_type', entity.entity_type)
      .eq('entity_id', entity.entity_id)
  }

  const { data, error } = await adminClient
    .from('bank_accounts')
    .insert({
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      nickname: nickname ?? '',
      bank_name: bank_name.trim(),
      account_holder_name: account_holder_name ?? '',
      account_number: account_number.trim(),
      routing_number: routing_number.trim(),
      swift_iban: swift_iban ?? null,
      account_type: account_type ?? 'checking',
      is_primary: is_primary ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  return NextResponse.json({ account: data }, { status: 201 })
}
