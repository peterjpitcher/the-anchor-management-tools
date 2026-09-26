'use client'

import { useEffect, useState } from 'react'
import { getEmployeeChangesSummary } from '@/app/actions/employee-history'
import { formatDateTime } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'
import { Alert, Card, CardBody, CardHeader, Empty, PageLoading } from '@/ds'

interface ChangeRecord {
  change_date: string
  changed_by: string
  operation_type: string
  fields_changed: string[]
  summary: string
}

interface EmployeeRecentChangesProps {
  employeeId: string
}

export function EmployeeRecentChanges({ employeeId }: EmployeeRecentChangesProps): React.JSX.Element {
  const { hasPermission } = usePermissions()
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canViewHistory = hasPermission('employees', 'view')

  useEffect(() => {
    let isMounted = true

    const loadRecentChanges = async () => {
      if (!canViewHistory) {
        if (isMounted) {
          setChanges([])
          setError('You do not have permission to view recent changes.')
          setIsLoading(false)
        }
        return
      }

      try {
        setIsLoading(true)
        setError(null)
        const result = await getEmployeeChangesSummary(employeeId)

        if (!isMounted) {
          return
        }

        if (result.error) {
          console.error('Error loading employee changes:', result.error)
          setChanges([])
          setError('Recent changes are temporarily unavailable.')
        } else if (result.data) {
          setChanges(result.data.slice(0, 5))
        } else {
          setChanges([])
        }
      } catch (loadError) {
        console.error('Error loading employee changes:', loadError)
        if (isMounted) {
          setChanges([])
          setError('Recent changes are temporarily unavailable.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadRecentChanges()

    return () => {
      isMounted = false
    }
  }, [employeeId, canViewHistory])

  const body = (() => {
    if (!canViewHistory) {
      return <p className="text-sm text-text-muted">You do not have permission to view recent changes.</p>
    }

    if (isLoading) {
      return <PageLoading inline label="Loading recent changes" className="py-6" />
    }

    // A failed load says so; it is never shown as "no changes".
    if (error) {
      return <Alert tone="danger" size="sm">{error}</Alert>
    }

    if (changes.length === 0) {
      return <Empty size="sm" title="No recent changes recorded" />
    }

    return (
      <ul className="divide-y divide-border">
        {changes.map((change, index) => (
          <li key={`${change.change_date}-${index}`} className="py-3 text-sm first:pt-0 last:pb-0">
            <p className="text-text">{change.summary || 'Employee record updated'}</p>
            <p className="mt-1 text-xs text-text-muted">
              by {change.changed_by || 'System'} • {formatDateTime(change.change_date)}
            </p>
          </li>
        ))}
      </ul>
    )
  })()

  return (
    <Card>
      <CardHeader title="Recent Changes" />
      <CardBody>{body}</CardBody>
    </Card>
  )
}
