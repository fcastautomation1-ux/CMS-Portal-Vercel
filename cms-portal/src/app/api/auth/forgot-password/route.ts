import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, renderPasswordResetEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    // Always return 200 — never reveal whether the email exists (prevents enumeration)
    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: true })
    }

    const supabase = createServiceClient()

    // Look up user by email
    const { data: user } = await supabase
      .from('users')
      .select('username, email')
      .ilike('email', email)
      .single()

    if (!user) {
      // User not found — return 200 silently
      return NextResponse.json({ success: true })
    }

    const username = (user as Record<string, unknown>).username as string

    // Rate-limit: max 3 tokens per username in the last 15 minutes
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('password_reset_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('username', username)
      .gte('created_at', cutoff)

    if ((count ?? 0) >= 3) {
      // Rate limited — return 200 silently (no email sent)
      return NextResponse.json({ success: true })
    }

    // Generate a secure 256-bit token
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

    const { error: insertError } = await supabase
      .from('password_reset_tokens')
      .insert({ username, token, expires_at: expiresAt })

    if (insertError) {
      console.error('[forgot-password] failed to insert token:', insertError.message)
      return NextResponse.json({ success: true }) // Still return 200
    }

    // Build reset URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const resetUrl = `${baseUrl}/reset-password?token=${token}`

    const { html, text } = renderPasswordResetEmail(resetUrl, username)

    // Fire-and-forget: don't block the response on email delivery
    sendEmail({
      to: (user as Record<string, unknown>).email as string,
      subject: 'Reset your password',
      html,
      text,
    }).catch((err: unknown) => {
      console.error('[forgot-password] email send failed:', err)
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[forgot-password] unexpected error:', err)
    // Always return 200 to prevent information leakage
    return NextResponse.json({ success: true })
  }
}
