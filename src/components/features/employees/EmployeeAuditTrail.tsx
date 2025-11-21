'use client'

import { useMemo } from 'react'
import { formatDateTime } from '@/lib/dateUtils'
import { ClockIcon, UserIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { AuditLogEntry, EmployeeNoteWithAuthor } from '@/app/actions/employeeDetails'

interface EmployeeAuditTrailProps {
  employeeId: string
  employeeName?: string
  auditLogs: AuditLogEntry[]
  notes?: EmployeeNoteWithAuthor[]
  canViewAudit: boolean
}

export function EmployeeAuditTrail({
  employeeName,
  auditLogs,
  notes,
  canViewAudit
}: EmployeeAuditTrailProps) {
  const timelineEntries = useMemo(() => {
    const auditEntries =
      auditLogs?.map((log) => ({
        type: 'audit' as const,
        createdAt: log.created_at,
        id: log.id,
        log
      })) ?? []

    const noteEntries =
      notes?.map((note) => ({
        type: 'note' as const,
        createdAt: note.created_at,
        id: note.note_id,
        note
      })) ?? []

    return [...auditEntries, ...noteEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [auditLogs, notes])

  if (!canViewAudit) {
    return (
      <div className="text-center py-8 text-gray-500">
        You do not have permission to view audit history.
      </div>
    )
  }

  if (timelineEntries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No audit history available{employeeName ? ` for ${employeeName}` : ''}.
      </div>
    )
  }

  const getActionLabel = (log: AuditLogEntry) => {
    const additionalInfo = log.additional_info ?? {}

    if (additionalInfo.action && typeof additionalInfo.action === 'string') {
      const specificActions: Record<string, string> = {
        add_emergency_contact: 'added emergency contact',
        update_financial_details: 'updated financial details',
        update_health_records: 'updated health records',
        update_right_to_work: 'updated right to work',
        update_onboarding_checklist: 'updated onboarding checklist'
      }
      return specificActions[additionalInfo.action] || additionalInfo.action
    }

    const actionLabels: Record<string, string> = {
      create: 'created',
      update: 'updated',
      delete: 'deleted',
      upload: 'uploaded file',
      download: 'downloaded file',
      view: 'viewed',
      add_note: 'added note',
      delete_note: 'deleted note',
      add_attachment: 'added attachment',
      delete_attachment: 'deleted attachment'
    }
    return actionLabels[log.operation_type] || log.operation_type
  }

  const getActionColor = (operationType: string) => {
    if (operationType === 'create') return 'bg-green-100 text-green-800'
    if (operationType === 'delete' || operationType.includes('delete')) return 'bg-red-100 text-red-800'
    if (operationType === 'update' || operationType.includes('update')) return 'bg-blue-100 text-blue-800'
    return 'bg-gray-100 text-gray-800'
  }

  const formatDetails = (log: AuditLogEntry) => {
    const details: string[] = []
    const additionalInfo = log.additional_info ?? {}

    if (Array.isArray(additionalInfo.fields_changed) && additionalInfo.fields_changed.length > 0) {
      const readableFields = additionalInfo.fields_changed.map((field: string) =>
        field
          .split('_')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      )
      details.push(`Updated: ${readableFields.join(', ')}`)
    }

    if (typeof additionalInfo.note_preview === 'string') {
      const preview = additionalInfo.note_preview
      details.push(`"${preview.substring(0, 80)}${preview.length > 80 ? '…' : ''}"`)
    }

    if (additionalInfo.file_name) {
      details.push(`File: ${additionalInfo.file_name}`)
    }

    if (additionalInfo.contact_name) {
      details.push(`Contact: ${additionalInfo.contact_name}`)
    }

    if (additionalInfo.document_type) {
      details.push(`Document: ${additionalInfo.document_type}`)
    }

    if (additionalInfo.field && additionalInfo.checked !== undefined) {
      const fieldLabel = String(additionalInfo.field)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
      details.push(`${fieldLabel}: ${additionalInfo.checked ? '✓ Checked' : '☐ Unchecked'}`)
    }

    if (Array.isArray(additionalInfo.fields_updated) && additionalInfo.fields_updated.length > 0) {
      const count = additionalInfo.fields_updated.length
      details.push(`${count} field${count > 1 ? 's' : ''} updated`)
    }

    if (log.old_values && log.new_values) {
      if (log.old_values.status && log.new_values.status && log.old_values.status !== log.new_values.status) {
        details.push(`Status: ${log.old_values.status} → ${log.new_values.status}`)
      }
      if (log.old_values.job_title && log.new_values.job_title && log.old_values.job_title !== log.new_values.job_title) {
        details.push(`Job Title: ${log.old_values.job_title} → ${log.new_values.job_title}`)
      }
      if (log.old_values.email_address && log.new_values.email_address && log.old_values.email_address !== log.new_values.email_address) {
        details.push(`Email: ${log.old_values.email_address} → ${log.new_values.email_address}`)
      }
    }

    return details.length > 0 ? details.join(' • ') : null
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <ClockIcon className="h-5 w-5 mr-2" />
            Audit Trail
          </h3>

          <div className="mt-4 flow-root">
            <ul className="-mb-8">
              {timelineEntries.map((entry, idx) => {
                const isAudit = entry.type === 'audit'
                const log = isAudit ? entry.log : null
                const note = !isAudit ? entry.note : null

                return (
                  <li key={entry.id}>
                    <div className="relative pb-8">
                      {idx !== timelineEntries.length - 1 ? (
                        <span className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                      ) : null}
                      <div className="relative flex space-x-3">
                        <div>
                          <span
                            className={`flex h-10 w-10 items-center justify-center rounded-full ${
                              isAudit ? getActionColor(log!.operation_type) : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isAudit ? (
                              <UserIcon className="h-5 w-5" />
                            ) : (
                              <ChatBubbleLeftRightIcon className="h-5 w-5" />
                            )}
                          </span>
                        </div>
                        <div className="flex-1 space-y-1">
                          {isAudit ? (
                            <>
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-gray-900">
                                  {log!.user_email ?? 'System'} {getActionLabel(log!)}
                                </p>
                                <p className="text-xs text-gray-500">{formatDateTime(log!.created_at)}</p>
                              </div>
                              {formatDetails(log!) && (
                                <p className="text-sm text-gray-500">{formatDetails(log!)}</p>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-gray-900">
                                  {note!.author_name} added a note
                                </p>
                                <p className="text-xs text-gray-500">{formatDateTime(note!.created_at)}</p>
                              </div>
                              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                                {note!.note_text}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
