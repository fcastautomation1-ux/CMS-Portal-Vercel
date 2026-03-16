import { NextResponse } from 'next/server'
import { getPortalBranding } from '@/lib/portal-branding'

export async function GET() {
  const branding = await getPortalBranding()
  return NextResponse.json(branding)
}
