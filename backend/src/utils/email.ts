/**
 * @file email.ts
 * @description SendGrid-backed transactional email utility.
 * All email templates are defined here with inline HTML. The sender address,
 * app name, and branding colours are pulled from environment config.
 */

import sgMail, { MailDataRequired } from '@sendgrid/mail';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

// Initialise SendGrid with the API key once at module load time
sgMail.setApiKey(env.SENDGRID_API_KEY);

// ---------------------------------------------------------------------------
// Shared branding / constants
// ---------------------------------------------------------------------------

const FROM_ADDRESS = env.SENDGRID_FROM_EMAIL ?? 'no-reply@p2plearn.app';
const APP_NAME = 'P2P Learning';
const PRIMARY_COLOR = '#4F46E5'; // Indigo-600
const BASE_URL = env.CLIENT_URL ?? 'https://app.p2plearn.app';

/**
 * Internal helper that sends a single email via SendGrid.
 * Errors are logged but re-thrown so callers can decide how to handle them.
 */
async function sendEmail(msg: MailDataRequired): Promise<void> {
  try {
    await sgMail.send(msg);
    logger.info('Email sent', { to: msg.to, subject: msg.subject });
  } catch (error) {
    logger.error('Failed to send email', { to: msg.to, subject: msg.subject, error });
    throw error;
  }
}

/**
 * Wrap arbitrary body content inside a responsive, branded HTML shell.
 */
function wrapTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#F9FAFB; font-family:'Segoe UI',Arial,sans-serif; }
    .container { max-width:600px; margin:40px auto; background:#fff; border-radius:12px;
                 overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${PRIMARY_COLOR}; padding:32px 40px; text-align:center; }
    .header h1 { color:#fff; margin:0; font-size:24px; letter-spacing:-0.5px; }
    .body { padding:40px; color:#374151; line-height:1.6; }
    .body h2 { color:#111827; margin-top:0; }
    .btn { display:inline-block; margin:24px 0; padding:14px 32px; background:${PRIMARY_COLOR};
           color:#fff; text-decoration:none; border-radius:8px; font-weight:600; font-size:15px; }
    .footer { padding:24px 40px; background:#F3F4F6; text-align:center;
              font-size:13px; color:#6B7280; }
    .divider { border:none; border-top:1px solid #E5E7EB; margin:24px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>🎓 ${APP_NAME}</h1></div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">
      © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.<br/>
      <small>If you did not request this email, you can safely ignore it.</small>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Exported email functions
// ---------------------------------------------------------------------------

/**
 * Send an email-verification link to a newly-registered user.
 *
 * @param to    - Recipient email address
 * @param token - Opaque verification token (URL-safe hex string)
 */
export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;
  const body = `
    <h2>Verify your email address</h2>
    <p>Welcome to <strong>${APP_NAME}</strong>! Click the button below to confirm your email address
       and activate your account.</p>
    <a href="${verifyUrl}" class="btn">Verify Email</a>
    <hr class="divider"/>
    <p style="font-size:13px;color:#6B7280;">
      This link expires in <strong>24 hours</strong>. If you need a new link, visit the app and
      request another verification email.
    </p>
    <p style="font-size:13px;color:#6B7280;">
      Or copy and paste this URL into your browser:<br/>
      <a href="${verifyUrl}" style="color:${PRIMARY_COLOR}">${verifyUrl}</a>
    </p>`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `[${APP_NAME}] Please verify your email`,
    html: wrapTemplate('Verify your email', body),
    text: `Verify your email: ${verifyUrl} (link expires in 24 hours)`,
  });
}

/**
 * Send a password-reset link.
 *
 * @param to    - Recipient email address
 * @param token - Opaque reset token (URL-safe hex string)
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;
  const body = `
    <h2>Reset your password</h2>
    <p>We received a request to reset the password for your <strong>${APP_NAME}</strong> account.</p>
    <a href="${resetUrl}" class="btn">Reset Password</a>
    <hr class="divider"/>
    <p style="font-size:13px;color:#6B7280;">
      This link expires in <strong>1 hour</strong>. If you did not request a password reset,
      please ignore this email — your password will not change.
    </p>
    <p style="font-size:13px;color:#6B7280;">
      Or copy and paste this URL:<br/>
      <a href="${resetUrl}" style="color:${PRIMARY_COLOR}">${resetUrl}</a>
    </p>`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `[${APP_NAME}] Password reset request`,
    html: wrapTemplate('Reset your password', body),
    text: `Reset your password: ${resetUrl} (expires in 1 hour)`,
  });
}

/**
 * Send a welcome email after a user has verified their account.
 *
 * @param to        - Recipient email address
 * @param firstName - User's first name for personalisation
 */
export async function sendWelcomeEmail(to: string, firstName: string): Promise<void> {
  const body = `
    <h2>Welcome aboard, ${firstName}! 🎉</h2>
    <p>Your <strong>${APP_NAME}</strong> account is now active and ready to go.</p>
    <p>Here's what you can do next:</p>
    <ul>
      <li>🔍 <strong>Browse tutors</strong> in your subject and age tier</li>
      <li>📅 <strong>Book a session</strong> and start learning today</li>
      <li>🎓 <strong>Become a tutor</strong> and share your knowledge</li>
    </ul>
    <a href="${BASE_URL}/dashboard" class="btn">Go to Dashboard</a>
    <hr class="divider"/>
    <p style="font-size:13px;color:#6B7280;">
      Need help? Reply to this email or visit our
      <a href="${BASE_URL}/help" style="color:${PRIMARY_COLOR}">Help Centre</a>.
    </p>`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `Welcome to ${APP_NAME}!`,
    html: wrapTemplate('Welcome!', body),
    text: `Welcome to ${APP_NAME}, ${firstName}! Visit ${BASE_URL}/dashboard to get started.`,
  });
}

/**
 * Notify a tutor about the outcome of their mentor-review application.
 *
 * @param to       - Tutor's email address
 * @param status   - Whether they were approved or rejected
 * @param feedback - Optional reviewer feedback message
 */
export async function sendMentorReviewNotification(
  to: string,
  status: 'approved' | 'rejected',
  feedback?: string,
): Promise<void> {
  const isApproved = status === 'approved';
  const statusLabel = isApproved ? '✅ Approved' : '❌ Not approved';
  const ctaHtml = isApproved
    ? `<a href="${BASE_URL}/mentor/dashboard" class="btn">Go to Mentor Dashboard</a>`
    : `<a href="${BASE_URL}/tutor/reapply" class="btn">Update & Reapply</a>`;

  const body = `
    <h2>Mentor Application Update</h2>
    <p>Your mentor application has been reviewed.</p>
    <p><strong>Status:</strong> ${statusLabel}</p>
    ${feedback ? `<p><strong>Reviewer feedback:</strong><br/><em>${feedback}</em></p>` : ''}
    <hr class="divider"/>
    ${
      isApproved
        ? `<p>Congratulations! You can now accept mentoring requests and host live sessions on ${APP_NAME}.</p>`
        : `<p>Don't be discouraged — you can update your profile and reapply at any time.</p>`
    }
    ${ctaHtml}`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `[${APP_NAME}] Mentor application ${status}`,
    html: wrapTemplate('Mentor Application Update', body),
    text: `Your mentor application has been ${status}. ${feedback ?? ''} Visit ${BASE_URL} for more details.`,
  });
}

/**
 * Notify a tutor/mentor that a payout has been initiated.
 *
 * @param to       - Recipient email address
 * @param amount   - Payout amount (in smallest currency unit, e.g. paise / cents)
 * @param currency - ISO 4217 currency code, e.g. "INR", "USD"
 */
export async function sendPayoutNotification(
  to: string,
  amount: number,
  currency: string,
): Promise<void> {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100); // assuming amount in subunits

  const body = `
    <h2>Payout Initiated 💸</h2>
    <p>Great news! A payout has been initiated to your registered bank account / UPI ID.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr>
        <td style="padding:8px;border:1px solid #E5E7EB;background:#F9FAFB;width:40%"><strong>Amount</strong></td>
        <td style="padding:8px;border:1px solid #E5E7EB">${formatted}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #E5E7EB;background:#F9FAFB"><strong>Currency</strong></td>
        <td style="padding:8px;border:1px solid #E5E7EB">${currency}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #E5E7EB;background:#F9FAFB"><strong>Status</strong></td>
        <td style="padding:8px;border:1px solid #E5E7EB">Processing (1–3 business days)</td>
      </tr>
    </table>
    <hr class="divider"/>
    <p style="font-size:13px;color:#6B7280;">
      For questions about your earnings, visit
      <a href="${BASE_URL}/earnings" style="color:${PRIMARY_COLOR}">My Earnings</a>.
    </p>`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `[${APP_NAME}] Payout of ${formatted} initiated`,
    html: wrapTemplate('Payout Initiated', body),
    text: `A payout of ${formatted} has been initiated. It should arrive within 1–3 business days.`,
  });
}

/**
 * Send a booking-confirmation email to a learner.
 *
 * @param to           - Learner's email address
 * @param sessionTitle - Human-readable session/course title
 * @param scheduledAt  - Date and time the session is scheduled
 */
export async function sendBookingConfirmation(
  to: string,
  sessionTitle: string,
  scheduledAt: Date,
): Promise<void> {
  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(scheduledAt);

  const body = `
    <h2>Booking Confirmed 📅</h2>
    <p>Your session has been confirmed. Here are the details:</p>
    <table style="border-collapse:collapse;width:100%">
      <tr>
        <td style="padding:8px;border:1px solid #E5E7EB;background:#F9FAFB;width:40%"><strong>Session</strong></td>
        <td style="padding:8px;border:1px solid #E5E7EB">${sessionTitle}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #E5E7EB;background:#F9FAFB"><strong>Scheduled At</strong></td>
        <td style="padding:8px;border:1px solid #E5E7EB">${formattedDate} (IST)</td>
      </tr>
    </table>
    <hr class="divider"/>
    <a href="${BASE_URL}/sessions" class="btn">View My Sessions</a>
    <p style="font-size:13px;color:#6B7280;">
      Need to cancel or reschedule? Visit your
      <a href="${BASE_URL}/sessions" style="color:${PRIMARY_COLOR}">sessions page</a>
      at least 1 hour before the start time.
    </p>`;

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: `[${APP_NAME}] Booking confirmed: ${sessionTitle}`,
    html: wrapTemplate('Booking Confirmed', body),
    text: `Your booking for "${sessionTitle}" scheduled at ${formattedDate} (IST) is confirmed. View at ${BASE_URL}/sessions`,
  });
}
