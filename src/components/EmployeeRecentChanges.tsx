'use client'

import { useEffect, useState } from 'react'
import { getEmployeeChangesSummary } from '@/app/actions/employee-history'
import { formatDateTime } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'

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

export function EmployeeRecentChanges({ employeeId }: EmployeeRecentChangesProps) {
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-sm text-gray-500">Loading recent changes…</span>
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-gray-500">{error}</p>
  }

  if (changes.length === 0) {
    return <p className="text-sm text-gray-500">No recent changes recorded.</p>
  }

  return (
    <div className="space-y-3">
      {changes.map((change, index) => (
        <div key={`${change.change_date}-${index}`} className="text-sm">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-gray-900">{change.summary || 'Employee record updated'}</p>
              <p className="text-gray-500 text-xs mt-1">
                by {change.changed_by || 'System'} • {formatDateTime(change.change_date)}
              </p>
            </div>
          </div>
          {index < changes.length - 1 && <div className="border-t border-gray-100 mt-3" />}
        </div>
      ))}
    </div>
  )
}
