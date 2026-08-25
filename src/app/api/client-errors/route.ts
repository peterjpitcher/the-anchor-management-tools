import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDeploymentVersion } from '@/lib/foh/deployment-version'

const MAX_BODY_LENGTH = 4_000
const MAX_FIELD_LENGTH = 500

function text(value: unknown, maxLength: number = MAX_FIELD_LENGTH): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await request.text()
  if (!raw || raw.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.type !== 'chunk_load_recovery') {
    return NextResponse.json({ error: 'Unsupported report type' }, { status: 400 })
  }

  console.warn('[client-recovery]', JSON.stringify({
    type: 'chunk_load_recovery',
    message: text(body.message),
    currentPath: text(body.currentPath, 300),
    intendedPath: text(body.intendedPath, 300) || null,
    clientDeployment: text(body.deploymentVersion, 100),
    serverDeployment: getDeploymentVersion(),
    online: body.online === true,
    recoveryAllowed: body.recoveryAllowed === true,
    occurredAt: text(body.occurredAt, 100),
    userId: user.id,
  }))

  return new NextResponse(null, { status: 204 })
}
