import { getSession } from '@/lib/auth'
import { getAccounts, getAccountUserAccess } from './actions'
import { AccountsTable } from '@/components/accounts/accounts-table'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Accounts · CMS Portal' }

export default async function AccountsPage() {
  const [user, accounts, userAccess] = await Promise.all([
    getSession(),
    getAccounts().catch(() => []),
    getAccountUserAccess().catch(() => ({})),
  ])
  if (!user) redirect('/login')

  return <AccountsTable accounts={accounts} user={user} userAccess={userAccess} />
}
