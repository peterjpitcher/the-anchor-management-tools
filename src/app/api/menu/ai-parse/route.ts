import { NextResponse } from 'next/server'
import { parseIngredientWithAI } from '@/app/actions/ai-menu-parsing'
import { checkUserPermission } from '@/app/actions/rbac'

export const dynamic = 'force-dynamic'
const MAX_AI_PARSE_INPUT_CHARS = 120_000

export async function POST(request: Request) {
  try {
    const canManageMenu = await checkUserPermission('menu_management', 'manage')
    if (!canManageMenu) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const rawData = typeof body?.rawData === 'string' ? body.rawData : ''

    if (!rawData.trim()) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 })
    }

    if (rawData.length > MAX_AI_PARSE_INPUT_CHARS) {
      return NextResponse.json(
        { success: false, error: `Input too large (max ${MAX_AI_PARSE_INPUT_CHARS.toLocaleString()} characters)` },
        { status: 413 }
      )
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
