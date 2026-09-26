'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { AttachmentCategory } from '@/app/actions/attachmentCategories'
import { createAttachmentCategory, deleteAttachmentCategory, listAttachmentCategories, updateAttachmentCategory } from '@/app/actions/attachmentCategories'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  PageLayout,
  PageLoading,
} from '@/ds'

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
  // A list that failed to load is an error, never shown as "no categories".
  const [loadFailed, setLoadFailed] = useState(initialError !== null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

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
        setLoadFailed(true)
        return
      }

      setLoadFailed(false)
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

  const handleDeleteCategory = (categoryId: string) => {
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
      subtitle="Manage categories for employee attachment files"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      {!canManage && (
        <Alert tone="info">
          You have read-only access to attachment categories.
        </Alert>
      )}

      <Card>
        <CardHeader title="Add New Category" />
        <CardBody>
          <form onSubmit={handleAddCategory} className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Name" className="flex-1">
                <Input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  disabled={!canManage || isMutating}
                />
              </Field>
              {/* Level with the field beside it: bottom of the row, at least the field's height.
                  A minimum, not a fixed height: on a touch screen the label grows to 44px. */}
              <Checkbox
                className="min-h-input-h items-center"
                label="Email on upload"
                checked={newCategoryEmailOnUpload}
                onChange={(checked) => setNewCategoryEmailOnUpload(checked)}
                disabled={!canManage || isMutating}
              />
            </div>
            <FormFooter>
              <Button
                type="submit"
                variant="primary"
                icon={<Icon name="plus" size={16} />}
                disabled={!canManage || isMutating}
              >
                Add Category
              </Button>
            </FormFooter>
          </form>
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader title="Categories" />
        {isRefreshing ? (
          <PageLoading inline label="Loading categories" />
        ) : sortedCategories.length === 0 ? (
          loadFailed ? null : (
            <Empty
              size="sm"
              title="No categories defined"
              description="Add your first category above to get started."
            />
          )
        ) : (
          <div className="divide-y divide-border">
            {sortedCategories.map((category) => (
              <div key={category.category_id} className="px-pad-card py-4">
                {editingId === category.category_id ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Input
                      type="text"
                      aria-label="Category name"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1"
                      autoFocus
                    />
                    <Checkbox
                      label="Email on upload"
                      checked={editingEmailOnUpload}
                      onChange={(checked) => setEditingEmailOnUpload(checked)}
                      disabled={isMutating}
                    />
                    <div className="flex gap-2">
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
                      <Button
                        onClick={() => handleUpdateCategory(category.category_id)}
                        variant="primary"
                        size="sm"
                        disabled={isMutating}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{category.category_name}</p>
                      <p className="text-xs text-text-muted">
                        Updated {new Date(category.updated_at).toLocaleString('en-GB')}
                      </p>
                      {!canManage && (
                        <p className="text-xs text-text-muted">
                          Email on upload: {category.email_on_upload ? 'On' : 'Off'}
                        </p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          label="Email on upload"
                          checked={category.email_on_upload}
                          onChange={(checked) => handleToggleEmailOnUpload(category.category_id, checked, category.category_name)}
                          disabled={isMutating}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Icon name="edit" size={16} />}
                          onClick={() => handleStartEdit(category.category_id, category.category_name)}
                          disabled={isMutating}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Icon name="trash" size={16} />}
                          onClick={() => setDeleteTarget({ id: category.category_id, name: category.category_name })}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) handleDeleteCategory(deleteTarget.id)
        }}
        tone="danger"
        title="Delete Category"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? Any attachments using this category will need to be updated.`
            : undefined
        }
        confirmLabel="Delete"
      />
    </PageLayout>
  )
}
