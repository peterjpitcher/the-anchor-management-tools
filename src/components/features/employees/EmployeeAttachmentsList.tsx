'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { EmployeeAttachment } from '@/types/database'
import { deleteEmployeeAttachment, getAttachmentSignedUrl } from '@/app/actions/employeeActions'
import { formatBytes } from '@/lib/utils'
import { formatDateInLondon } from '@/lib/dateUtils'
import { Alert, Button, Empty, FormFooter, Icon, IconButton, Modal, toast } from '@/ds'

interface EmployeeAttachmentsListProps {
  employeeId: string
  attachments: EmployeeAttachment[]
  categoryLookup: Record<string, string>
  canDelete: boolean
}

function DeleteAttachmentButton({
  employeeId,
  attachmentId,
  storagePath,
  attachmentName,
  onDeleted
}: {
  employeeId: string
  attachmentId: string
  storagePath: string
  attachmentName: string
  onDeleted: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, dispatch] = useActionState(deleteEmployeeAttachment, null)

  useEffect(() => {
    if (state?.type === 'success') {
      setIsOpen(false)
      onDeleted()
    } else if (state?.type === 'error') {
      // error is shown inline; no alert needed
    }
  }, [state, onDeleted])

  function SubmitActualDeleteButton() {
    const { pending } = useFormStatus()
    return (
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
    )
  }

  if (!storagePath) {
    return null
  }

  return (
    <>
      <IconButton
        onClick={() => setIsOpen(true)}
        type="button"
        size="md"
        className="text-danger hover:bg-danger-soft hover:text-danger-fg"
        title="Delete Attachment"
        label={`Delete ${attachmentName}`}
        icon={<Icon name="trash" size={20} />}
      />

      {/* A DS Modal rather than ConfirmDialog: the delete is a server-action form, and the
          buttons stay inside it so the submit button can read the form's pending state. */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Delete Attachment" width="md">
        <form action={dispatch} className="space-y-4">
          <input type="hidden" name="employee_id" value={employeeId} />
          <input type="hidden" name="attachment_id" value={attachmentId} />
          <p className="text-sm text-text-muted">
            Are you sure you want to delete &quot;{attachmentName}&quot;? This action cannot be undone.
          </p>
          {state?.type === 'error' && (
            <Alert tone="danger" size="sm">{state.message}</Alert>
          )}
          <FormFooter>
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <SubmitActualDeleteButton />
          </FormFooter>
        </form>
      </Modal>
    </>
  )
}

export default function EmployeeAttachmentsList({
  employeeId,
  attachments,
  categoryLookup,
  canDelete
}: EmployeeAttachmentsListProps) {
  const router = useRouter()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  const handleDownload = async (attachment: EmployeeAttachment) => {
    try {
      setDownloading(attachment.attachment_id)

      const result = await getAttachmentSignedUrl(attachment.attachment_id)

      if (result.error) {
        toast.error(result.error)
        return
      }

      if (result.url) {
        const link = document.createElement('a')
        link.href = result.url
        link.setAttribute('download', attachment.file_name || 'download')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } else {
        toast.error('Could not generate download link. Please try again.')
      }
    } catch (error) {
      console.error('Download error:', error)
      toast.error('An error occurred while downloading the file. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  const handleView = async (attachment: EmployeeAttachment) => {
    try {
      setViewing(attachment.attachment_id)

      const result = await getAttachmentSignedUrl(attachment.attachment_id)

      if (result.error) {
        toast.error(result.error)
        return
      }

      if (result.url) {
        window.open(result.url, '_blank')
      } else {
        toast.error('Could not generate view link. Please try again.')
      }
    } catch (error) {
      console.error('View error:', error)
      toast.error('An error occurred while viewing the file. Please try again.')
    } finally {
      setViewing(null)
    }
  }

  const isViewable = (mimeType: string) => {
    const viewableTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/html'
    ]
    return viewableTypes.includes(mimeType.toLowerCase())
  }

  if (!attachments || attachments.length === 0) {
    return <Empty size="sm" icon="document" title="No documents uploaded yet" />
  }

  return (
    <ul role="list" className="divide-y divide-border">
      {attachments.map((attachment) => {
        const categoryName = attachment.category_id ? categoryLookup[attachment.category_id] : 'Uncategorized'
        return (
          <li key={attachment.attachment_id} className="py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center space-x-3">
                <Icon name="paperclip" size={20} className="flex-shrink-0 text-text-subtle" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{attachment.file_name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {categoryName} • {formatBytes(attachment.file_size_bytes || 0)} •{' '}
                    {formatDateInLondon(attachment.uploaded_at)}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center space-x-2">
                {isViewable(attachment.mime_type) && (
                  <IconButton
                    type="button"
                    size="md"
                    onClick={() => handleView(attachment)}
                    className="text-text-muted hover:text-text"
                    disabled={viewing === attachment.attachment_id}
                    label={`View ${attachment.file_name}`}
                    icon={<Icon name="eye" size={20} />}
                  />
                )}
                <IconButton
                  type="button"
                  size="md"
                  onClick={() => handleDownload(attachment)}
                  className="text-text-muted hover:text-text"
                  disabled={downloading === attachment.attachment_id}
                  label={`Download ${attachment.file_name}`}
                  icon={<Icon name="download" size={20} />}
                />
                {canDelete && attachment.storage_path && (
                  <DeleteAttachmentButton
                    employeeId={employeeId}
                    attachmentId={attachment.attachment_id}
                    storagePath={attachment.storage_path}
                    attachmentName={attachment.file_name ?? 'Attachment'}
                    onDeleted={() => {
                      router.refresh()
                    }}
                  />
                )}
              </div>
            </div>
            {attachment.description && (
              <p className="mt-2 text-sm text-text-muted">{attachment.description}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
