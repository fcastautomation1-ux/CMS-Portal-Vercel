import { NextResponse } from 'next/server'
import { getPortalBranding } from '@/lib/portal-branding'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const branding = await getPortalBranding()
  return NextResponse.json(branding, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}
