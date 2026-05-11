import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmail, inviteEmailHtml, transactionStatusEmailHtml } from '@/lib/email'

/**
 * POST /api/email
 *
 * Internal helper endpoint for triggering emails. Callers must be authenticated.
 * Used by invitation and transaction flows to send notifications.
 *
 * Body (invite):
 *   { type: 'invite', to, inviterName, orgName, role, token }
 *
 * Body (transaction_status):
 *   { type: 'transaction_status', to, recipientName, subject, eventBody, transactionId }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type } = body

  if (type === 'invite') {
    const { to, inviterName, orgName, role, token } = body
    if (!to || !inviterName || !orgName || !role || !token) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await sendEmail({
      to:      String(to),
      subject: `You've been invited to join ${String(orgName)} on Strike SCF`,
      html:    inviteEmailHtml({
        inviterName: String(inviterName),
        orgName:     String(orgName),
        role:        String(role),
        token:       String(token),
      }),
    })
    return NextResponse.json({ sent: true })
  }

  if (type === 'transaction_status') {
    const { to, recipientName, subject, eventBody, transactionId } = body
    if (!to || !recipientName || !subject || !eventBody || !transactionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await sendEmail({
      to:      String(to),
      subject: String(subject),
      html:    transactionStatusEmailHtml({
        recipientName:  String(recipientName),
        eventBody:      String(eventBody),
        transactionId:  String(transactionId),
      }),
    })
    return NextResponse.json({ sent: true })
  }

  return NextResponse.json({ error: 'Unknown email type' }, { status: 400 })
}
