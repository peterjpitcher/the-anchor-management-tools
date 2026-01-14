'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { format } from 'date-fns'

import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'

import { updatePerformerSubmission } from '@/app/actions/performer-submissions'
import type { PerformerSubmission, PerformerSubmissionStatus } from '@/types/database'

const STATUS_OPTIONS: Array<{ value: PerformerSubmissionStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
  { value: 'not_a_fit', label: 'Not a fit' },
  { value: 'do_not_contact', label: 'Do not contact' },
]

function getStatusBadgeVariant(status: PerformerSubmissionStatus): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'new':
      return 'default'
    case 'shortlisted':
      return 'warning'
    case 'contacted':
      return 'warning'
    case 'booked':
      return 'success'
    case 'not_a_fit':
      return 'error'
    case 'do_not_contact':
      return 'error'
    default:
      return 'default'
  }
}

function formatAvailabilityLabel(value: string): string {
  switch (value) {
    case 'weeknights':
      return 'Weeknights'
    case 'weekends':
      return 'Weekends'
    case 'either':
      return 'Either'
    default:
      return value
  }
}

function formatYesNoDepends(value: string): string {
  switch (value) {
    case 'yes':
      return 'Yes'
    case 'no':
      return 'No'
    case 'depends':
      return 'Depends'
    default:
      return value
  }
}

function flattenLinks(links: Record<string, unknown>): Array<{ label: string; url: string }> {
  const output: Array<{ label: string; url: string }> = []

  for (const [key, value] of Object.entries(links || {})) {
    const values = Array.isArray(value) ? value : [value]
    for (const entry of values) {
      const url = typeof entry === 'string' ? entry.trim() : ''
      if (!url) continue
      output.push({ label: key, url })
    }
  }

  return output.sort((a, b) => a.label.localeCompare(b.label))
}

export default function PerformerSubmissionClient({ submission }: { submission: PerformerSubmission }) {
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('performers', 'edit') || hasPermission('performers', 'manage')

  const [status, setStatus] = useState<PerformerSubmissionStatus>(submission.status)
  const [internalNotes, setInternalNotes] = useState<string>(submission.internal_notes || '')
  const [savedStatus, setSavedStatus] = useState<PerformerSubmissionStatus>(submission.status)
  const [savedInternalNotes, setSavedInternalNotes] = useState<string>(submission.internal_notes || '')
  const [isPending, startTransition] = useTransition()

  const links = useMemo(() => flattenLinks((submission.links as unknown as Record<string, unknown>) || {}), [submission.links])

  const hasChanges = status !== savedStatus || internalNotes !== savedInternalNotes

  const handleSave = useCallback(() => {
    if (!canEdit) {
      toast.error('You do not have permission to edit performer submissions.')
      return
    }

    startTransition(async () => {
      const result = await updatePerformerSubmission(submission.id, {
        status,
        internal_notes: internalNotes.trim() ? internalNotes.trim() : null,
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      const nextNotes = internalNotes.trim() ? internalNotes.trim() : ''
      setInternalNotes(nextNotes)
      setSavedStatus(status)
      setSavedInternalNotes(nextNotes)
      toast.success('Saved changes')
    })
  }, [canEdit, internalNotes, status, submission.id])

  return (
    <PageLayout
      title={submission.act_name || submission.full_name}
      subtitle="Performer interest submission"
      backButton={{ label: 'Back to performers', href: '/performers' }}
      headerActions={
        canEdit ? (
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges || isPending}
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        ) : null
      }
    >
      {!canEdit && (
        <Alert
          variant="info"
          title="Read-only access"
          description="You can view this submission, but editing requires the performers edit permission."
          className="mb-4"
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-500">Received</div>
                <div className="text-base font-semibold text-gray-900">
                  {format(new Date(submission.created_at), 'MMM d, yyyy HH:mm')}
                </div>
              </div>
              <Badge variant={getStatusBadgeVariant(status)}>
                {STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Full name</div>
                <div className="text-sm text-gray-900">{submission.full_name}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Act name</div>
                <div className="text-sm text-gray-900">{submission.act_name || '—'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</div>
                <div className="text-sm text-gray-900">
                  <a className="text-blue-600 hover:text-blue-700" href={`mailto:${submission.email}`}>
                    {submission.email}
                  </a>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</div>
                <div className="text-sm text-gray-900">
                  <a className="text-blue-600 hover:text-blue-700" href={`tel:${submission.phone}`}>
                    {submission.phone}
                  </a>
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Base location</div>
                <div className="text-sm text-gray-900">{submission.base_location}</div>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Performer details</h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Performer type(s)</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(submission.performer_types || []).map((type) => (
                    <Badge key={type} variant="default">
                      {type}
                    </Badge>
                  ))}
                  {submission.performer_type_other && (
                    <Badge variant="default">Other: {submission.performer_type_other}</Badge>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bio</div>
                <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{submission.bio}</p>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Availability</div>
                <div className="mt-1 text-sm text-gray-700">
                  <div>Generally: {formatAvailabilityLabel(submission.availability_general)}</div>
                  <div>Can start around 8pm: {formatYesNoDepends(submission.can_start_around_8pm)}</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Links</div>
                {links.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-600">No links provided.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {links.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <span className="text-gray-600">{item.label}:</span>{' '}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 break-all"
                        >
                          {item.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Admin</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="status">
                  Status
                </label>
                <Select
                  id="status"
                  value={status}
                  disabled={!canEdit}
                  onChange={(e) => setStatus(e.target.value as PerformerSubmissionStatus)}
                  options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="internal_notes">
                  Internal notes
                </label>
                <Textarea
                  id="internal_notes"
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={10}
                  disabled={!canEdit}
                  placeholder="Notes for the team (not visible to the performer)…"
                />
              </div>

              {submission.submitted_ip && (
                <div className="text-xs text-gray-500">
                  Submitted IP: {submission.submitted_ip}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Consents</h2>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>Data storage: {submission.consent_data_storage ? 'Yes' : 'No'}</li>
              <li>Marketing updates: {submission.consent_marketing ? 'Yes' : 'No'}</li>
              <li>Media consent: {submission.consent_media ? 'Yes' : 'No'}</li>
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Actions</h2>
            <div className="space-y-2">
              <LinkButton
                href="https://www.the-anchor.pub/open-mic"
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="sm"
              >
                View /open-mic page
              </LinkButton>
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}
