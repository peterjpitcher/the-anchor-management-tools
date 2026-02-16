import { NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { GET as runOjProjectsBilling } from '@/app/api/cron/oj-projects-billing/route'

export async function GET(request: Request) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const url = new URL(request.url)
  const vendorId = url.searchParams.get('vendor_id')
  if (!vendorId) {
    return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 })
  }

  const cronUrl = new URL('/api/cron/oj-projects-billing', url.origin)
  cronUrl.searchParams.set('dry_run', 'true')
  cronUrl.searchParams.set('force', 'true')
  cronUrl.searchParams.set('vendor_id', vendorId)

  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is required to invoke preview billing run' },
      { status: 500 }
    )
  }
  const headers = new Headers()
  headers.set('authorization', `Bearer ${cronSecret}`)

  const cronRequest = new Request(cronUrl.toString(), { headers, method: 'GET' })
  return runOjProjectsBilling(cronRequest)
}
