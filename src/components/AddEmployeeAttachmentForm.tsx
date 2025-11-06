'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { addEmployeeAttachment } from '@/app/actions/employeeActions'
import type { AttachmentFormState } from '@/types/actions'
import type { AttachmentCategory } from '@/types/database'
import { Button } from '@/components/ui-v2/forms/Button'

interface AddEmployeeAttachmentFormProps {
  employeeId: string
  categories: AttachmentCategory[]
}

function SubmitAttachmentButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
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
  const hasCategories = categories.length > 0
  const router = useRouter()
  const initialState: AttachmentFormState = null
  const [state, dispatch] = useActionState(addEmployeeAttachment, initialState)
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state?.type === 'success') {
      formRef.current?.reset()
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      router.refresh()
    }
  }, [state, router])

  return (
    <form
      action={dispatch}
      ref={formRef}
      encType="multipart/form-data"
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
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            required
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-soft file:text-primary hover:file:bg-primary-soft/80 disabled:cursor-not-allowed"
            disabled={!hasCategories}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Accepted: PDF, Word, JPG, PNG (max 10&nbsp;MB).
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
        <SubmitAttachmentButton disabled={!hasCategories} />
      </div>

      {!hasCategories && (
        <p className="text-sm text-gray-500">
          Create at least one attachment category in Settings before uploading documents.
        </p>
      )}
    </form>
  )
}
