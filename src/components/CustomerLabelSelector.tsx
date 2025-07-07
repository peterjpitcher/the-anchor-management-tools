'use client'

import { useState, useEffect } from 'react'
import { 
  getCustomerLabels, 
  getCustomerLabelAssignments,
  assignLabelToCustomer,
  removeLabelFromCustomer,
  type CustomerLabel,
  type CustomerLabelAssignment
} from '@/app/actions/customer-labels'
import { TagIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface CustomerLabelSelectorProps {
  customerId: string
  canEdit?: boolean
  onLabelsChange?: (labels: CustomerLabelAssignment[]) => void
}

export function CustomerLabelSelector({ 
  customerId, 
  canEdit = false,
  onLabelsChange 
}: CustomerLabelSelectorProps) {
  const [allLabels, setAllLabels] = useState<CustomerLabel[]>([])
  const [customerLabels, setCustomerLabels] = useState<CustomerLabelAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [showSelector, setShowSelector] = useState(false)
  const [assigningLabel, setAssigningLabel] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [customerId])

  async function loadData() {
    try {
      const [labelsResult, assignmentsResult] = await Promise.all([
        getCustomerLabels(),
        getCustomerLabelAssignments(customerId)
      ])

      if (labelsResult.data) {
        setAllLabels(labelsResult.data)
      }
      if (assignmentsResult.data) {
        setCustomerLabels(assignmentsResult.data)
        onLabelsChange?.(assignmentsResult.data)
      }
    } catch (error) {
      console.error('Error loading labels:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAssignLabel(labelId: string) {
    setAssigningLabel(labelId)
    try {
      const result = await assignLabelToCustomer({
        customer_id: customerId,
        label_id: labelId
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Label assigned')
        await loadData()
        setShowSelector(false)
      }
    } catch (error) {
      toast.error('Failed to assign label')
    } finally {
      setAssigningLabel(null)
    }
  }

  async function handleRemoveLabel(labelId: string) {
    try {
      const result = await removeLabelFromCustomer(customerId, labelId)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Label removed')
        await loadData()
      }
    } catch (error) {
      toast.error('Failed to remove label')
    }
  }

  const assignedLabelIds = customerLabels.map(cl => cl.label_id)
  const availableLabels = allLabels.filter(l => !assignedLabelIds.includes(l.id))

  if (loading) {
    return (
      <div className="flex items-center space-x-2">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-500">Loading labels...</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Assigned Labels */}
      <div className="flex flex-wrap gap-2">
        {customerLabels.map((assignment) => {
          const label = assignment.label as CustomerLabel
          if (!label) return null

          return (
            <span
              key={assignment.id}
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
              style={{ 
                backgroundColor: `${label.color}20`,
                color: label.color
              }}
            >
              <TagIcon className="h-3 w-3 mr-1" />
              {label.name}
              {assignment.auto_assigned && (
                <span className="ml-1 text-xs opacity-70">(auto)</span>
              )}
              {canEdit && !assignment.auto_assigned && (
                <button
                  onClick={() => handleRemoveLabel(label.id)}
                  className="ml-1 hover:opacity-70"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              )}
            </span>
          )
        })}

        {/* Add Label Button */}
        {canEdit && availableLabels.length > 0 && (
          <button
            onClick={() => setShowSelector(!showSelector)}
            className="inline-flex items-center rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <TagIcon className="h-3 w-3 mr-1" />
            Add Label
          </button>
        )}
      </div>

      {/* Label Selector Dropdown */}
      {showSelector && canEdit && (
        <div className="relative">
          <div className="absolute z-10 mt-1 w-64 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
            <div className="py-1">
              {availableLabels.map((label) => (
                <button
                  key={label.id}
                  onClick={() => handleAssignLabel(label.id)}
                  disabled={assigningLabel === label.id}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50 flex items-center justify-between"
                >
                  <div className="flex items-center">
                    <div
                      className="h-4 w-4 rounded-full mr-2"
                      style={{ backgroundColor: label.color }}
                    />
                    <span>{label.name}</span>
                  </div>
                  {assigningLabel === label.id && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}