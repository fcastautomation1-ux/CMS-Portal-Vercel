import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SmtpSettings {
  host: string
  port: number
  username: string
  password: string
  from_name: string
  from_email: string
  encryption: 'none' | 'ssl' | 'tls'
  enabled: boolean
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

// ── Transporter ───────────────────────────────────────────────────────────────

async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data, error } = await supabase
    .from('smtp_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  const d = data as Record<string, unknown>
  const settings: SmtpSettings = {
    host: (d.host as string) ?? '',
    port: (d.port as number) ?? 587,
    username: (d.username as string) ?? '',
    password: (d.password as string) ?? '',
    from_name: (d.from_name as string) ?? '',
    from_email: (d.from_email as string) ?? '',
    encryption: ((d.encryption as string) ?? 'tls') as SmtpSettings['encryption'],
    enabled: (d.enabled as boolean) ?? true,
  }
  if (!settings.enabled) return null
  return settings
}

async function createTransporter(): Promise<nodemailer.Transporter | null> {
  const cfg = await getSmtpSettings()
  if (!cfg) return null

  const secure = cfg.encryption === 'ssl'
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.username, pass: cfg.password },
    ...(cfg.encryption === 'tls' ? { requireTLS: true } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  })
}

// ── Send ──────────────────────────────────────────────────────────────────────

export async function sendEmail(
  opts: SendEmailOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const transport = await createTransporter()
    if (!transport) {
      return { success: false, error: 'Email sending is not configured. Please set up SMTP settings.' }
    }

    const cfg = await getSmtpSettings()
    if (!cfg) return { success: false, error: 'SMTP settings not found.' }

    await transport.sendMail({
      from: `"${cfg.from_name}" <${cfg.from_email}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[email] sendEmail failed:', message)
    return { success: false, error: message }
  }
}

/** Verify SMTP connection without sending an email. Used by the Settings test button. */
export async function verifySmtpConnection(
  overrideSettings?: SmtpSettings
): Promise<{ success: boolean; message: string }> {
  try {
    const cfg = overrideSettings ?? (await getSmtpSettings())
    if (!cfg) {
      return { success: false, message: 'SMTP settings not found or email sending is disabled.' }
    }

    const secure = cfg.encryption === 'ssl'
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure,
      auth: { user: cfg.username, pass: cfg.password },
      ...(cfg.encryption === 'tls' ? { requireTLS: true } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    })

    await transport.verify()
    return { success: true, message: `Connected successfully to ${cfg.host}:${cfg.port}. SMTP credentials verified.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return { success: false, message: `SMTP connection failed: ${message}` }
  }
}

// ── Email Templates ───────────────────────────────────────────────────────────

const BASE_STYLES = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #1e293b;
`

function emailShell(title: string, content: string, portalName = 'CMS Portal'): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#7C3AED,#6D28D9);padding:32px 40px;text-align:center;">
        <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:10px;padding:8px 12px;margin-bottom:12px;">
          <span style="color:white;font-weight:700;font-size:16px;">${portalName}</span>
        </div>
        <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">${title}</h1>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px 40px;${BASE_STYLES}">${content}</td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">This email was sent by ${portalName}. Do not reply to this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

export function renderPasswordResetEmail(resetUrl: string, username: string): { html: string; text: string } {
  const html = emailShell(
    'Reset Your Password',
    `<p style="margin:0 0 20px;">Hi <strong>${username}</strong>,</p>
    <p style="margin:0 0 20px;color:#475569;">We received a request to reset your password. Click the button below to choose a new one.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;">Reset Password</a>
    </div>
    <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Or copy and paste this link:</p>
    <p style="margin:0 0 24px;word-break:break-all;"><a href="${resetUrl}" style="color:#7C3AED;font-size:13px;">${resetUrl}</a></p>
    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px;margin-top:24px;">
      <p style="margin:0;color:#92400e;font-size:13px;"><strong>⚠ This link expires in 1 hour.</strong> If you did not request a password reset, you can safely ignore this email.</p>
    </div>`
  )

  const text = `Hi ${username},\n\nWe received a request to reset your password.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, ignore this email.`

  return { html, text }
}

export function renderPasswordChangedEmail(username: string): { html: string; text: string } {
  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const html = emailShell(
    'Your Password Was Changed',
    `<p style="margin:0 0 20px;">Hi <strong>${username}</strong>,</p>
    <p style="margin:0 0 20px;color:#475569;">Your portal password was successfully changed on <strong>${now}</strong>.</p>
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:14px;margin-top:8px;">
      <p style="margin:0;color:#991b1b;font-size:13px;"><strong>🔒 If you didn't make this change</strong>, please contact your portal administrator immediately.</p>
    </div>`
  )

  const text = `Hi ${username},\n\nYour portal password was changed on ${now}.\n\nIf you didn't make this change, contact your administrator immediately.`

  return { html, text }
}

export function renderTaskAssignedEmail(username: string, taskTitle: string, assignedBy: string, portalUrl: string): { html: string; text: string } {
  const html = emailShell(
    'Task Assigned to You',
    `<p style="margin:0 0 20px;">Hi <strong>${username}</strong>,</p>
    <p style="margin:0 0 20px;color:#475569;"><strong>${assignedBy}</strong> has assigned you a task:</p>
    <div style="background:#f8fafc;border-left:4px solid #7C3AED;border-radius:4px;padding:16px 20px;margin:0 0 28px;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#1e293b;">${taskTitle}</p>
    </div>
    <div style="text-align:center;margin:28px 0;">
      <a href="${portalUrl}/dashboard/tasks" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;">View Task</a>
    </div>`
  )

  const text = `Hi ${username},\n\n${assignedBy} assigned you a task: "${taskTitle}"\n\nView it at: ${portalUrl}/dashboard/tasks`

  return { html, text }
}

export function renderTaskReminderEmail(username: string, taskTitle: string, daysText: string, portalUrl: string): { html: string; text: string } {
  const isOverdue = daysText.includes('overdue')
  const badgeColor = isOverdue ? '#fee2e2' : '#fef3c7'
  const badgeBorder = isOverdue ? '#fca5a5' : '#fbbf24'
  const badgeText = isOverdue ? '#991b1b' : '#92400e'
  const emoji = isOverdue ? '🔴' : '⏰'

  const html = emailShell(
    'Task Reminder',
    `<p style="margin:0 0 20px;">Hi <strong>${username}</strong>,</p>
    <p style="margin:0 0 16px;color:#475569;">This is a reminder about a task that requires your attention:</p>
    <div style="background:#f8fafc;border-left:4px solid #7C3AED;border-radius:4px;padding:16px 20px;margin:0 0 16px;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#1e293b;">${taskTitle}</p>
    </div>
    <div style="background:${badgeColor};border:1px solid ${badgeBorder};border-radius:8px;padding:12px 16px;margin-bottom:28px;">
      <p style="margin:0;color:${badgeText};font-size:13px;font-weight:600;">${emoji} Due ${daysText}</p>
    </div>
    <div style="text-align:center;">
      <a href="${portalUrl}/dashboard/tasks" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;">Open Task</a>
    </div>`
  )

  const text = `Hi ${username},\n\nReminder: "${taskTitle}" is due ${daysText}.\n\nView your tasks at: ${portalUrl}/dashboard/tasks`

  return { html, text }
}
