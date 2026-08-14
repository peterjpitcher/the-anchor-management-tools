import { NextResponse } from 'next/server'
import { getDeploymentVersion } from '@/lib/foh/deployment-version'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { version: getDeploymentVersion() },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  )
}

