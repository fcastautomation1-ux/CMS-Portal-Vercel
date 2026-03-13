import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSession()
  if (!user) redirect('/login')

  // Fetch avatar_data fresh from the DB on every render.
  // Base64 images are too large to store reliably in a JWT cookie (~4 KB limit),
  // so we read the latest value directly here and merge it into the session user.
  const supabase = createServerClient()
  const { data: profileRow } = await supabase
    .from('users')
    .select('avatar_data')
    .eq('username', user.username)
    .single()
  const avatarData =
    (profileRow as { avatar_data?: string | null } | null)?.avatar_data ?? user.avatarData ?? null
  const enrichedUser = { ...user, avatarData }

  return (
    <DashboardShell user={enrichedUser}>{children}</DashboardShell>
  )
}
