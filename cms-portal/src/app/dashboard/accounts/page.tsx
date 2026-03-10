import { getSession } from '@/lib/auth'
import { getAccounts } from './actions'
import { AccountsTable } from '@/components/accounts/accounts-table'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Accounts · CMS Portal' }

export default async function AccountsPage() {
  const user = await getSession()
  if (!user) redirect('/login')

  const accounts = await getAccounts()

  return <AccountsTable accounts={accounts} user={user} />
}
