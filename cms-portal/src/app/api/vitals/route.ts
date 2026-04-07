import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { metric, value, url } = body as { metric: string; value: number; url: string }

    if (!metric || value === undefined) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Log to console in development / server logs in production.
    // Replace this with your analytics provider (e.g. Vercel Analytics, Segment, Datadog).
    console.log(`[WebVitals] metric=${metric} value=${value} url=${url}`)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
