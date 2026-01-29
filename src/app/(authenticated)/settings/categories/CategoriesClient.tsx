'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { AttachmentCategory } from '@/app/actions/attachmentCategories'
import { createAttachmentCategory, deleteAttachmentCategory, listAttachmentCategories, updateAttachmentCategory } from '@/app/actions/attachmentCategories'
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Form } from '@/components/ui-v2/forms/Form'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'

type CategoriesClientProps = {
  initialCategories: AttachmentCategory[]
  canManage: boolean
  initialError: string | null
}

export default function CategoriesClient({ initialCategories, canManage, initialError }: CategoriesClientProps) {
  const [categories, setCategories] = useState(initialCategories)
  const [error, setError] = useState<string | null>(initialError)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryEmailOnUpload, setNewCategoryEmailOnUpload] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingEmailOnUpload, setEditingEmailOnUpload] = useState(false)
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [isMutating, startMutateTransition] = useTransition()

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.category_name.localeCompare(b.category_name)),
    [categories],
  )

  const refreshCategories = () => {
    startRefreshTransition(async () => {
      setError(null)
      const result = await listAttachmentCategories()
      if (result.error) {
        setError(result.error)
        return
      }

      setCategories(result.categories ?? [])
    })
  }

  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])

  const handleAddCategory = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newCategoryName.trim()) {
      setError('Please enter a category name')
      return
    }

    startMutateTransition(async () => {
      const result = await createAttachmentCategory({ name: newCategoryName, emailOnUpload: newCategoryEmailOnUpload })
      if (result.error) {
        setError(result.error)
        return
      }

      setNewCategoryName('')
      setNewCategoryEmailOnUpload(false)
      refreshCategories()
    })
  }

  const handleStartEdit = (categoryId: string, categoryName: string) => {
    setEditingId(categoryId)
    setEditingName(categoryName)
    const selected = categories.find((category) => category.category_id === categoryId)
    setEditingEmailOnUpload(Boolean(selected?.email_on_upload))
    setError(null)
  }

  const handleUpdateCategory = async (categoryId: string) => {
    if (!editingName.trim()) {
      setError('Please enter a category name')
      return
    }

    startMutateTransition(async () => {
      const result = await updateAttachmentCategory({
        id: categoryId,
        name: editingName,
        emailOnUpload: editingEmailOnUpload,
      })
      if (result.error) {
        setError(result.error)
        return
      }

      setEditingId(null)
      setEditingName('')
      setEditingEmailOnUpload(false)
      refreshCategories()
    })
  }

  const handleToggleEmailOnUpload = (categoryId: string, nextValue: boolean, categoryName: string) => {
    startMutateTransition(async () => {
      const result = await updateAttachmentCategory({
        id: categoryId,
        name: categoryName,
        emailOnUpload: nextValue,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      refreshCategories()
    })
  }

  const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
    const confirmed = confirm(
      `Delete "${categoryName}"? Any attachments using this category will need to be updated.`,
    )
    if (!confirmed) {
      return
    }

    startMutateTransition(async () => {
      const result = await deleteAttachmentCategory(categoryId)
      if (result.error) {
        setError(result.error)
        return
      }
      refreshCategories()
    })
  }

  return (
    <PageLayout
      title="Attachment Categories"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Categories' },
      ]}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        <p className="text-sm text-gray-700">
          Manage categories for employee attachment files.
        </p>

        {error && (
          <Alert variant="error" title="Error" description={error} />
        )}

        {!canManage && (
          <Alert
            variant="info"
            description="You have read-only access to attachment categories."
          />
        )}

        <Section title="Add New Category">
          <Card>
            <Form onSubmit={handleAddCategory}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  className="flex-1"
                  disabled={!canManage || isMutating}
                />
                <Checkbox
                  label="Email on upload"
                  checked={newCategoryEmailOnUpload}
                  onChange={(event) => setNewCategoryEmailOnUpload(event.target.checked)}
                  disabled={!canManage || isMutating}
                />
                <Button
                  type="submit"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  disabled={!canManage || isMutating}
                >
                  Add Category
                </Button>
              </div>
            </Form>
          </Card>
        </Section>

        <Section title="Categories">
          <Card>
            {isRefreshing ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : sortedCategories.length === 0 ? (
              <EmptyState
                title="No categories defined"
                description="Add your first category above to get started."
              />
            ) : (
              <div className="divide-y divide-gray-200">
                {sortedCategories.map((category) => (
                  <div key={category.category_id} className="px-4 py-4">
                    {editingId === category.category_id ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1"
                          autoFocus
                        />
                        <Checkbox
                          label="Email on upload"
                          checked={editingEmailOnUpload}
                          onChange={(event) => setEditingEmailOnUpload(event.target.checked)}
                          disabled={isMutating}
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleUpdateCategory(category.category_id)}
                            variant="primary"
                            size="sm"
                            disabled={isMutating}
                          >
                            Save
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingId(null)
                              setEditingName('')
                              setEditingEmailOnUpload(false)
                            }}
                            variant="secondary"
                            size="sm"
                            disabled={isMutating}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{category.category_name}</p>
                          <p className="text-xs text-gray-500">
                            Updated {new Date(category.updated_at).toLocaleString('en-GB')}
                          </p>
                          {!canManage && (
                            <p className="text-xs text-gray-500">
                              Email on upload: {category.email_on_upload ? 'On' : 'Off'}
                            </p>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex gap-2">
                            <Checkbox
                              label="Email on upload"
                              checked={category.email_on_upload}
                              onChange={(event) => handleToggleEmailOnUpload(category.category_id, event.target.checked, category.category_name)}
                              disabled={isMutating}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<PencilIcon className="h-4 w-4" />}
                              onClick={() => handleStartEdit(category.category_id, category.category_name)}
                              disabled={isMutating}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<TrashIcon className="h-4 w-4" />}
                              onClick={() => handleDeleteCategory(category.category_id, category.category_name)}
                              disabled={isMutating}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Section>
      </div>
    </PageLayout>
  )
}
