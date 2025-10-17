import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listAuditLogs } from '@/app/actions/auditLogs'
import AuditLogsClient from './AuditLogsClient'

export default async function AuditLogsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const result = await listAuditLogs()

  return (
    <AuditLogsClient
      initialLogs={result.logs ?? []}
      initialTotalCount={result.totalCount ?? 0}
      pageSize={result.pageSize}
      initialPage={result.page}
      initialFilters={result.filters}
      initialError={result.error ?? null}
    />
  )
}
