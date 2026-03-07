import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  return NextResponse.redirect(new URL(`/g/${token}/card-capture`, _request.url))
}
