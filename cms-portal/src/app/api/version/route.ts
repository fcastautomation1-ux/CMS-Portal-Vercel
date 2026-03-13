import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    'dev'

  return NextResponse.json({ version })
}
