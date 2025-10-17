'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { AttachmentCategory } from '@/app/actions/attachmentCategories'
import { createAttachmentCategory, deleteAttachmentCategory, listAttachmentCategories, updateAttachmentCategory } from '@/app/actions/attachmentCategories'
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Form } from '@/components/ui-v2/forms/Form'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { useRouter } from 'next/navigation'

type CategoriesClientProps = {
  initialCategories: AttachmentCategory[]
  canManage: boolean
  initialError: string | null
}

export default function CategoriesClient({ initialCategories, canManage, initialError }: CategoriesClientProps) {
  const router = useRouter()
  const [categories, setCategories] = useState(initialCategories)
  const [error, setError] = useState<string | null>(initialError)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
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
      const result = await createAttachmentCategory({ name: newCategoryName })
      if (result.error) {
        setError(result.error)
        return
      }

      setNewCategoryName('')
      refreshCategories()
    })
  }

  const handleStartEdit = (categoryId: string, categoryName: string) => {
    setEditingId(categoryId)
    setEditingName(categoryName)
    setError(null)
  }

  const handleUpdateCategory = async (categoryId: string) => {
    if (!editingName.trim()) {
      setError('Please enter a category name')
      return
    }

    startMutateTransition(async () => {
      const result = await updateAttachmentCategory({ id: categoryId, name: editingName })
      if (result.error) {
        setError(result.error)
        return
      }

      setEditingId(null)
      setEditingName('')
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
    <Page
      title="Attachment Categories"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Categories' },
      ]}
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
      <p className="text-sm text-gray-700 mb-6">Manage categories for employee attachment files.</p>

      {error && (
        <Alert variant="error" title="Error" description={error} className="mb-6" />
      )}

      {!canManage && (
        <Alert
          variant="info"
          description="You have read-only access to attachment categories."
          className="mb-6"
        />
      )}

      <Section title="Add New Category">
        <Card>
          <Form onSubmit={handleAddCategory}>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="flex-1"
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
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1"
                        autoFocus
                      />
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
                        }}
                        variant="secondary"
                        size="sm"
                        disabled={isMutating}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{category.category_name}</p>
                        <p className="text-xs text-gray-500">
                          Updated {new Date(category.updated_at).toLocaleString('en-GB')}
                        </p>
                      </div>
                      {canManage && (
                        <div className="flex gap-2">
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
    </Page>
  )
}
