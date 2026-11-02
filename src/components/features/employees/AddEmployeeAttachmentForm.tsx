'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addEmployeeAttachment } from '@/app/actions/employeeActions'
import type { AttachmentFormState } from '@/types/actions'
import type { AttachmentCategory } from '@/types/database'
import { Alert, Button, Field, FileButton, FormFooter, Icon, Select, Textarea, toast } from '@/ds'
import { MAX_FILE_SIZE } from '@/lib/constants'
import {
  EMPLOYEE_ATTACHMENT_ACCEPT,
  EMPLOYEE_ATTACHMENT_TYPE_MESSAGE,
  isAllowedAttachmentType,
} from '@/lib/employees/document-rules'

interface AddEmployeeAttachmentFormProps {
  employeeId: string
  categories: AttachmentCategory[]
}

function SubmitAttachmentButton({ disabled, pending }: { disabled?: boolean; pending: boolean }) {
  return (
    <Button type="submit" variant="primary" disabled={disabled} loading={pending}>
      Upload Attachment
    </Button>
  )
}

export default function AddEmployeeAttachmentForm({
  employeeId,
  categories
}: AddEmployeeAttachmentFormProps) {
  const hasCategories = categories.length > 0
  const router = useRouter()
  const [state, setState] = useState<AttachmentFormState>(null)
  const [isUploading, startTransition] = useTransition()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  // Some categories email the file to the employee on upload, so say so before it goes.
  const selectedCategoryEmails = categories.some(
    (category) => category.category_id === selectedCategoryId && category.email_on_upload
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasCategories) return

    const file = selectedFile
    if (!file) {
      setState({ type: 'error', message: 'Please select a file to upload.', errors: { attachment_file: ['A file is required.'] } })
      return
    }

    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append('employee_id', employeeId)
        formData.append('attachment_file', file)
        formData.append('category_id', String(new FormData(formRef.current!).get('category_id') || ''))
        const description = String(new FormData(formRef.current!).get('description') || '')
        if (description.trim()) formData.append('description', description)

        const result = await addEmployeeAttachment(null, formData)
        setState(result)

        if (result?.type === 'success') {
          // A failed email to the employee is a warning, not a silent success: the file is
          // saved, but the employee may not have it.
          if (result.email?.status === 'failed') {
            toast.warning(result.message ?? 'Attachment uploaded, but the email to the employee may not have been sent.', { duration: 10000 })
          } else {
            toast.success(result.message ?? 'Attachment uploaded.')
          }
          formRef.current?.reset()
          setSelectedFile(null)
          setSelectedCategoryId('')
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
      className="space-y-4"
    >
      <input type="hidden" name="employee_id" value={employeeId} />

      <Field
        label="File"
        // The chosen file is named in the hint, so it is read out with the button too.
        hint={`${selectedFile ? `${selectedFile.name}. ` : ''}Accepted: PDF, Word, JPG, PNG, TIFF, TXT (max 10 MB).`}
        error={state?.errors?.attachment_file?.join(' ') || undefined}
      >
        {/* The DS file picker: a Button over a hidden input, named by the Field. The file is sent
            from state (the handler builds the FormData), so the input keeps no value. */}
        <FileButton
          id="attachment_file"
          accept={EMPLOYEE_ATTACHMENT_ACCEPT}
          disabled={!hasCategories || isUploading}
          icon={<Icon name="upload" size={16} />}
          onFiles={([file]) => {
            if (!isAllowedAttachmentType(file.type)) {
              toast.error(EMPLOYEE_ATTACHMENT_TYPE_MESSAGE)
              setSelectedFile(null)
              return
            }

            if (file.size >= MAX_FILE_SIZE) {
              toast.error('File size must be less than 10MB.')
              setSelectedFile(null)
              return
            }

            setSelectedFile(file)
          }}
        >
          {selectedFile ? 'Choose Another File' : 'Choose File'}
        </FileButton>
      </Field>

      <Field label="Category">
        <Select
          id="category_id"
          name="category_id"
          defaultValue={hasCategories ? '' : 'no-category'}
          onChange={(event) => setSelectedCategoryId(event.target.value)}
          required
          disabled={!hasCategories}
          error={state?.errors?.category_id?.join(' ') || undefined}
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
        </Select>
      </Field>

      {selectedCategoryEmails && (
        <Alert tone="info" size="sm">
          Files in this category are emailed to the employee when you upload them.
        </Alert>
      )}

      <Field label="Description (Optional)">
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue=""
          error={state?.errors?.description?.join(' ') || undefined}
        />
      </Field>

      {state?.type === 'error' && state.errors?.general && (
        <Alert tone="danger" size="sm">{state.errors.general.join(' ')}</Alert>
      )}
      {state?.type === 'error' && state.message && !state.errors && (
        <Alert tone="danger" size="sm">{state.message}</Alert>
      )}

      {!hasCategories && (
        <Alert tone="warning" size="sm">
          Create at least one attachment category in Settings before uploading documents.
        </Alert>
      )}

      <FormFooter>
        <SubmitAttachmentButton disabled={!hasCategories} pending={isUploading} />
      </FormFooter>
    </form>
  )
}
