'use client'

import { useState, useEffect } from 'react'
import { usePermissions } from '@/contexts/PermissionContext'
import { 
  getCustomerLabels, 
  createCustomerLabel, 
  updateCustomerLabel, 
  deleteCustomerLabel,
  applyLabelsRetroactively,
  type CustomerLabel 
} from '@/app/actions/customer-labels'
import { 
  TagIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  SparklesIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Form } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'

const PRESET_COLORS = [
  { name: 'Green', value: '#10B981' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Yellow', value: '#F59E0B' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Indigo', value: '#6366F1' }
]


export default function CustomerLabelsPage() {
  const { hasPermission } = usePermissions()
  const [labels, setLabels] = useState<CustomerLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingLabel, setEditingLabel] = useState<CustomerLabel | null>(null)
  const [applyingRetroactively, setApplyingRetroactively] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<CustomerLabel | null>(null)
  const [retroactiveConfirm, setRetroactiveConfirm] = useState(false)
  
  const canView = hasPermission('customers', 'view')
  const canManage = hasPermission('customers', 'manage')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#10B981',
    icon: 'star',
    auto_apply_rules: {}
  })

  useEffect(() => {
    if (canView) {
      loadLabels()
    }
  }, [canView])

  async function loadLabels() {
    try {
      const result = await getCustomerLabels()
      if (result.error) {
        toast.error(result.error)
      } else if (result.data) {
        setLabels(result.data)
      }
    } catch {
      toast.error('Failed to load customer labels')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    try {
      if (editingLabel) {
        const result = await updateCustomerLabel(editingLabel.id, formData)
        if (result.error) {
          toast.error(result.error)
        } else {
          toast.success('Label updated successfully')
          setShowForm(false)
          setEditingLabel(null)
          loadLabels()
        }
      } else {
        const result = await createCustomerLabel(formData)
        if (result.error) {
          toast.error(result.error)
        } else {
          toast.success('Label created successfully')
          setShowForm(false)
          loadLabels()
        }
      }
      
      // Reset form
      setFormData({
        name: '',
        description: '',
        color: '#10B981',
        icon: 'star',
        auto_apply_rules: {}
      })
    } catch {
      toast.error('Failed to save label')
    }
  }

  async function handleDelete(label: CustomerLabel) {
    try {
      const result = await deleteCustomerLabel(label.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Label deleted successfully')
        loadLabels()
      }
      setDeleteConfirm(null)
    } catch {
      toast.error('Failed to delete label')
    }
  }

  async function handleApplyRetroactively() {
    setRetroactiveConfirm(false)

    setApplyingRetroactively(true)
    try {
      const result = await applyLabelsRetroactively()
      if (result.error) {
        toast.error(result.error)
      } else if (result.data) {
        toast.success(`Applied labels to ${result.data.length} customers`)
      }
    } catch {
      toast.error('Failed to apply labels retroactively')
    } finally {
      setApplyingRetroactively(false)
    }
  }

  function openEditForm(label: CustomerLabel) {
    setEditingLabel(label)
    setFormData({
      name: label.name,
      description: label.description || '',
      color: label.color,
      icon: label.icon || 'star',
      auto_apply_rules: label.auto_apply_rules || {}
    })
    setShowForm(true)
  }

  if (!canView) {
    return (
      <Page title="Customer Labels">
        <Card>
          <Alert variant="error"
            title="Access Denied"
            description="You don't have permission to view customer labels."
          />
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title="Customer Labels"
      description="Organize customers with labels for better targeting and management"
      actions={
        canManage && (
          <div className="flex space-x-3">
            <Button
              variant="secondary"
              onClick={() => setRetroactiveConfirm(true)}
              disabled={applyingRetroactively}
              loading={applyingRetroactively}
            >
              <SparklesIcon className="mr-2 h-4 w-4" />
              Apply Retroactively
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Label
            </Button>
          </div>
        )
      }
    >
      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        title="Delete Label"
        message={`Are you sure you want to delete the "${deleteConfirm?.name}" label?`}
        confirmText="Delete"
        type="danger"
      />
      
      <ConfirmDialog
        open={retroactiveConfirm}
        onClose={() => setRetroactiveConfirm(false)}
        onConfirm={handleApplyRetroactively}
        title="Apply Labels Retroactively"
        message="This will analyze all customers and apply labels based on their history. Continue?"
        confirmText="Apply"
        type="info"
      />

      {/* Info about daily updates */}
      <div className="mb-4">
        <p className="text-sm text-green-600 flex items-center">
          <CheckCircleIcon className="mr-1 h-4 w-4" />
          Labels are automatically updated daily at 2:00 AM
        </p>
      </div>

      {/* Labels List */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : labels.length === 0 ? (
          <EmptyState icon={<TagIcon className="h-12 w-12" />}
            title="No labels"
            description="Get started by creating a new label."
            action={
              canManage && (
                <Button onClick={() => setShowForm(true)}>
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add Label
                </Button>
              )
            }
          />
        ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {labels.map((label) => (
                <div
                  key={label.id}
                  className="relative rounded-lg border border-gray-200 p-4 hover:border-gray-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div
                        className="h-10 w-10 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: label.color }}
                      >
                        <TagIcon className="h-5 w-5 text-white" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-gray-900">{label.name}</h3>
                        {label.description && (
                          <p className="text-sm text-gray-500">{label.description}</p>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex space-x-1">
                        <button
                          onClick={() => openEditForm(label)}
                          className="p-1 text-gray-400 hover:text-gray-500"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(label)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {label.auto_apply_rules && !label.auto_apply_rules.manual_only && (
                    <div className="mt-2 text-xs text-gray-500">
                      <SparklesIcon className="inline h-3 w-3 mr-1" />
                      Auto-applied based on rules
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingLabel(null)
          setFormData({
            name: '',
            description: '',
            color: '#10B981',
            icon: 'star',
            auto_apply_rules: {}
          })
        }}
        title={editingLabel ? 'Edit Label' : 'Create Label'}
      >
        <Form onSubmit={handleSubmit}>
          <FormGroup label="Label Name" required>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </FormGroup>

          <FormGroup label="Description (optional)">
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </FormGroup>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Color
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  className={`relative rounded-lg p-3 flex items-center justify-center ${
                    formData.color === color.value
                      ? 'ring-2 ring-green-500 ring-offset-2'
                      : 'hover:ring-2 hover:ring-gray-300'
                  }`}
                  style={{ backgroundColor: color.value }}
                >
                  {formData.color === color.value && (
                    <CheckCircleIcon className="h-5 w-5 text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false)
                setEditingLabel(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit">
              {editingLabel ? 'Update' : 'Create'} Label
            </Button>
          </div>
        </Form>
      </Modal>
    </Page>
  )
}