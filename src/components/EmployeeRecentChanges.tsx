'use client'

import { useState, useEffect } from 'react'
import { getEmployeeChangesSummary } from '@/app/actions/employee-history'
import { formatDateTime } from '@/lib/dateUtils'
import { ClockIcon } from '@heroicons/react/24/outline'
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
  // This component requires RPC functions that may not be configured in the database
  // Return null to avoid errors until the required database functions are available
  return null
  
  /* TODO: Enable this component when the following RPC function is available:
  - get_employee_changes_summary
  
  const { hasPermission } = usePermissions()
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const canViewHistory = hasPermission('employees', 'view')

  useEffect(() => {
    if (canViewHistory) {
      loadRecentChanges()
    } else {
      setIsLoading(false)
    }
  }, [employeeId, canViewHistory])

  async function loadRecentChanges() {
    try {
      setIsLoading(true)
      const result = await getEmployeeChangesSummary(employeeId)
      
      if (result.error) {
        console.error('Error loading changes:', result.error)
        // Don't show the component if there's an error
        setChanges([])
      } else if (result.data) {
        setChanges(result.data.slice(0, 5)) // Show only last 5 changes
      }
    } catch (error) {
      console.error('Error loading recent changes:', error)
      // Don't show the component if there's an error
      setChanges([])
    } finally {
      setIsLoading(false)
    }
  }
  */

  /*
  if (!canViewHistory) {
    return null
  }

  if (isLoading) {
    // Don't show loading state since the component will likely fail
    return null
  }

  if (changes.length === 0) {
    return null
  }

  return (
    <div className="bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-sm font-medium text-gray-900 flex items-center mb-3">
          <ClockIcon className="h-4 w-4 mr-1.5" />
          Recent Changes
        </h3>
        <div className="space-y-3">
          {changes.map((change, index) => (
            <div key={index} className="text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-gray-900">{change.summary}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    by {change.changed_by} • {formatDateTime(change.change_date)}
                  </p>
                </div>
              </div>
              {index < changes.length - 1 && (
                <div className="border-t border-gray-100 mt-3"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
  */
}