import { getPortalBranding, getSmtpConfig } from './actions'
import { SettingsPage } from '@/components/settings/settings-page'

export const metadata = { title: 'Integrations & SMTP — CMS Portal' }

export default async function SettingsRoute() {
  const [smtpConfig, branding] = await Promise.all([
    getSmtpConfig(),
    getPortalBranding(),
  ])
  return <SettingsPage initialSmtp={smtpConfig} initialBranding={branding} />
}
