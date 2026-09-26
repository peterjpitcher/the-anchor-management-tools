'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  getCustomerLabels, 
  getCustomerLabelAssignments,
  assignLabelToCustomer,
  removeLabelFromCustomer,
  type CustomerLabel,
  type CustomerLabelAssignment
} from '@/app/actions/customer-labels'
import { Button, Dropdown, DropdownItem, PageLoading, toast, Icon } from '@/ds'

interface CustomerLabelSelectorProps {
  customerId: string
  canEdit?: boolean
  onLabelsChange?: (labels: CustomerLabelAssignment[]) => void
  initialLabels?: CustomerLabel[]
  initialAssignments?: CustomerLabelAssignment[]
}

export function CustomerLabelSelector({ 
  customerId, 
  canEdit = false,
  onLabelsChange,
  initialLabels,
  initialAssignments
}: CustomerLabelSelectorProps) {
  const [allLabels, setAllLabels] = useState<CustomerLabel[]>(initialLabels ?? [])
  const [customerLabels, setCustomerLabels] = useState<CustomerLabelAssignment[]>(initialAssignments ?? [])
  const [loading, setLoading] = useState(!(initialLabels && initialAssignments))
  const [assigningLabel, setAssigningLabel] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
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
  }, [customerId, onLabelsChange])

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

  useEffect(() => {
    if (initialLabels && initialAssignments && initialAssignments.every(a => a.customer_id === customerId)) {
      setAllLabels(initialLabels)
      setCustomerLabels(initialAssignments)
      onLabelsChange?.(initialAssignments)
      setLoading(false)
      return
    }

    loadData()
  }, [customerId, initialAssignments, initialLabels, loadData, onLabelsChange])

  if (loading) {
    return <PageLoading inline label="Loading labels" className="py-4" />
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
              className="inline-flex items-center rounded-pill px-3 py-1 text-xs font-medium"
              style={{ 
                backgroundColor: `${label.color}20`,
                color: label.color
              }}
            >
              <Icon name="tag" size={12} className="mr-1" />
              {label.name}
              {assignment.auto_assigned && (
                <span className="ml-1 text-xs opacity-70">(auto)</span>
              )}
              {canEdit && !assignment.auto_assigned && (
                // A plain button: it is the remove control inside a chip drawn in the label's
                // saved colour. The DS has no removable Badge, and even a small DS IconButton is
                // a full button height, taller than the chip on desktop. (On phones the global
                // touch floor in globals.css gives every button 44px, this one included.)
                <button type="button"
                  onClick={() => handleRemoveLabel(label.id)}
                  aria-label={`Remove ${label.name}`}
                  className="ml-1 rounded-full hover:opacity-70 focus-visible:outline-hidden focus-visible:shadow-ring"
                >
                  <Icon name="x" size={12} className="block" />
                </button>
              )}
            </span>
          )
        })}

        {/* The labels that can be added. The DS Dropdown is portalled, so the Card this sits
            in cannot clip the menu. */}
        {canEdit && availableLabels.length > 0 && (
          <Dropdown
            align="left"
            trigger={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Icon name="tag" size={12} />}
                loading={assigningLabel !== null}
              >
                Add Label
              </Button>
            }
          >
            {availableLabels.map((label) => (
              <DropdownItem
                key={label.id}
                onClick={() => void handleAssignLabel(label.id)}
                icon={
                  <span
                    aria-hidden="true"
                    className="block h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                }
              >
                {label.name}
              </DropdownItem>
            ))}
          </Dropdown>
        )}
      </div>
    </div>
  )
}
