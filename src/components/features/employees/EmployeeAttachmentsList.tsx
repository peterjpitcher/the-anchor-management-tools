'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmployeeAttachment } from '@/types/database'
import { deleteEmployeeAttachment, getAttachmentSignedUrl } from '@/app/actions/employeeActions'
import { formatBytes } from '@/lib/utils'
import { formatDateInLondon } from '@/lib/dateUtils'
import { Alert, Button, Empty, Icon, IconButton, Modal, toast } from '@/ds'
import { downloadSignedDocument, viewSignedDocument } from './open-signed-document'

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
  const [state, dispatch, pending] = useActionState(deleteEmployeeAttachment, null)
  const formId = `delete-attachment-${attachmentId}`
  // Handle each success result once, so a re-render cannot run the refresh again.
  const handledState = useRef<typeof state>(null)

  useEffect(() => {
    if (state?.type === 'success' && handledState.current !== state) {
      handledState.current = state
      setIsOpen(false)
      onDeleted()
    }
    // An error is shown inline in the dialog.
  }, [state, onDeleted])

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
        title="Delete attachment"
        label={`Delete ${attachmentName}`}
        icon={<Icon name="trash" size={20} />}
      />

      {/* A DS Modal rather than ConfirmDialog: the delete is a server-action form. Its footer
          mirrors ConfirmDialog, and the submit button reaches the form through form=. */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Delete Attachment"
        width="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="danger" loading={pending}>
              Delete
            </Button>
          </>
        }
      >
        <form id={formId} action={dispatch} className="space-y-4">
          <input type="hidden" name="employee_id" value={employeeId} />
          <input type="hidden" name="attachment_id" value={attachmentId} />
          <p className="text-sm text-text-muted">
            Are you sure you want to delete &quot;{attachmentName}&quot;? This action cannot be undone.
          </p>
          {state?.type === 'error' && (
            <Alert tone="danger" size="sm">{state.message}</Alert>
          )}
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

  const refresh = useCallback(() => router.refresh(), [router])

  const handleDownload = async (attachment: EmployeeAttachment) => {
    setDownloading(attachment.attachment_id)
    try {
      const error = await downloadSignedDocument(() =>
        getAttachmentSignedUrl(attachment.attachment_id, { download: true })
      )
      if (error) toast.error(error)
    } finally {
      setDownloading(null)
    }
  }

  const handleView = async (attachment: EmployeeAttachment) => {
    setViewing(attachment.attachment_id)
    try {
      const error = await viewSignedDocument(() => getAttachmentSignedUrl(attachment.attachment_id))
      if (error) toast.error(error)
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
    return <Empty size="sm" icon="document" title="No documents yet" />
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
                    onDeleted={refresh}
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
