import { Resend } from 'resend'

const FROM = 'Strike SCF <no-reply@strikescf.com>'
const APP_URL = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.strikescf.com').trim()
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return raw.includes('localhost') ? `http://${raw}` : `https://${raw}`
})()

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

      <div style="font-family: system-ui, sans-serif;
        font-size: 20px; font-weight: 700;
        color: #1B3BE8; margin-bottom: 24px;
        letter-spacing: -0.03em;">
        Strike SCF
      </div>

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
      <div style="font-family: system-ui, sans-serif;
        font-size: 20px; font-weight: 700;
        color: #1B3BE8; margin-bottom: 24px;
        letter-spacing: -0.03em;">
        Strike SCF
      </div>
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
      <div style="font-family: system-ui, sans-serif;
        font-size: 20px; font-weight: 700;
        color: #1B3BE8; margin-bottom: 24px;
        letter-spacing: -0.03em;">
        Strike SCF
      </div>
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

export function passportLiveEmailHtml({
  recipientName,
  orgName,
  score,
}: {
  recipientName: string
  orgName: string
  score?: number | null
}) {
  const passportUrl = `${APP_URL}/passport`
  return `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
      <div style="font-size:20px;font-weight:700;color:#1B3BE8;margin-bottom:24px;letter-spacing:-0.03em;">
        Strike SCF
      </div>
      <div style="width:52px;height:52px;border-radius:50%;background:rgba(201,168,76,0.14);display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12 L10 17 L19 8" stroke="#C9A84C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.02em;">Your Strike Passport is live</h2>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px;">
        Hi <strong>${recipientName}</strong>, <strong>${orgName}</strong>&apos;s Strike Passport has been verified and published to the network.${
          typeof score === 'number'
            ? ` Your starting PassportScore&trade; is <strong>${Math.round(score)}</strong>.`
            : ''
        } Counterparties and banks can now discover you on Strike Place.
      </p>
      <a href="${passportUrl}" style="display:inline-block;background:#1B3BE8;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
        View your Passport &rarr;
      </a>
      <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">
        Your PassportScore&trade; updates automatically as you complete trades on Strike.
      </p>
    </div>
  `
}

export function passportReviewEmailHtml({
  recipientName,
  orgName,
}: {
  recipientName: string
  orgName: string
}) {
  const passportUrl = `${APP_URL}/passport`
  return `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:40px 24px;color:#0f172a;">
      <div style="font-size:20px;font-weight:700;color:#1B3BE8;margin-bottom:24px;letter-spacing:-0.03em;">
        Strike SCF
      </div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.02em;">Your application needs additional review</h2>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px;">
        Hi <strong>${recipientName}</strong>, thanks for submitting <strong>${orgName}</strong>&apos;s application. Our automated KYB review is complete, and your file has been routed to a Strike analyst for a closer look. No action is needed from you right now — we&apos;ll be in touch shortly.
      </p>
      <a href="${passportUrl}" style="display:inline-block;background:#1B3BE8;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
        Check your status &rarr;
      </a>
      <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">
        Most reviews are completed within one business day.
      </p>
    </div>
  `
}

// ---- Deal flow emails ----------------------------------------

const APP_URL_DEAL = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.strikescf.com').trim()
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return raw.includes('localhost') ? `http://${raw}` : `https://${raw}`
})()

function dealEmailWrapper(body: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;color:#0f172a;">
    <div style="font-size:20px;font-weight:700;color:#1428CC;margin-bottom:24px;letter-spacing:-0.03em;">Strike SCF</div>
    ${body}
    <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;line-height:1.6;">This is an automated notification from Strike SCF. Do not reply to this email.</p>
  </div>`
}

function dealLink(dealId: string): string {
  return `${APP_URL_DEAL}/deals/${dealId}`
}

function dealCta(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1428CC;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`
}

export function dealPaymentInstructionsEmailHtml({ sellerName, dealId, dealShortId }: { sellerName: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Payment instructions received</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;"><strong>${sellerName}</strong> has submitted payment instructions for Deal #${dealShortId}. Please upload your Purchase Order to proceed.</p>
    ${dealCta(dealLink(dealId), 'Review deal →')}
  `)
}

export function dealShippedEmailHtml({ sellerName, trackingRef, estimatedDelivery, dealId, dealShortId }: { sellerName: string; trackingRef: string; estimatedDelivery: string | null; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Your order has been shipped</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 12px;"><strong>${sellerName}</strong> has shipped your order for Deal #${dealShortId}.</p>
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Tracking reference</div>
      <div style="font-size:14px;font-weight:600;color:#0f172a;">${trackingRef}</div>
      ${estimatedDelivery ? `<div style="font-size:12px;color:#64748b;margin-top:8px;">Estimated delivery: ${estimatedDelivery}</div>` : ''}
    </div>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
}

export function dealDeliveryConfirmedEmailHtml({ buyerName, dealId, dealShortId }: { buyerName: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Delivery confirmed</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;"><strong>${buyerName}</strong> has confirmed receipt of goods for Deal #${dealShortId}. Payment is now expected per agreed terms.</p>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
}

export function dealDisputeRaisedEmailHtml({ raisingPartyName, category, dealId, dealShortId }: { raisingPartyName: string; category: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Dispute raised — Deal #${dealShortId}</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 12px;"><strong>${raisingPartyName}</strong> has raised a dispute on Deal #${dealShortId}.</p>
    <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Dispute category</div>
      <div style="font-size:14px;font-weight:600;color:#dc2626;">${category.replace(/_/g, ' ')}</div>
    </div>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Please log in to submit your evidence. Strike Admin has been notified.</p>
    ${dealCta(dealLink(dealId), 'View dispute →')}
  `)
}

export function dealAmendmentProposedEmailHtml({ proposerName, field, currentValue, proposedValue, dealId, dealShortId }: { proposerName: string; field: string; currentValue: string; proposedValue: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Amendment proposed — Deal #${dealShortId}</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 12px;"><strong>${proposerName}</strong> has proposed an amendment to this deal.</p>
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Field</div>
      <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px;">${field.replace(/_/g, ' ')}</div>
      <div style="display:flex;gap:16px;">
        <div><div style="font-size:11px;color:#94a3b8;">Current</div><div style="font-size:13px;color:#64748b;">${currentValue}</div></div>
        <div><div style="font-size:11px;color:#94a3b8;">Proposed</div><div style="font-size:13px;font-weight:600;color:#1428CC;">${proposedValue}</div></div>
      </div>
    </div>
    ${dealCta(dealLink(dealId), 'Review amendment →')}
  `)
}

export function dealAmendmentRespondedEmailHtml({ accepted, dealId, dealShortId }: { accepted: boolean; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Amendment ${accepted ? 'accepted' : 'rejected'}</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Your proposed amendment on Deal #${dealShortId} has been <strong>${accepted ? 'accepted' : 'rejected'}</strong>.${accepted ? ' The deal terms have been updated.' : ' The deal continues under original terms.'}</p>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
}

export function dealPaymentOverdueEmailHtml({ recipientName, dealId, dealShortId, dueDate, isBuyer }: { recipientName: string; dealId: string; dealShortId: string; dueDate: string; isBuyer: boolean }) {
  return dealEmailWrapper(`
    <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:#dc2626;">⚠ Payment Overdue</div>
    </div>
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Payment overdue — Deal #${dealShortId}</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Hi <strong>${recipientName}</strong>, ${isBuyer ? `payment for Deal #${dealShortId} was due on ${dueDate} and has not been received. Please remit immediately to avoid further action.` : `payment for Deal #${dealShortId} was due on ${dueDate}. Strike Admin has been notified. We will follow up with the buyer.`}</p>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
}

export function dealPaymentConfirmedEmailHtml({ buyerName, paymentRef, dealId, dealShortId }: { buyerName: string; paymentRef: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Payment confirmed by buyer</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 12px;"><strong>${buyerName}</strong> has confirmed payment for Deal #${dealShortId}.</p>
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Payment reference</div>
      <div style="font-size:14px;font-weight:600;color:#0f172a;">${paymentRef}</div>
    </div>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;">Please log in to confirm you have received the payment to complete the deal.</p>
    ${dealCta(dealLink(dealId), 'Confirm receipt →')}
  `)
}

export function dealCompletedEmailHtml({ recipientName, dealId, dealShortId }: { recipientName: string; dealId: string; dealShortId: string }) {
  return dealEmailWrapper(`
    <div style="width:48px;height:48px;border-radius:50%;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Deal complete</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Hi <strong>${recipientName}</strong>, Deal #${dealShortId} has been completed successfully. Please leave a peer review to help build trust on the network.</p>
    ${dealCta(dealLink(dealId), 'Leave a review →')}
  `)
}

export function dealFinancingRejectedEmailHtml({ recipientName, sellerName, dealId, dealShortId, dueDate }: { recipientName: string; sellerName: string; dealId: string; dealShortId: string; dueDate: string | null }) {
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Financing not secured — direct payment required</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Hi <strong>${recipientName}</strong>, financing was not secured for Deal #${dealShortId}. Payment must be made directly to <strong>${sellerName}</strong>${dueDate ? ` by ${dueDate}` : ''}. Payment instructions are available on the deal page.</p>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
}

export function dealDisputeResolvedEmailHtml({ recipientName, resolution, dealId, dealShortId }: { recipientName: string; resolution: string; dealId: string; dealShortId: string }) {
  const labels: Record<string, string> = {
    buyer_favor: 'resolved in favour of the buyer',
    seller_favor: 'resolved in favour of the seller',
    mutual_settlement: 'resolved by mutual settlement',
    escalated: 'escalated to external arbitration',
  }
  return dealEmailWrapper(`
    <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Dispute resolved — Deal #${dealShortId}</h2>
    <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px;">Hi <strong>${recipientName}</strong>, the dispute on Deal #${dealShortId} has been ${labels[resolution] ?? resolution}. Please check the deal page for next steps.</p>
    ${dealCta(dealLink(dealId), 'View deal →')}
  `)
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
      <div style="font-family: system-ui, sans-serif;
        font-size: 20px; font-weight: 700;
        color: #1B3BE8; margin-bottom: 24px;
        letter-spacing: -0.03em;">
        Strike SCF
      </div>
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
