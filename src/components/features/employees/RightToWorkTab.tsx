'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRightToWorkDocumentUploadUrl,
  deleteRightToWorkPhoto,
  getRightToWorkPhotoUrl,
  upsertRightToWork,
} from '@/app/actions/employeeActions'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { ActionFormState } from '@/types/actions'
import type { EmployeeRightToWork } from '@/types/database'
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, FormFooter, Icon, Input, LinkButton, Select, Spinner, Textarea, toast } from '@/ds'
import { MAX_FILE_SIZE } from '@/lib/constants'
import { formatDateInLondon, getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'

const DOCUMENT_TYPE_OPTIONS = ['Passport', 'Biometric Residence Permit', 'Share Code', 'List A', 'List B', 'Other'] as const
const LEGACY_DOCUMENT_TYPES: readonly string[] = []
const RIGHT_TO_WORK_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

const isLegacyDocumentType = (value: string) => LEGACY_DOCUMENT_TYPES.includes(value)

interface RightToWorkTabProps {
  employeeId: string
  rightToWork: EmployeeRightToWork | null
  canEdit: boolean
  canViewDocuments: boolean
  /** Where Cancel goes on the edit page. Without it the form has no Cancel button. */
  cancelHref?: string
}

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <Button type="submit" variant="primary" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Save Right to Work'}
    </Button>
  )
}

export default function RightToWorkTab({
  employeeId,
  rightToWork,
  canEdit,
  canViewDocuments,
  cancelHref,
}: RightToWorkTabProps) {
  const router = useRouter()
  const supabase = useSupabase()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ActionFormState>(null)
  const [isSaving, startTransition] = useTransition()
  const [rightToWorkData, setRightToWorkData] = useState<EmployeeRightToWork | null>(rightToWork)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loadingPhoto, setLoadingPhoto] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [deletingPhoto, setDeletingPhoto] = useState(false)
  const [deletePhotoOpen, setDeletePhotoOpen] = useState(false)

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
      const result = await getRightToWorkPhotoUrl(employeeId)
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

  // Compared as London ISO dates: a raw Date built from a date-only column is
  // UTC midnight, which flips the answer either side of midnight in production.
  const expiryIsoDate = rightToWorkData?.document_expiry_date?.split('T')[0] ?? null
  const followUpIsoDate = rightToWorkData?.follow_up_date?.split('T')[0] ?? null

  const isExpired = useMemo(() => {
    if (!expiryIsoDate) return false
    return expiryIsoDate < getTodayIsoDate()
  }, [expiryIsoDate])

  // Expiring soon means still valid but inside the 30-day warning window. An
  // already-expired document is a different, harder problem and reads as expired.
  const isExpiringSoon = useMemo(() => {
    if (!expiryIsoDate || isExpired) return false
    return expiryIsoDate <= getLocalIsoDateDaysAhead(30)
  }, [expiryIsoDate, isExpired])

  const isFollowUpDue = useMemo(() => {
    if (!followUpIsoDate) return false
    return followUpIsoDate <= getTodayIsoDate()
  }, [followUpIsoDate])

  const documentTypeOptions = useMemo(() => {
    const options = [...DOCUMENT_TYPE_OPTIONS] as string[]
    const existingType = rightToWorkData?.document_type
    if (existingType && !options.includes(existingType)) {
      options.push(existingType)
    }
    return options
  }, [rightToWorkData?.document_type])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEdit) return

    const formData = new FormData(event.currentTarget)
    formData.set('employee_id', employeeId)
    formData.delete('document_photo')

    startTransition(async () => {
      try {
        const documentPhoto = selectedFile

        if (documentPhoto) {
          const signedUpload = await createRightToWorkDocumentUploadUrl(
            employeeId,
            documentPhoto.name,
            documentPhoto.type,
            documentPhoto.size
          )

          if (signedUpload.type === 'error') {
            setState({ type: 'error', message: signedUpload.message || 'Failed to prepare right to work document upload.' })
            return
          }

          const uploadResult = await supabase.storage
            .from('employee-attachments')
            .uploadToSignedUrl(signedUpload.path, signedUpload.token, documentPhoto, {
              upsert: false,
              contentType: documentPhoto.type
            })

          if (uploadResult.error) {
            console.error('Right to work document upload failed:', uploadResult.error)
            setState({ type: 'error', message: uploadResult.error.message || 'Failed to upload document photo.' })
            return
          }

          formData.append('photo_storage_path', signedUpload.path)
        }

        const result = await upsertRightToWork(null, formData)
        setState(result)

        if (result?.type === 'success') {
          setSelectedFile(null)
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
          router.refresh()
        }
      } catch (error) {
        console.error('Right to work save failed:', error)
        setState({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to save right to work information.',
        })
      }
    })
  }

  const handleDeletePhoto = async () => {
    if (!canEdit || !rightToWorkData?.photo_storage_path) {
      return
    }

    setDeletingPhoto(true)
    try {
      const result = await deleteRightToWorkPhoto(employeeId)

      if (result.success) {
        setDeletePhotoOpen(false)
        setPhotoUrl(null)
        setRightToWorkData(current => current ? { ...current, photo_storage_path: null } : current)
        toast.success('Right to work document deleted.')
        router.refresh()
        return
      }

      throw new Error(result.error || 'Failed to delete right to work document.')
    } finally {
      setDeletingPhoto(false)
    }
  }

  return (
    <div className="space-y-6">
      {rightToWorkData && (
        <div className="space-y-3">
          {isExpired && (
            <Alert tone="danger" title="Document Expired" icon={<Icon name="alertCircle" size={20} />}>
              This document expired on{' '}
              {formatDateInLondon(rightToWorkData.document_expiry_date!)}.
              Obtain and record updated documentation now.
            </Alert>
          )}

          {isExpiringSoon && (
            <Alert tone="warning" title="Document Expiring Soon" icon={<Icon name="clock" size={20} />}>
              This document expires on{' '}
              {formatDateInLondon(rightToWorkData.document_expiry_date!)}.
              Please obtain updated documentation before expiry.
            </Alert>
          )}

          {isFollowUpDue && (
            <Alert tone="danger" title="Follow-up Required" icon={<Icon name="alertCircle" size={20} />}>
              A follow-up check was due on{' '}
              {formatDateInLondon(rightToWorkData.follow_up_date!)}.
            </Alert>
          )}

          {rightToWorkData.document_type && !isExpired && !isExpiringSoon && !isFollowUpDue && (
            <Alert tone="success" role="status" title="Right to Work Verified" icon={<Icon name="checkCircle" size={20} />}>
              This employee&apos;s right to work has been verified and is currently valid.
            </Alert>
          )}
        </div>
      )}

      {!canEdit && (
        <p className="text-sm text-text-muted">
          You do not have permission to update right to work information.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <input type="hidden" name="employee_id" value={employeeId} />

        <Card>
          <CardHeader title="Right to Work Check" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Check Method" className="sm:col-span-2">
              <Select
                id="check_method"
                name="check_method"
                defaultValue={rightToWorkData?.check_method ?? ''}
                disabled={!canEdit}
              >
                <option value="">Select check method</option>
                <option value="manual">Manual check (original documents)</option>
                <option value="online">Online Home Office check (eVisa)</option>
                <option value="digital">Digital check (IDSP)</option>
              </Select>
            </Field>

            <Field label="Document Type" required>
              <Select
                id="document_type"
                name="document_type"
                defaultValue={rightToWorkData?.document_type ?? ''}
                disabled={!canEdit}
                required
              >
                <option value="" disabled>
                  Select document type
                </option>
                {documentTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {isLegacyDocumentType(option) ? `Legacy – ${option}` : option}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Verification Date" required>
              <Input
                type="date"
                id="verification_date"
                name="verification_date"
                defaultValue={rightToWorkData?.verification_date?.split('T')[0] ?? ''}
                disabled={!canEdit}
                required
              />
            </Field>

            <Field label="Document Reference">
              <Input
                type="text"
                id="document_reference"
                name="document_reference"
                defaultValue={rightToWorkData?.document_reference ?? ''}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Expiry Date">
              <Input
                type="date"
                id="document_expiry_date"
                name="document_expiry_date"
                defaultValue={rightToWorkData?.document_expiry_date?.split('T')[0] ?? ''}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Follow-up Date">
              <Input
                type="date"
                id="follow_up_date"
                name="follow_up_date"
                defaultValue={rightToWorkData?.follow_up_date?.split('T')[0] ?? ''}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Additional Details" className="sm:col-span-2">
              <Textarea
                id="document_details"
                name="document_details"
                rows={3}
                defaultValue={rightToWorkData?.document_details ?? ''}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Document Photo" hint="Upload scan or photo (PDF/JPG/PNG)" className="sm:col-span-2">
              {/* The DS Input as a single-file picker, as on the new employee page: it can be
                  disabled, takes its label from the Field, stays in the tab order and is cleared
                  through the ref after a save. */}
              <Input
                type="file"
                id="document_photo"
                ref={fileInputRef}
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={!canEdit || isSaving}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) {
                    setSelectedFile(null)
                    return
                  }

                  if (!RIGHT_TO_WORK_ALLOWED_MIME_TYPES.includes(file.type as (typeof RIGHT_TO_WORK_ALLOWED_MIME_TYPES)[number])) {
                    toast.error('Only PDF, JPG, and PNG files are allowed.')
                    event.target.value = ''
                    setSelectedFile(null)
                    return
                  }

                  if (file.size >= MAX_FILE_SIZE) {
                    toast.error('File size must be less than 10MB.')
                    event.target.value = ''
                    setSelectedFile(null)
                    return
                  }

                  setSelectedFile(file)
                }}
              />
            </Field>

            {canViewDocuments && rightToWorkData?.photo_storage_path && (
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <div className="flex items-center gap-2 rounded-default bg-surface-2 px-3 py-2 text-sm text-text-muted">
                  <Icon name="eye" size={16} />
                  {loadingPhoto ? (
                    <span className="inline-flex items-center gap-2" role="status">
                      <Spinner size="sm" />
                      Generating preview…
                    </span>
                  ) : photoUrl ? (
                    <>
                      <a
                        href={photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        View current document
                      </a>
                      <a
                        href={photoUrl}
                        download
                        className="inline-flex items-center text-primary hover:underline"
                      >
                        <Icon name="download" size={16} className="mr-1" /> Download
                      </a>
                    </>
                  ) : (
                    <span>Unable to generate preview</span>
                  )}
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-danger-fg border-danger-border hover:bg-danger-soft"
                    onClick={() => setDeletePhotoOpen(true)}
                    disabled={deletingPhoto}
                    icon={<Icon name="trash" size={16} />}
                  >
                    {deletingPhoto ? 'Deleting…' : 'Delete'}
                  </Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {state?.type === 'error' && state.errors && (
          <Alert tone="danger" size="sm">
            {Object.values(state.errors).flat().join(', ')}
          </Alert>
        )}
        {state?.type === 'error' && state.message && !state.errors && (
          <Alert tone="danger" size="sm">
            {state.message}
          </Alert>
        )}

        <FormFooter>
          {cancelHref && (
            <LinkButton href={cancelHref} variant="secondary">
              Cancel
            </LinkButton>
          )}
          <SubmitButton disabled={!canEdit} pending={isSaving} />
        </FormFooter>
      </form>
      <ConfirmDialog
        open={deletePhotoOpen}
        onClose={() => setDeletePhotoOpen(false)}
        onConfirm={handleDeletePhoto}
        title="Delete Right to Work Document?"
        message="This removes the stored document from the employee record. This cannot be undone."
        confirmLabel="Delete"
        loadingText="Deleting..."
        tone="danger"
        closeOnConfirm={false}
      />
    </div>
  )
}
