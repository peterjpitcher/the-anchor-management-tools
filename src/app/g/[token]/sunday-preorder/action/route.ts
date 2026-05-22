import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  return NextResponse.redirect(new URL(`/g/${token}/sunday-preorder`, request.url), 303)
}
