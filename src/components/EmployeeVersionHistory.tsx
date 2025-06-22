'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDateTime } from '@/lib/dateUtils'
import { ClockIcon, ArrowPathIcon, UserIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { usePermissions } from '@/contexts/PermissionContext'

interface VersionRecord {
  id: string
  created_at: string
  user_email: string
  operation_type: string
  version_number: number
  old_values: any
  new_values: any
}

interface FieldChange {
  field_name: string
  version1_value: string
  version2_value: string
  changed: boolean
}

interface EmployeeVersionHistoryProps {
  employeeId: string
  employeeName?: string
}

export function EmployeeVersionHistory({ employeeId, employeeName }: EmployeeVersionHistoryProps) {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [selectedVersions, setSelectedVersions] = useState<[number | null, number | null]>([null, null])
  const [comparison, setComparison] = useState<FieldChange[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showComparison, setShowComparison] = useState(false)

  const canViewHistory = hasPermission('employees', 'view')
  const canRestore = hasPermission('employees', 'manage')

  useEffect(() => {
    if (canViewHistory) {
      loadVersionHistory()
    }
  }, [employeeId])

  async function loadVersionHistory() {
    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('employee_version_history')
        .select('*')
        .eq('employee_id', employeeId)
        .order('version_number', { ascending: false })

      if (error) throw error
      setVersions(data || [])
    } catch (error) {
      console.error('Error loading version history:', error)
      toast.error('Failed to load version history')
    } finally {
      setIsLoading(false)
    }
  }

  async function compareVersions() {
    if (!selectedVersions[0] || !selectedVersions[1]) {
      toast.error('Please select two versions to compare')
      return
    }

    try {
      const { data, error } = await supabase.rpc('compare_employee_versions', {
        p_employee_id: employeeId,
        p_version1: selectedVersions[0],
        p_version2: selectedVersions[1]
      })

      if (error) throw error
      setComparison(data || [])
      setShowComparison(true)
    } catch (error) {
      console.error('Error comparing versions:', error)
      toast.error('Failed to compare versions')
    }
  }

  async function restoreVersion(versionNumber: number) {
    if (!canRestore) {
      toast.error('You do not have permission to restore versions')
      return
    }

    const confirmMsg = `Are you sure you want to restore this employee to version ${versionNumber}? This will overwrite the current data.`
    if (!confirm(confirmMsg)) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase.rpc('restore_employee_version', {
        p_employee_id: employeeId,
        p_version_number: versionNumber,
        p_user_id: user.id
      })

      if (error) throw error
      
      toast.success(`Successfully restored to version ${versionNumber}`)
      await loadVersionHistory()
    } catch (error) {
      console.error('Error restoring version:', error)
      toast.error('Failed to restore version')
    }
  }

  if (!canViewHistory) {
    return (
      <div className="text-center py-8 text-gray-500">
        You do not have permission to view version history
      </div>
    )
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading version history...</div>
  }

  const formatFieldName = (fieldName: string) => {
    return fieldName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatFieldValue = (value: any) => {
    if (value === null || value === undefined) return '<empty>'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <ClockIcon className="h-5 w-5 mr-2" />
            Version History
          </h3>
          
          {versions.length === 0 ? (
            <p className="mt-4 text-gray-500">No version history available</p>
          ) : (
            <>
              <div className="mt-4 flex items-center space-x-4">
                <button
                  onClick={compareVersions}
                  disabled={!selectedVersions[0] || !selectedVersions[1]}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Compare Selected Versions
                </button>
                {selectedVersions[0] && selectedVersions[1] && (
                  <span className="text-sm text-gray-600">
                    Comparing version {selectedVersions[0]} with version {selectedVersions[1]}
                  </span>
                )}
              </div>

              <div className="mt-4 overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Compare
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Version
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Date & Time
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Changed By
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Operation
                      </th>
                      <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {versions.map((version) => (
                      <tr key={version.id}>
                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            checked={selectedVersions.includes(version.version_number)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (!selectedVersions[0]) {
                                  setSelectedVersions([version.version_number, null])
                                } else if (!selectedVersions[1] && selectedVersions[0] !== version.version_number) {
                                  setSelectedVersions([selectedVersions[0], version.version_number])
                                }
                              } else {
                                setSelectedVersions(prev => 
                                  prev.map(v => v === version.version_number ? null : v) as [number | null, number | null]
                                )
                              }
                            }}
                            disabled={
                              selectedVersions[0] !== null && 
                              selectedVersions[1] !== null && 
                              !selectedVersions.includes(version.version_number)
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-gray-900">
                          {version.version_number}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          {formatDateTime(version.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          <div className="flex items-center">
                            <UserIcon className="h-4 w-4 mr-1" />
                            {version.user_email}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                          <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                            version.operation_type === 'create' ? 'bg-green-100 text-green-800' :
                            version.operation_type === 'update' ? 'bg-blue-100 text-blue-800' :
                            version.operation_type === 'delete' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {version.operation_type}
                          </span>
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          {canRestore && version.version_number > 1 && (
                            <button
                              onClick={() => restoreVersion(version.version_number)}
                              className="text-indigo-600 hover:text-indigo-900"
                            >
                              <ArrowPathIcon className="h-5 w-5" />
                              <span className="sr-only">Restore this version</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {showComparison && comparison.length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium leading-6 text-gray-900">
                Version Comparison
              </h3>
              <button
                onClick={() => setShowComparison(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Field
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Version {selectedVersions[0]}
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Version {selectedVersions[1]}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {comparison.map((field) => (
                    <tr key={field.field_name} className={field.changed ? 'bg-yellow-50' : ''}>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-gray-900">
                        {formatFieldName(field.field_name)}
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-500">
                        {formatFieldValue(field.version1_value)}
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-500">
                        {field.changed ? (
                          <span className="font-medium text-gray-900">
                            {formatFieldValue(field.version2_value)}
                          </span>
                        ) : (
                          formatFieldValue(field.version2_value)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}