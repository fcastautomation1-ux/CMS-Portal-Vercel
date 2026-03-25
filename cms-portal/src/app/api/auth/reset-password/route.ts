import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildLegacyPasswordFields } from '@/lib/password'

export const dynamic = 'force-dynamic'

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token?: unknown; newPassword?: unknown }
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!token) {
      return NextResponse.json({ success: false, error: 'Invalid or missing token.' }, { status: 400 })
    }
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Validate token
    const { data: tokenRow, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('id, username, expires_at, used')
      .eq('token', token)
      .single()

    if (tokenError || !tokenRow) {
      return NextResponse.json({ success: false, error: 'Invalid or expired reset link.' }, { status: 400 })
    }

    const row = tokenRow as { id: string; username: string; expires_at: string; used: boolean }

    if (row.used) {
      return NextResponse.json({ success: false, error: 'This reset link has already been used.' }, { status: 400 })
    }

    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'This reset link has expired. Please request a new one.' }, { status: 400 })
    }

    // Update password
    const passwordFields = buildLegacyPasswordFields(newPassword)
    const { error: updateError } = await supabase
      .from('users')
      .update(passwordFields as Record<string, unknown>)
      .eq('username', row.username)

    if (updateError) {
      console.error('[reset-password] failed to update password:', updateError.message)
      return NextResponse.json({ success: false, error: 'Failed to update password. Please try again.' }, { status: 500 })
    }

    // Mark token as used
    await supabase
      .from('password_reset_tokens')
      .update({ used: true })
      .eq('id', row.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[reset-password] unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
