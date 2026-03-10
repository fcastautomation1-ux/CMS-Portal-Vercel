import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSession()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <Sidebar user={user} />
      <Topbar user={user} />
      <main
        className="min-h-screen"
        style={{
          marginLeft: 'var(--sidebar-width)',
          paddingTop: 'var(--topbar-height)',
        }}
      >
        <div className="p-5">{children}</div>
      </main>
    </div>
  )
}
