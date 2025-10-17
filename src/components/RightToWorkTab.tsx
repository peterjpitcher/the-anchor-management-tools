'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { upsertRightToWork, getRightToWorkPhotoUrl, deleteRightToWorkPhoto } from '@/app/actions/employeeActions'
import type { EmployeeRightToWork } from '@/types/database'
import { AlertCircle, CheckCircle, Clock, Upload, Eye, Download, Trash2 } from 'lucide-react'

interface RightToWorkTabProps {
  employeeId: string
  rightToWork: EmployeeRightToWork | null
  canEdit: boolean
  canViewDocuments: boolean
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save Right to Work'}
    </button>
  )
}

export default function RightToWorkTab({
  employeeId,
  rightToWork,
  canEdit,
  canViewDocuments
}: RightToWorkTabProps) {
  const router = useRouter()
  const [state, formAction] = useActionState(upsertRightToWork, null)
  const [rightToWorkData, setRightToWorkData] = useState<EmployeeRightToWork | null>(rightToWork)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loadingPhoto, setLoadingPhoto] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [deletingPhoto, setDeletingPhoto] = useState(false)

  useEffect(() => {
    setRightToWorkData(rightToWork)
  }, [rightToWork])

  useEffect(() => {
    const fetchPhotoUrl = async () => {
      if (!canViewDocuments || !rightToWorkData?.photo_storage_path) {
        setPhotoUrl(null)
        return
      }

      setLoadingPhoto(true)
      const result = await getRightToWorkPhotoUrl(rightToWorkData.photo_storage_path)
      if (result.url) {
        setPhotoUrl(result.url)
      } else {
        setPhotoUrl(null)
        if (result.error) {
          console.error('Failed to fetch right-to-work photo URL:', result.error)
        }
      }
      setLoadingPhoto(false)
    }

    fetchPhotoUrl()
  }, [rightToWorkData?.photo_storage_path, canViewDocuments])

  useEffect(() => {
    if (state?.type === 'success') {
      setSelectedFileName(null)
      router.refresh()
    }
  }, [state, router])

  const isExpiringSoon = useMemo(() => {
    if (!rightToWorkData?.document_expiry_date) return false
    const expiryDate = new Date(rightToWorkData.document_expiry_date)
    const threshold = new Date()
    threshold.setDate(threshold.getDate() + 30)
    return expiryDate <= threshold
  }, [rightToWorkData?.document_expiry_date])

  const isFollowUpDue = useMemo(() => {
    if (!rightToWorkData?.follow_up_date) return false
    const followUpDate = new Date(rightToWorkData.follow_up_date)
    const today = new Date()
    return followUpDate <= today
  }, [rightToWorkData?.follow_up_date])

  const handleDeletePhoto = async () => {
    if (!canEdit || !rightToWorkData?.photo_storage_path) {
      return
    }

    if (!confirm('Are you sure you want to delete this photo?')) {
      return
    }

    setDeletingPhoto(true)
    const result = await deleteRightToWorkPhoto(employeeId)
    setDeletingPhoto(false)

    if (result.success) {
      router.refresh()
    } else if (result.error) {
      alert(result.error)
    }
  }

  return (
    <div className="space-y-6">
      {rightToWorkData && (
        <div className="space-y-3">
          {isExpiringSoon && (
            <div className="rounded-md bg-yellow-50 p-4">
              <div className="flex">
                <Clock className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">Document Expiring Soon</h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    This document expires on{' '}
                    {new Date(rightToWorkData.document_expiry_date!).toLocaleDateString()}.
                    Please obtain updated documentation before expiry.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isFollowUpDue && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Follow-up Required</h3>
                  <p className="mt-1 text-sm text-red-700">
                    A follow-up check was due on{' '}
                    {new Date(rightToWorkData.follow_up_date!).toLocaleDateString()}.
                  </p>
                </div>
              </div>
            </div>
          )}

          {rightToWorkData.document_type && !isExpiringSoon && !isFollowUpDue && (
            <div className="rounded-md bg-green-50 p-4">
              <div className="flex">
                <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Right to Work Verified</h3>
                  <p className="mt-1 text-sm text-green-700">
                    This employee&apos;s right to work has been verified and is currently valid.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!canEdit && (
        <p className="text-sm text-gray-500">
          You do not have permission to update right to work information.
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="employee_id" value={employeeId} />

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_type" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Type <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <select
              id="document_type"
              name="document_type"
              defaultValue={rightToWorkData?.document_type ?? ''}
              disabled={!canEdit}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
              required
            >
              <option value="" disabled>
                Select document type
              </option>
              <option value="Passport">Passport</option>
              <option value="Biometric Residence Permit">Biometric Residence Permit</option>
              <option value="Share Code">Share Code</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_reference" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Reference
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="text"
              id="document_reference"
              name="document_reference"
              defaultValue={rightToWorkData?.document_reference ?? ''}
              disabled={!canEdit}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_expiry_date" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Expiry Date
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="date"
              id="document_expiry_date"
              name="document_expiry_date"
              defaultValue={rightToWorkData?.document_expiry_date ?? ''}
              disabled={!canEdit}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="follow_up_date" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Follow-up Date
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="date"
              id="follow_up_date"
              name="follow_up_date"
              defaultValue={rightToWorkData?.follow_up_date ?? ''}
              disabled={!canEdit}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_details" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Additional Details
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <textarea
              id="document_details"
              name="document_details"
              rows={3}
              defaultValue={rightToWorkData?.document_details ?? ''}
              disabled={!canEdit}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_photo" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Photo
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0 space-y-3">
            <label className="flex items-center justify-between rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
              <div className="flex items-center space-x-3">
                <Upload className="h-5 w-5 text-gray-400" />
                <span>{selectedFileName ?? 'Upload scan or photo (PDF/JPG/PNG)'}</span>
              </div>
              <input
                type="file"
                id="document_photo"
                name="document_photo"
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={!canEdit}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  setSelectedFileName(file?.name ?? null)
                }}
              />
            </label>

            {canViewDocuments && rightToWorkData?.photo_storage_path && (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  <Eye className="h-4 w-4" />
                  {loadingPhoto ? (
                    <span>Generating preview…</span>
                  ) : photoUrl ? (
                    <>
                      <a
                        href={photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700"
                      >
                        View current document
                      </a>
                      <a
                        href={photoUrl}
                        download
                        className="inline-flex items-center text-blue-600 hover:text-blue-700"
                      >
                        <Download className="mr-1 h-4 w-4" /> Download
                      </a>
                    </>
                  ) : (
                    <span>Unable to generate preview</span>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    onClick={handleDeletePhoto}
                    disabled={deletingPhoto}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    {deletingPhoto ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {state?.type === 'error' && state.errors && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {Object.values(state.errors).flat().join(', ')}
          </div>
        )}
        {state?.type === 'error' && state.message && !state.errors && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {state.message}
          </div>
        )}

        <div className="flex justify-end">
          <SubmitButton disabled={!canEdit} />
        </div>
      </form>
    </div>
  )
}
