import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { resolveStorageUrl } from '@/lib/storage'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSession()
  if (!user) redirect('/login')

  const supabase = createServerClient()
  const avatarData = await resolveStorageUrl(supabase, user.avatarData ?? null)
  const enrichedUser = { ...user, avatarData }

  return (
    <DashboardShell user={enrichedUser}>{children}</DashboardShell>
  )
}
