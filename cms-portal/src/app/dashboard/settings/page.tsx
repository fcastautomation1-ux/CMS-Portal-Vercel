import { getSmtpConfig } from './actions'
import { SettingsPage } from '@/components/settings/settings-page'

export const metadata = { title: 'Integrations & SMTP — CMS Portal' }

export default async function SettingsRoute() {
  const smtpConfig = await getSmtpConfig()
  return <SettingsPage initialSmtp={smtpConfig} />
}
