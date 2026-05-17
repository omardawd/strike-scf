import { Resend } from 'resend'

const FROM = 'Strike SCF <no-reply@strikescf.com>'
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
  console.log('[email] Attempting send to:', to, 'subject:', subject)
  console.log('[email] Resend key exists:', !!process.env.RESEND_API_KEY)
  try {
    const resend = getResend()
    if (!resend) return
    const result = await resend.emails.send({ from: FROM, to, subject, html })
    console.log('[email] Send result:', result)
  } catch (err) {
    console.log('[email] Send error:', err)
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

export function kybApprovalEmailHtml({
  recipientName,
  orgName,
}: {
  recipientName: string
  orgName: string
}) {
  const dashboardUrl = `${APP_URL}/dashboard`
  return `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
      <img src="${APP_URL}/logo.png" alt="Strike SCF" style="height:36px;margin-bottom:32px;" />
      <div style="width:52px;height:52px;border-radius:50%;background:rgba(22,163,74,0.1);display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12 L10 17 L19 8" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.02em;">You&apos;re approved!</h2>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px;">
        Hi <strong>${recipientName}</strong>, great news — <strong>${orgName}</strong>&apos;s application on Strike SCF has been reviewed and approved. You now have full access to the platform.
      </p>
      <a href="${dashboardUrl}" style="display:inline-block;background:#1B3BE8;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
        Access your dashboard →
      </a>
      <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">
        If you have questions, reply to this email or contact your program administrator.
      </p>
    </div>
  `
}

export function kybRejectionEmailHtml({
  recipientName,
  orgName,
  reason,
}: {
  recipientName: string
  orgName: string
  reason?: string
}) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
      <img src="${APP_URL}/logo.png" alt="Strike SCF" style="height:36px;margin-bottom:32px;" />
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.02em;">Application update</h2>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 16px;">
        Hi <strong>${recipientName}</strong>, we have completed our review of <strong>${orgName}</strong>&apos;s application on Strike SCF. Unfortunately we are unable to approve the application at this time.
      </p>
      ${reason ? `
        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:6px;">Reason provided</div>
          <div style="font-size:14px;color:#475569;">${reason}</div>
        </div>
      ` : ''}
      <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">
        If you believe this is in error or have questions, please contact your program administrator directly.
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
