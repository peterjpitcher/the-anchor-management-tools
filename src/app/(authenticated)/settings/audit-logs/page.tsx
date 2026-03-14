import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listAuditLogs, listAuditLogUsers } from '@/app/actions/auditLogs'
import AuditLogsClient from './AuditLogsClient'

export default async function AuditLogsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const [result, usersResult] = await Promise.all([
    listAuditLogs(),
    listAuditLogUsers(),
  ])

  return (
    <AuditLogsClient
      initialLogs={result.logs ?? []}
      initialTotalCount={result.totalCount ?? 0}
      pageSize={result.pageSize}
      initialPage={result.page}
      initialFilters={result.filters}
      initialError={result.error ?? null}
      availableUsers={usersResult.users ?? []}
    />
  )
}
