import { NextResponse } from 'next/server'
import { getUserCurrentHall } from '@/app/dashboard/tasks/actions'

export async function GET() {
  try {
    const hall = await getUserCurrentHall()
    return NextResponse.json(hall)
  } catch (error) {
    console.error('Error fetching user hall:', error)
    return NextResponse.json(null)
  }
}