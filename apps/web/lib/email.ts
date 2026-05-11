import { Resend } from 'resend'

const FROM = 'Strike SCF <onboarding@resend.dev>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('RESEND_API_KEY not set — skipping email')
    return null
  }
  return new Resend(key)
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  try {
    const resend = getResend()
    if (!resend) return
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (err) {
    console.error('Email send failed:', err)
    // Never throw — email failure must not break the app
  }
}

export function inviteEmailHtml({
  inviterName,
  orgName,
  role,
  token,
}: {
  inviterName: string
  orgName: string
  role: string
  token: string
}) {
  const inviteUrl = `${APP_URL}/invite?token=${token}`
  const roleFormatted = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `
    <div style="font-family: system-ui, sans-serif;
      max-width: 500px; margin: 0 auto;
      padding: 40px 24px; color: #0f172a;">

      <img src="${APP_URL}/logo.png"
        alt="Strike SCF"
        style="height: 36px; margin-bottom: 32px;" />

      <h2 style="font-size: 22px; font-weight: 700;
        margin: 0 0 8px; letter-spacing: -0.02em;">
        You've been invited
      </h2>

      <p style="color: #64748b; font-size: 14px;
        line-height: 1.6; margin: 0 0 24px;">
        <strong>${inviterName}</strong> has invited you
        to join <strong>${orgName}</strong> on Strike SCF
        as a ${roleFormatted}.
      </p>

      <a href="${inviteUrl}"
        style="display: inline-block;
          background: #1B3BE8; color: white;
          text-decoration: none; padding: 12px 28px;
          border-radius: 8px; font-size: 14px;
          font-weight: 600;">
        Accept invitation →
      </a>

      <p style="color: #94a3b8; font-size: 12px;
        margin: 28px 0 0; line-height: 1.6;">
        This invitation expires in 7 days.<br/>
        If you weren't expecting this, you can
        safely ignore this email.
      </p>
    </div>
  `
}

export function transactionStatusEmailHtml({
  recipientName,
  eventBody,
  transactionId,
}: {
  recipientName: string
  eventBody: string
  transactionId: string
}) {
  const transactionUrl = `${APP_URL}/transactions/${transactionId}`
  return `
    <div style="font-family: system-ui, sans-serif;
      max-width: 480px; margin: 0 auto;
      padding: 40px 24px; color: #0f172a;">
      <img src="${APP_URL}/logo.png"
        alt="Strike SCF"
        style="height: 36px; margin-bottom: 32px;" />
      <h2 style="font-size: 20px; font-weight: 700;
        margin: 0 0 8px;">Hi ${recipientName},</h2>
      <p style="color: #64748b; font-size: 14px;
        margin: 0 0 24px;">${eventBody}</p>
      <a href="${transactionUrl}"
        style="display: inline-block; background: #1B3BE8;
        color: white; text-decoration: none;
        padding: 12px 24px; border-radius: 8px;
        font-size: 14px; font-weight: 600;">
        View transaction
      </a>
    </div>
  `
}
