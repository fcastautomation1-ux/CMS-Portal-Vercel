'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

export interface SmtpConfig {
  id?: string
  host: string
  port: number
  username: string
  password: string
  from_name: string
  from_email: string
  encryption: 'none' | 'ssl' | 'tls'
  enabled: boolean
  updated_at?: string
}

// ── Fetch ─────────────────────────────────────────────────────
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const user = await getSession()
  if (!user) return null
  if (user.role !== 'Admin' && user.role !== 'Super Manager') return null

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('smtp_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  const d = data as Record<string, unknown>
  return {
    id: d.id as string,
    host: (d.host as string) ?? '',
    port: (d.port as number) ?? 587,
    username: (d.username as string) ?? '',
    password: (d.password as string) ?? '',
    from_name: (d.from_name as string) ?? '',
    from_email: (d.from_email as string) ?? '',
    encryption: ((d.encryption as string) ?? 'tls') as SmtpConfig['encryption'],
    enabled: (d.enabled as boolean) ?? true,
    updated_at: d.updated_at as string,
  }
}

// ── Save (upsert) ─────────────────────────────────────────────
export async function saveSmtpConfig(
  cfg: Omit<SmtpConfig, 'id' | 'updated_at'>
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (user.role !== 'Admin' && user.role !== 'Super Manager') {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()

  // Try to get existing row id
  const { data: existing } = await supabase
    .from('smtp_settings')
    .select('id')
    .limit(1)
    .single()

  const payload = {
    host: cfg.host.trim(),
    port: cfg.port,
    username: cfg.username.trim(),
    password: cfg.password,
    from_name: cfg.from_name.trim(),
    from_email: cfg.from_email.trim(),
    encryption: cfg.encryption,
    enabled: cfg.enabled,
    updated_at: new Date().toISOString(),
    updated_by: user.username,
  }

  let error
  if (existing?.id) {
    ;({ error } = await supabase
      .from('smtp_settings')
      .update(payload)
      .eq('id', existing.id))
  } else {
    ;({ error } = await supabase.from('smtp_settings').insert(payload))
  }

  if (error) {
    // If table doesn't exist yet, return a helpful message
    if (error.message.includes('does not exist') || error.code === '42P01') {
      return {
        success: false,
        error: 'The smtp_settings table does not exist in your Supabase project. Please create it first (see Supabase SQL Editor).',
      }
    }
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/settings')
  return { success: true }
}

// ── Test connection (basic validation) ────────────────────────
export async function testSmtpConnection(
  cfg: Omit<SmtpConfig, 'id' | 'updated_at'>
): Promise<{ success: boolean; message: string }> {
  const user = await getSession()
  if (!user) return { success: false, message: 'Not authenticated.' }
  if (user.role !== 'Admin' && user.role !== 'Super Manager') {
    return { success: false, message: 'Permission denied.' }
  }

  // Basic validation only — actual network test requires a backend SMTP library
  if (!cfg.host || cfg.host.length < 3) {
    return { success: false, message: 'Invalid SMTP host.' }
  }
  if (!cfg.port || cfg.port < 1 || cfg.port > 65535) {
    return { success: false, message: 'Invalid port number (1-65535).' }
  }
  if (!cfg.from_email.includes('@')) {
    return { success: false, message: 'Invalid "From" email address.' }
  }
  if (!cfg.username) {
    return { success: false, message: 'SMTP username is required.' }
  }

  return {
    success: true,
    message: `Configuration looks valid. To fully test delivery, save and send a test email from your server using these settings: ${cfg.host}:${cfg.port} (${cfg.encryption.toUpperCase()}).`,
  }
}
