// Requester confirms receipt of the bank's disbursed financing advance.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: financingReq } = await adminClient
    .from('financing_requests')
    .select('id, requesting_org_id')
    .eq('id', requestId)
    .single()
  if (!financingReq) return NextResponse.json({ error: 'Financing request not found' }, { status: 404 })
  if (financingReq.requesting_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Only the requesting organization can confirm receipt' }, { status: 403 })
  }

  const { data: txn } = await adminClient
    .from('transactions')
    .select('id, disbursed_at, supplier_paid_at, bank_id')
    .eq('financing_request_id', requestId)
    .single()
  if (!txn) return NextResponse.json({ error: 'No transaction linked to this financing request' }, { status: 404 })
  if (!txn.disbursed_at) return NextResponse.json({ error: 'Funds have not been disbursed yet' }, { status: 400 })
  if (txn.supplier_paid_at) return NextResponse.json({ error: 'Receipt already confirmed' }, { status: 400 })

  const now = new Date().toISOString()
  await adminClient.from('transactions').update({
    supplier_paid_at: now,
    updated_at: now,
  }).eq('id', txn.id)

  if (txn.bank_id) {
    const { data: bankUsers } = await adminClient.from('users').select('id').eq('bank_id', txn.bank_id)
    if (bankUsers?.length) {
      await adminClient.from('notifications').insert(
        bankUsers.map((u: { id: string }) => ({
          user_id: u.id, event: 'financing_funds_confirmed',
          title: 'Borrower confirmed receipt of funds',
          body: 'The borrower has confirmed the disbursed financing advance was received.',
          deep_link: `/marketplace/financing/${requestId}`, read: false,
        }))
      )
    }
  }

  return NextResponse.json({ success: true })
}
