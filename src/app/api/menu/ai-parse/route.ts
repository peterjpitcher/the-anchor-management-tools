import { NextResponse } from 'next/server'
import { parseIngredientWithAI } from '@/app/actions/ai-menu-parsing'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawData = typeof body?.rawData === 'string' ? body.rawData : ''

    if (!rawData.trim()) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 })
    }

    const result = await parseIngredientWithAI(rawData)

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Failed to parse data' }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: result.data, usage: result.usage })
  } catch (error) {
    console.error('AI parse route error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
