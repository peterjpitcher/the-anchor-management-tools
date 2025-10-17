'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { EmployeeAttachment } from '@/types/database'
import { deleteEmployeeAttachment, getAttachmentSignedUrl } from '@/app/actions/employeeActions'
import { PaperClipIcon, ArrowDownTrayIcon, TrashIcon, ExclamationTriangleIcon, EyeIcon } from '@heroicons/react/24/outline'
import { formatBytes } from '@/lib/utils'

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
      setIsOpen(false)
      alert(`Error: ${state.message}`)
    }
  }, [state, onDeleted])

  function SubmitActualDeleteButton() {
    const { pending } = useFormStatus()
    return (
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
    )
  }

  if (!storagePath) {
    return null
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className="p-2 sm:p-1 font-medium text-red-600 hover:text-red-500 disabled:opacity-50 touch-target"
        title="Delete Attachment"
      >
        <TrashIcon className="h-5 w-5" />
        <span className="sr-only">Delete {attachmentName}</span>
      </button>

      {isOpen && (
        <div className="relative z-50" aria-labelledby="delete-attachment" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <form
                action={dispatch}
                className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all sm:my-8 w-full max-w-lg sm:p-6"
              >
                <input type="hidden" name="employee_id" value={employeeId} />
                <input type="hidden" name="attachment_id" value={attachmentId} />
                <input type="hidden" name="storage_path" value={storagePath} />
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg font-medium leading-6 text-gray-900" id="delete-attachment">
                      Delete Attachment
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete &quot;{attachmentName}&quot;? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                {state?.type === 'error' && (
                  <p className="mt-3 text-sm text-red-600 text-center sm:text-left sm:ml-14">{state.message}</p>
                )}
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <SubmitActualDeleteButton />
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
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

      const result = await getAttachmentSignedUrl(attachment.storage_path)

      if (result.error) {
        alert(`Error: ${result.error}`)
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
        alert('Could not generate download link. Please try again.')
      }
    } catch (error) {
      console.error('Download error:', error)
      alert('An error occurred while downloading the file. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  const handleView = async (attachment: EmployeeAttachment) => {
    try {
      setViewing(attachment.attachment_id)

      const result = await getAttachmentSignedUrl(attachment.storage_path)

      if (result.error) {
        alert(`Error: ${result.error}`)
        return
      }

      if (result.url) {
        window.open(result.url, '_blank')
      } else {
        alert('Could not generate view link. Please try again.')
      }
    } catch (error) {
      console.error('View error:', error)
      alert('An error occurred while viewing the file. Please try again.')
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
    return <p className="text-sm text-gray-500">No documents uploaded yet.</p>
  }

  return (
    <ul role="list" className="divide-y divide-gray-200">
      {attachments.map((attachment) => {
        const categoryName = attachment.category_id ? categoryLookup[attachment.category_id] : 'Uncategorized'
        return (
          <li key={attachment.attachment_id} className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <PaperClipIcon className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{attachment.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {categoryName} • {formatBytes(attachment.file_size_bytes || 0)} •{' '}
                    {new Date(attachment.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {isViewable(attachment.mime_type) && (
                  <button
                    type="button"
                    onClick={() => handleView(attachment)}
                    className="p-2 sm:p-1 text-gray-500 hover:text-gray-700"
                    disabled={viewing === attachment.attachment_id}
                  >
                    <EyeIcon className="h-5 w-5" />
                    <span className="sr-only">View {attachment.file_name}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDownload(attachment)}
                  className="p-2 sm:p-1 text-gray-500 hover:text-gray-700"
                  disabled={downloading === attachment.attachment_id}
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                  <span className="sr-only">Download {attachment.file_name}</span>
                </button>
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
              <p className="mt-2 text-sm text-gray-500">{attachment.description}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
