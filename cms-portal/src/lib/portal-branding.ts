import { createServerClient } from '@/lib/supabase/server'
import { resolveStorageUrl } from '@/lib/storage'

export interface PortalBranding {
  portal_name: string
  portal_tagline: string
  logo_path: string | null
  logo_url: string | null
}

const DEFAULT_BRANDING: PortalBranding = {
  portal_name: 'CMS Portal',
  portal_tagline: 'Operations Hub',
  logo_path: null,
  logo_url: null,
}

export async function getPortalBranding(): Promise<PortalBranding> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('portal_settings')
    .select('portal_name, portal_tagline, logo_path')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return DEFAULT_BRANDING

  const portalName = (data.portal_name as string | null)?.trim() || DEFAULT_BRANDING.portal_name
  const portalTagline = (data.portal_tagline as string | null)?.trim() || DEFAULT_BRANDING.portal_tagline
  const logoPath = (data.logo_path as string | null) ?? null
  const logoUrl = await resolveStorageUrl(supabase, logoPath)

  return {
    portal_name: portalName,
    portal_tagline: portalTagline,
    logo_path: logoPath,
    logo_url: logoUrl,
  }
}
