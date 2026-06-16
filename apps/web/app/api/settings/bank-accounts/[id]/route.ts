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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entity = await resolveEntity(user.id)
  if (!entity || !entity.entity_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!entity.canWrite) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify ownership
  const { data: existing } = await adminClient
    .from('bank_accounts')
    .select('id')
    .eq('id', id)
    .eq('entity_type', entity.entity_type)
    .eq('entity_id', entity.entity_id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { nickname, bank_name, account_holder_name, account_number, routing_number, swift_iban, account_type, is_primary } = body

  // If setting as primary, clear existing primary first
  if (is_primary) {
    await adminClient
      .from('bank_accounts')
      .update({ is_primary: false })
      .eq('entity_type', entity.entity_type)
      .eq('entity_id', entity.entity_id)
      .neq('id', id)
  }

  const patch: Record<string, unknown> = {}
  if (nickname    !== undefined) patch.nickname             = nickname
  if (bank_name   !== undefined) patch.bank_name            = bank_name
  if (account_holder_name !== undefined) patch.account_holder_name = account_holder_name
  if (account_number      !== undefined) patch.account_number      = account_number
  if (routing_number      !== undefined) patch.routing_number      = routing_number
  if (swift_iban  !== undefined) patch.swift_iban           = swift_iban ?? null
  if (account_type !== undefined) patch.account_type        = account_type
  if (is_primary  !== undefined) patch.is_primary           = is_primary

  const { data, error } = await adminClient
    .from('bank_accounts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  return NextResponse.json({ account: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entity = await resolveEntity(user.id)
  if (!entity || !entity.entity_id) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!entity.canWrite) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify ownership before deleting
  const { data: existing } = await adminClient
    .from('bank_accounts')
    .select('id')
    .eq('id', id)
    .eq('entity_type', entity.entity_type)
    .eq('entity_id', entity.entity_id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await adminClient.from('bank_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  return NextResponse.json({ success: true })
}
