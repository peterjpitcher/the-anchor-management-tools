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
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { 
  TagIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  SparklesIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

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
    if (!confirm(`Are you sure you want to delete the "${label.name}" label?`)) {
      return
    }

    try {
      const result = await deleteCustomerLabel(label.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Label deleted successfully')
        loadLabels()
      }
    } catch {
      toast.error('Failed to delete label')
    }
  }

  async function handleApplyRetroactively() {
    if (!confirm('This will analyze all customers and apply labels based on their history. Continue?')) {
      return
    }

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
      <div className="text-center py-12">
        <p className="text-gray-500">You don&apos;t have permission to view customer labels.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Customer Labels</h1>
              <p className="mt-1 text-sm text-gray-500">
                Organize customers with labels for better targeting and management
              </p>
            </div>
            {canManage && (
              <div className="flex space-x-3">
                <Button
                  variant="secondary"
                  onClick={handleApplyRetroactively}
                  disabled={applyingRetroactively}
                >
                  {applyingRetroactively ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="mr-2 h-4 w-4" />
                      Apply Retroactively
                    </>
                  )}
                </Button>
                <Button onClick={() => setShowForm(true)}>
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add Label
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Labels List */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            </div>
          ) : labels.length === 0 ? (
            <div className="text-center py-8">
              <TagIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No labels</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating a new label.</p>
              {canManage && (
                <div className="mt-6">
                  <Button onClick={() => setShowForm(true)}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    Add Label
                  </Button>
                </div>
              )}
            </div>
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
                          onClick={() => handleDelete(label)}
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
        </div>
      </div>

      {/* Form Modal */}
      <Modal
        isOpen={showForm}
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Label Name
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description (optional)
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            />
          </div>

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
        </form>
      </Modal>
    </div>
  )
}