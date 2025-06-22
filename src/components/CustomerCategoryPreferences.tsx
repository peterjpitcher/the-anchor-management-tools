'use client'

import { useEffect, useState } from 'react'
import { getCustomerCategoryPreferences } from '@/app/actions/event-categories'
import { TagIcon } from '@heroicons/react/24/outline'

interface CategoryPreference {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended: string | null
  created_at: string
  updated_at: string
  event_categories: {
    id: string
    name: string
    color: string
    icon: string
  }
}

interface CustomerCategoryPreferencesProps {
  customerId: string
}

export function CustomerCategoryPreferences({ customerId }: CustomerCategoryPreferencesProps) {
  const [preferences, setPreferences] = useState<CategoryPreference[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadPreferences() {
      setIsLoading(true)
      try {
        const result = await getCustomerCategoryPreferences(customerId)
        if (result.data) {
          setPreferences(result.data)
        }
      } catch (error) {
        console.error('Error loading category preferences:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadPreferences()
  }, [customerId])

  if (isLoading) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="space-y-3">
              <div className="h-12 bg-gray-100 rounded"></div>
              <div className="h-12 bg-gray-100 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (preferences.length === 0) {
    return null
  }

  // Calculate total events attended
  const totalEvents = preferences.reduce((sum, pref) => sum + pref.times_attended, 0)

  // Get the most attended category
  const favoriteCategory = preferences[0]

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <TagIcon className="h-5 w-5 mr-2 text-gray-400" />
            Event Preferences
          </h3>
          <span className="text-sm text-gray-500">
            {totalEvents} total events attended
          </span>
        </div>

        <div className="space-y-3">
          {preferences.map((pref) => {
            const percentage = Math.round((pref.times_attended / totalEvents) * 100)
            const isFavorite = pref.category_id === favoriteCategory.category_id

            return (
              <div key={pref.category_id} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center">
                    <span
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: pref.event_categories.color + '20',
                        color: pref.event_categories.color
                      }}
                    >
                      {pref.event_categories.name}
                    </span>
                    {isFavorite && (
                      <span className="ml-2 text-xs text-amber-600 font-medium">
                        ⭐ Favorite
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    {pref.times_attended} events ({percentage}%)
                  </div>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: pref.event_categories.color
                    }}
                  />
                </div>

                {pref.last_attended && (
                  <p className="mt-1 text-xs text-gray-500">
                    Last attended: {new Date(pref.last_attended).toLocaleDateString()}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Insights */}
        {preferences.length > 1 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Tip:</span> This customer prefers{' '}
              <span 
                className="font-medium"
                style={{ color: favoriteCategory.event_categories.color }}
              >
                {favoriteCategory.event_categories.name}
              </span>
              {' '}events. Consider sending them targeted invitations for similar events.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}