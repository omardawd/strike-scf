import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, inviteEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: programId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id, full_name')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (userRow.role !== 'org_admin' && userRow.role !== 'bank_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { suppliers: Array<{ name: string; email: string }>; anchor_org_id: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Array.isArray(body.suppliers) || body.suppliers.length === 0) {
    return NextResponse.json({ error: 'suppliers array is required and must not be empty' }, { status: 400 })
  }
  if (body.suppliers.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 suppliers per bulk invite' }, { status: 400 })
  }

  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id')
    .eq('id', programId)
    .single()
  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  if (userRow.role === 'bank_admin' && program.bank_id !== userRow.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const supplier of body.suppliers) {
    try {
      const { data: existing } = await adminClient
        .from('invitations')
        .select('id')
        .eq('email', supplier.email)
        .eq('program_id', programId)
        .eq('status', 'pending')
        .maybeSingle()

      if (existing) { failed++; continue }

      const { data: inv, error } = await adminClient
        .from('invitations')
        .insert({
          email: supplier.email,
          invitee_name: supplier.name || null,
          role: 'supplier',
          invited_by_user_id: userRow.id,
          invited_by_actor_type: userRow.role === 'bank_admin' || userRow.role === 'bank_credit_officer' ? 'bank' : 'anchor',
          bank_id: program.bank_id,
          program_id: programId,
          anchor_org_id: body.anchor_org_id,
          invitation_mode: 'standard',
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()

      if (error) { failed++; errors.push(error.message); continue }

      sendEmail({
        to: supplier.email,
        subject: `You've been invited to join Strike SCF`,
        html: inviteEmailHtml({
          inviterName: userRow.full_name ?? 'Team',
          orgName: 'Strike SCF',
          role: 'supplier',
          token: inv.token,
        }),
      }).catch(() => {})

      sent++
    } catch (err: unknown) {
      failed++
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  await adminClient
    .from('bulk_invite_jobs')
    .insert({
      program_id: programId,
      anchor_org_id: body.anchor_org_id,
      created_by_user_id: userRow.id,
      bank_id: program.bank_id,
      total_count: body.suppliers.length,
      sent_count: sent,
      failed_count: failed,
      status: failed === body.suppliers.length ? 'failed' : 'completed',
      errors: errors.length ? errors : null,
    })

  return NextResponse.json({ sent, failed, errors })
}
