'use client'

import { TagIcon } from '@heroicons/react/24/outline'
import { CustomerLabel, CustomerLabelAssignment } from '@/app/actions/customer-labels'

interface CustomerLabelDisplayProps {
  assignments: CustomerLabelAssignment[]
}

export function CustomerLabelDisplay({ assignments }: CustomerLabelDisplayProps) {
  if (!assignments || assignments.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1">
      {assignments.map((assignment) => {
        const label = assignment.label as CustomerLabel
        if (!label) return null

        return (
          <span
            key={assignment.id}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ 
              backgroundColor: `${label.color}20`,
              color: label.color
            }}
          >
            <TagIcon className="h-3 w-3 mr-0.5" />
            {label.name}
            {assignment.auto_assigned && (
              <span className="ml-0.5 opacity-70">(auto)</span>
            )}
          </span>
        )
      })}
    </div>
  )
}