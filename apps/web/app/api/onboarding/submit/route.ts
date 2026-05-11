import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { KYBStatus, OrgStatus, BankStatus } from '@strike-scf/types'

const adminClient = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface SubmitBody {
  org_id?: string
  bank_id?: string
  bank_account_last4?: string
  bank_routing_number?: string
  bank_account_type?: 'checking' | 'savings'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SubmitBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { org_id, bank_id, bank_account_last4, bank_routing_number, bank_account_type } = body

  // ── Bank flow ────────────────────────────────────────────────
  if (bank_id) {
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('bank_id')
      .eq('id', user.id)
      .single()

    if (userError) {
      return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
    }

    if (!userData || userData.bank_id !== bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: bankUpdateError } = await adminClient
      .from('banks')
      .update({ status: 'active' satisfies BankStatus })
      .eq('id', bank_id)

    if (bankUpdateError) {
      return NextResponse.json({ error: 'Failed to activate bank' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }

  // ── Supplier / Anchor flow ───────────────────────────────────
  if (!org_id) {
    return NextResponse.json({ error: 'org_id or bank_id is required' }, { status: 400 })
  }

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError) {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  if (userData.org_id !== org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: updateError } = await adminClient
    .from('organizations')
    .update({
      kyb_status: 'submitted' satisfies KYBStatus,
      kyb_submitted_at: new Date().toISOString(),
      status: 'submitted' satisfies OrgStatus,
      ...(bank_account_last4 !== undefined && { bank_account_last4 }),
      ...(bank_routing_number !== undefined && { bank_routing_number }),
      ...(bank_account_type !== undefined && { bank_account_type }),
    })
    .eq('id', org_id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
