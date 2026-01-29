'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createEmployeeAttachmentUploadUrl, saveEmployeeAttachmentRecord } from '@/app/actions/employeeActions'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { AttachmentFormState } from '@/types/actions'
import type { AttachmentCategory } from '@/types/database'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { MAX_FILE_SIZE } from '@/lib/constants'

const ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/tif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
] as const

interface AddEmployeeAttachmentFormProps {
  employeeId: string
  categories: AttachmentCategory[]
}

function SubmitAttachmentButton({ disabled, pending }: { disabled?: boolean; pending: boolean }) {
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending || disabled}>
      {pending ? 'Uploading…' : 'Upload Attachment'}
    </Button>
  )
}

export default function AddEmployeeAttachmentForm({
  employeeId,
  categories
}: AddEmployeeAttachmentFormProps) {
  const supabase = useSupabase()
  const hasCategories = categories.length > 0
  const router = useRouter()
  const [state, setState] = useState<AttachmentFormState>(null)
  const [isUploading, startTransition] = useTransition()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasCategories) return

    const file = selectedFile
    if (!file) {
      setState({ type: 'error', message: 'Please select a file to upload.', errors: { attachment_file: ['A file is required.'] } })
      return
    }

    const rawFormData = new FormData(event.currentTarget)
    const categoryId = String(rawFormData.get('category_id') || '')
    const description = String(rawFormData.get('description') || '')

    startTransition(async () => {
      try {
        const signedUpload = await createEmployeeAttachmentUploadUrl(employeeId, file.name, file.type, file.size)
        if (signedUpload.type === 'error') {
          setState({ type: 'error', message: signedUpload.message || 'Failed to prepare attachment upload.' })
          return
        }

        const uploadResult = await supabase.storage
          .from('employee-attachments')
          .uploadToSignedUrl(signedUpload.path, signedUpload.token, file, {
            upsert: false,
            contentType: file.type,
          })

        if (uploadResult.error) {
          console.error('Attachment upload failed:', uploadResult.error)
          setState({ type: 'error', message: uploadResult.error.message || 'Failed to upload attachment.' })
          return
        }

        const saveForm = new FormData()
        saveForm.append('employee_id', employeeId)
        saveForm.append('category_id', categoryId)
        if (description.trim()) saveForm.append('description', description)
        saveForm.append('storage_path', signedUpload.path)
        saveForm.append('file_name', file.name)
        saveForm.append('mime_type', file.type)
        saveForm.append('file_size_bytes', String(file.size))

        const result = await saveEmployeeAttachmentRecord(null, saveForm)
        setState(result)

        if (result?.type === 'success') {
          formRef.current?.reset()
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
          setSelectedFile(null)
          router.refresh()
        }
      } catch (error) {
        console.error('Attachment save failed:', error)
        setState({ type: 'error', message: error instanceof Error ? error.message : 'Failed to upload attachment.' })
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      ref={formRef}
      className="space-y-6"
    >
      <input type="hidden" name="employee_id" value={employeeId} />

      <div>
        <label htmlFor="attachment_file" className="block text-sm font-medium leading-6 text-gray-900">
          File
        </label>
        <div className="mt-2">
          <input
            id="attachment_file"
            name="attachment_file"
            type="file"
            ref={fileInputRef}
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,.txt"
            required
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-soft file:text-primary hover:file:bg-primary-soft/80 disabled:cursor-not-allowed"
            disabled={!hasCategories || isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) {
                setSelectedFile(null)
                return
              }

              if (!ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.type as (typeof ATTACHMENT_ALLOWED_MIME_TYPES)[number])) {
                toast.error('Invalid file type. Only PDF, Word, JPG, PNG, TIFF, and TXT files are allowed.')
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
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Accepted: PDF, Word, JPG, PNG, TIFF, TXT (max 10&nbsp;MB).
        </p>
        {state?.errors?.attachment_file && (
          <p className="mt-1 text-sm text-red-600">{state.errors.attachment_file}</p>
        )}
      </div>

      <div>
        <label htmlFor="category_id" className="block text-sm font-medium leading-6 text-gray-900">
          Category
        </label>
        <select
          id="category_id"
          name="category_id"
          className="mt-2 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-primary sm:text-sm sm:leading-6"
          defaultValue={hasCategories ? '' : 'no-category'}
          required
          disabled={!hasCategories}
        >
          <option value="" disabled>
            Select a category
          </option>
          {!hasCategories && (
            <option value="no-category" disabled>
              No categories available
            </option>
          )}
          {categories.map((category) => (
            <option key={category.category_id} value={category.category_id}>
              {category.category_name}
            </option>
          ))}
        </select>
        {state?.errors?.category_id && <p className="mt-1 text-sm text-red-600">{state.errors.category_id}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium leading-6 text-gray-900">
          Description (Optional)
        </label>
        <div className="mt-2">
          <textarea
            id="description"
            name="description"
            rows={2}
            className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
            defaultValue=""
          />
        </div>
        {state?.errors?.description && <p className="mt-1 text-sm text-red-600">{state.errors.description}</p>}
      </div>

      {state?.type === 'error' && state.errors?.general && (
        <p className="mt-1 text-sm text-red-600">{state.errors.general}</p>
      )}
      {state?.type === 'error' && state.message && !state.errors && (
        <p className="mt-1 text-sm text-red-600">{state.message}</p>
      )}

      <div className="flex justify-end">
        <SubmitAttachmentButton disabled={!hasCategories} pending={isUploading} />
      </div>

      {!hasCategories && (
        <p className="text-sm text-gray-500">
          Create at least one attachment category in Settings before uploading documents.
        </p>
      )}
    </form>
  )
}
