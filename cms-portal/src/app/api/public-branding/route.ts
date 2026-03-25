import { NextResponse } from 'next/server'
import { getPortalBranding } from '@/lib/portal-branding'

export const revalidate = 300

export async function GET() {
  const branding = await getPortalBranding()
  return NextResponse.json(branding, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
