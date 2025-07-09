'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDateTime } from '@/lib/dateUtils'
import { ClockIcon, UserIcon } from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'

interface AuditLogEntry {
  id: string
  created_at: string
  user_email: string
  operation_type: string
  resource_type: string
  resource_id: string
  operation_status: string
  old_values: any
  new_values: any
  additional_info: any
}

interface EmployeeAuditTrailProps {
  employeeId: string
  employeeName?: string
}

export function EmployeeAuditTrail({ employeeId, employeeName }: EmployeeAuditTrailProps) {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const canViewAudit = hasPermission('employees', 'view')

  useEffect(() => {
    if (canViewAudit) {
      loadAuditLogs()
    } else {
      setIsLoading(false)
    }
  }, [employeeId, canViewAudit])

  async function loadAuditLogs() {
    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('resource_type', 'employee')
        .eq('resource_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        console.error('Error loading audit logs:', error)
      } else {
        setAuditLogs(data || [])
      }
    } catch (error) {
      console.error('Error loading audit trail:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!canViewAudit) {
    return (
      <div className="text-center py-8 text-gray-500">
        You do not have permission to view audit history
      </div>
    )
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading audit trail...</div>
  }

  const getActionLabel = (log: AuditLogEntry) => {
    const operationType = log.operation_type
    const additionalInfo = log.additional_info
    
    // Check if there's a specific action in additional_info
    if (additionalInfo?.action) {
      const specificActions: Record<string, string> = {
        'add_emergency_contact': 'added emergency contact',
        'update_financial_details': 'updated financial details',
        'update_health_records': 'updated health records',
        'update_right_to_work': 'updated right to work',
        'update_onboarding_checklist': 'updated onboarding checklist'
      }
      return specificActions[additionalInfo.action] || additionalInfo.action
    }
    
    const actionLabels: Record<string, string> = {
      'create': 'created',
      'update': 'updated',
      'delete': 'deleted',
      'upload': 'uploaded file',
      'download': 'downloaded file',
      'view': 'viewed',
      'add_note': 'added note',
      'delete_note': 'deleted note',
      'add_attachment': 'added attachment',
      'delete_attachment': 'deleted attachment'
    }
    return actionLabels[operationType] || operationType
  }

  const getActionColor = (operationType: string) => {
    if (operationType === 'create') return 'bg-green-100 text-green-800'
    if (operationType === 'delete' || operationType.includes('delete')) return 'bg-red-100 text-red-800'
    if (operationType === 'update' || operationType.includes('update')) return 'bg-blue-100 text-blue-800'
    return 'bg-gray-100 text-gray-800'
  }

  const formatDetails = (log: AuditLogEntry) => {
    const changes: string[] = []
    
    // Check additional_info for details
    if (log.additional_info) {
      // For field changes, make them more readable
      if (log.additional_info.fields_changed && Array.isArray(log.additional_info.fields_changed)) {
        const fieldNames = log.additional_info.fields_changed.map((field: string) => {
          return field.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ')
        })
        changes.push(`Updated: ${fieldNames.join(', ')}`)
      }
      
      if (log.additional_info.action) {
        // Don't add redundant info, the action is already shown in the main text
      }
      
      if (log.additional_info.note_preview) {
        changes.push(`"${log.additional_info.note_preview.substring(0, 80)}${log.additional_info.note_preview.length > 80 ? '...' : ''}"`)
      }
      
      if (log.additional_info.file_name) {
        changes.push(`File: ${log.additional_info.file_name}`)
      }
      
      if (log.additional_info.contact_name) {
        changes.push(`Contact: ${log.additional_info.contact_name}`)
      }
      
      if (log.additional_info.field && log.additional_info.checked !== undefined) {
        const fieldLabel = log.additional_info.field
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l: string) => l.toUpperCase())
        changes.push(`${fieldLabel}: ${log.additional_info.checked ? '✓ Checked' : '☐ Unchecked'}`)
      }
      
      if (log.additional_info.document_type) {
        changes.push(`Document: ${log.additional_info.document_type}`)
      }
      
      if (log.additional_info.fields_updated && Array.isArray(log.additional_info.fields_updated)) {
        const count = log.additional_info.fields_updated.length
        changes.push(`${count} field${count > 1 ? 's' : ''} updated`)
      }
    }
    
    // Check for specific changes in old/new values
    if (log.old_values && log.new_values) {
      // Status change
      if (log.old_values.status && log.new_values.status && log.old_values.status !== log.new_values.status) {
        changes.push(`Status: ${log.old_values.status} → ${log.new_values.status}`)
      }
      
      // Job title change
      if (log.old_values.job_title && log.new_values.job_title && log.old_values.job_title !== log.new_values.job_title) {
        changes.push(`Job Title: ${log.old_values.job_title} → ${log.new_values.job_title}`)
      }
      
      // Email change
      if (log.old_values.email_address && log.new_values.email_address && log.old_values.email_address !== log.new_values.email_address) {
        changes.push(`Email: ${log.old_values.email_address} → ${log.new_values.email_address}`)
      }
    }
    
    return changes.length > 0 ? changes.join(' • ') : null
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <ClockIcon className="h-5 w-5 mr-2" />
            Audit Trail
          </h3>
          
          {auditLogs.length === 0 ? (
            <p className="mt-4 text-gray-500">No audit history available</p>
          ) : (
            <div className="mt-4 flow-root">
              <ul className="-mb-8">
                {auditLogs.map((log, idx) => (
                  <li key={log.id}>
                    <div className="relative pb-8">
                      {idx !== auditLogs.length - 1 ? (
                        <span
                          className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                          aria-hidden="true"
                        />
                      ) : null}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${getActionColor(log.operation_type)}`}>
                            <UserIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                          <div>
                            <p className="text-sm text-gray-900">
                              <span className="font-medium">{log.user_email || 'System'}</span>{' '}
                              {getActionLabel(log)}
                              {employeeName && log.operation_type === 'create' && (
                                <span> employee record for {employeeName}</span>
                              )}
                              {log.operation_type !== 'create' && ' employee record'}
                            </p>
                            {formatDetails(log) && (
                              <p className="mt-0.5 text-sm text-gray-500">
                                {formatDetails(log)}
                              </p>
                            )}
                          </div>
                          <div className="whitespace-nowrap text-right text-sm text-gray-500">
                            <time dateTime={log.created_at}>
                              {formatDateTime(log.created_at)}
                            </time>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}