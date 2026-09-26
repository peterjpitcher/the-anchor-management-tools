'use client'

import { useMemo, useState } from 'react'
import { formatDateInLondon, formatDateTime } from '@/lib/dateUtils'
import { Button, Card, CardBody, CardHeader, Empty, Icon, toast } from '@/ds'
import { auditEntryIconClasses } from '@/app/(authenticated)/employees/_shared/status-ui'
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
  const [copied, setCopied] = useState(false)

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
      <Card>
        <CardHeader title="Audit Trail" />
        <CardBody>
          <p className="text-center text-sm text-text-muted">
            You do not have permission to view audit history.
          </p>
        </CardBody>
      </Card>
    )
  }

  if (timelineEntries.length === 0) {
    return (
      <Card>
        <CardHeader title="Audit Trail" />
        <Empty
          size="sm"
          title="No audit history"
          description={`No audit history available${employeeName ? ` for ${employeeName}` : ''}.`}
        />
      </Card>
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
        update_onboarding_checklist: 'updated onboarding checklist',
        mark_shift_sick: "marked a shift as Couldn't Work",
        shift_accepted: 'accepted a shift',
        shift_auto_accepted: 'had a shift auto-accepted',
        shift_rejected: 'rejected a shift',
        late_shift_rejection_attempt: 'tried to reject a shift inside cutoff',
        couldnt_work: "recorded Couldn't Work",
        holiday_requested: 'requested holiday',
        holiday_approved: 'had holiday approved',
        late_holiday: 'booked late holiday',
        holiday_conflict: 'had holiday conflict with the rota',
        holiday_declined: 'had holiday declined',
        holiday_deleted: 'had holiday deleted',
        holiday_updated: 'updated holiday'
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

    if (additionalInfo.action === 'mark_shift_sick') {
      const shiftDate = typeof additionalInfo.shift_date === 'string' ? additionalInfo.shift_date : null
      const startTime = typeof additionalInfo.start_time === 'string' ? additionalInfo.start_time : null
      const endTime = typeof additionalInfo.end_time === 'string' ? additionalInfo.end_time : null
      const sickReason = typeof additionalInfo.sick_reason === 'string' ? additionalInfo.sick_reason : null

      if (shiftDate) {
        const dateLabel = formatDateInLondon(shiftDate, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
        details.push(`Shift: ${dateLabel}${startTime && endTime ? ` ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}` : ''}`)
      }

      if (sickReason) {
        details.push(`Reason: ${sickReason}`)
      }
    }

    const reliabilityActions = new Set([
      'shift_accepted',
      'shift_auto_accepted',
      'shift_rejected',
      'late_shift_rejection_attempt',
      'couldnt_work',
      'holiday_requested',
      'holiday_approved',
      'late_holiday',
      'holiday_conflict',
      'holiday_declined',
      'holiday_deleted',
      'holiday_updated',
    ])
    const action = typeof additionalInfo.action === 'string' ? additionalInfo.action : null
    if (action && reliabilityActions.has(action)) {
      const shiftDate = typeof additionalInfo.shift_date === 'string' ? additionalInfo.shift_date : null
      const startTime = typeof additionalInfo.start_time === 'string' ? additionalInfo.start_time : null
      const endTime = typeof additionalInfo.end_time === 'string' ? additionalInfo.end_time : null
      const startDate = typeof additionalInfo.start_date === 'string' ? additionalInfo.start_date : null
      const endDate = typeof additionalInfo.end_date === 'string' ? additionalInfo.end_date : null
      const note = typeof additionalInfo.note === 'string' && additionalInfo.note.trim() ? additionalInfo.note.trim() : null
      const noticeDays = typeof additionalInfo.notice_days === 'number' ? additionalInfo.notice_days : null
      const impactedShiftCount = typeof additionalInfo.impacted_shift_count === 'number' ? additionalInfo.impacted_shift_count : null

      if (shiftDate) {
        const dateLabel = formatDateInLondon(shiftDate, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
        details.push(`Shift: ${dateLabel}${startTime && endTime ? ` ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}` : ''}`)
      }

      if (startDate && endDate) {
        const startLabel = formatDateInLondon(startDate, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
        const endLabel = formatDateInLondon(endDate, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
        details.push(`Holiday: ${startLabel} to ${endLabel}`)
      }

      if (noticeDays !== null) {
        details.push(`Notice: ${noticeDays} day${noticeDays === 1 ? '' : 's'}`)
      }

      if (impactedShiftCount && impactedShiftCount > 0) {
        details.push(`Impacted shifts: ${impactedShiftCount}`)
      }

      if (note) {
        details.push(`Note: ${note.substring(0, 80)}${note.length > 80 ? '...' : ''}`)
      }
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

  const copyText = timelineEntries.map((entry) => {
    if (entry.type === 'note') {
      return [
        `${entry.note.author_name} added a note`,
        formatDateTime(entry.note.created_at),
        entry.note.note_text
      ].filter(Boolean).join('\n')
    }

    const details = formatDetails(entry.log)
    return [
      `${entry.log.user_email ?? 'System'} ${getActionLabel(entry.log)}`,
      formatDateTime(entry.log.created_at),
      details
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      toast.success('Audit trail copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Audit Trail"
        action={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Icon name="copy" size={16} />}
            onClick={handleCopyAll}
          >
            {copied ? 'Copied' : 'Copy All'}
          </Button>
        }
      />
      <CardBody>
        <div className="flow-root">
          <ul className="-mb-8">
            {timelineEntries.map((entry, idx) => {
              const isAudit = entry.type === 'audit'
              const log = isAudit ? entry.log : null
              const note = !isAudit ? entry.note : null

              return (
                <li key={entry.id}>
                  <div className="relative pb-8">
                    {idx !== timelineEntries.length - 1 ? (
                      <span className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-border" aria-hidden="true" />
                    ) : null}
                    <div className="relative flex space-x-3">
                      <div>
                        <span
                          className={`flex h-10 w-10 items-center justify-center rounded-full ${auditEntryIconClasses(
                            isAudit ? { kind: 'audit', operationType: log!.operation_type } : { kind: 'note' },
                          )}`}
                        >
                          {isAudit ? (
                            <Icon name="user" size={20} />
                          ) : (
                            <Icon name="message" size={20} />
                          )}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {isAudit ? (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 break-words text-sm font-medium text-text">
                                {log!.user_email ?? 'System'} {getActionLabel(log!)}
                              </p>
                              <p className="flex-shrink-0 whitespace-nowrap text-xs text-text-muted">{formatDateTime(log!.created_at)}</p>
                            </div>
                            {formatDetails(log!) && (
                              <p className="text-sm text-text-muted break-words">{formatDetails(log!)}</p>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 break-words text-sm font-medium text-text">
                                {note!.author_name} added a note
                              </p>
                              <p className="flex-shrink-0 whitespace-nowrap text-xs text-text-muted">{formatDateTime(note!.created_at)}</p>
                            </div>
                            <p className="text-sm text-text-muted whitespace-pre-wrap break-words">
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
      </CardBody>
    </Card>
  )
}
