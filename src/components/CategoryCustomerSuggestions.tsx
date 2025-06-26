'use client'

import { useState, useEffect, useCallback } from 'react'
import { getCategoryRegulars, getCrossCategorySuggestions } from '@/app/actions/event-categories'
import { CategoryRegular, CrossCategorySuggestion, EventCategory } from '@/types/event-categories'
import { UserGroupIcon, SparklesIcon, CheckIcon } from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'
import toast from 'react-hot-toast'

interface CategoryCustomerSuggestionsProps {
  categoryId: string | null
  categories: EventCategory[]
  onSelectCustomers: (customerIds: string[]) => void
  selectedCustomerIds?: string[]
}

export function CategoryCustomerSuggestions({ 
  categoryId, 
  categories,
  onSelectCustomers,
  selectedCustomerIds = []
}: CategoryCustomerSuggestionsProps) {
  const { hasPermission } = usePermissions()
  const [regulars, setRegulars] = useState<CategoryRegular[]>([])
  const [crossSuggestions, setCrossSuggestions] = useState<CrossCategorySuggestion[]>([])
  const [isLoadingRegulars, setIsLoadingRegulars] = useState(false)
  const [isLoadingCross, setIsLoadingCross] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'regulars' | 'cross'>('regulars')
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedCustomerIds))

  // Only show to managers
  const canViewSuggestions = hasPermission('customers', 'manage') || hasPermission('customers', 'view')

  useEffect(() => {
    setLocalSelectedIds(new Set(selectedCustomerIds))
  }, [selectedCustomerIds])

  const loadRegulars = useCallback(async () => {
    if (!categoryId) return

    setIsLoadingRegulars(true)
    try {
      const result = await getCategoryRegulars(categoryId, 90)
      if (result.data) {
        setRegulars(result.data)
      }
    } catch (error) {
      console.error('Error loading regulars:', error)
    } finally {
      setIsLoadingRegulars(false)
    }
  }, [categoryId])

  const loadCrossSuggestions = useCallback(async () => {
    if (!categoryId) return

    setIsLoadingCross(true)
    try {
      // Find other categories to get suggestions from
      const otherCategories = categories.filter(c => c.id !== categoryId)
      const allSuggestions: CrossCategorySuggestion[] = []

      // Get suggestions from each other category
      for (const otherCategory of otherCategories.slice(0, 3)) { // Limit to 3 categories
        const result = await getCrossCategorySuggestions(categoryId, otherCategory.id, 10)
        if (result.data) {
          allSuggestions.push(...result.data)
        }
      }

      // Remove duplicates and sort by attendance
      const uniqueSuggestions = Array.from(
        new Map(allSuggestions.map(s => [s.customer_id, s])).values()
      ).sort((a, b) => b.source_times_attended - a.source_times_attended)

      setCrossSuggestions(uniqueSuggestions.slice(0, 20))
    } catch (error) {
      console.error('Error loading cross suggestions:', error)
    } finally {
      setIsLoadingCross(false)
    }
  }, [categoryId, categories])

  useEffect(() => {
    if (categoryId && canViewSuggestions) {
      loadRegulars()
      loadCrossSuggestions()
    } else {
      setRegulars([])
      setCrossSuggestions([])
    }
  }, [categoryId, canViewSuggestions, loadRegulars, loadCrossSuggestions])

  const handleSelectAll = () => {
    const customerIds = regulars.map(r => r.customer_id)
    setLocalSelectedIds(new Set(customerIds))
    onSelectCustomers(customerIds)
    toast.success(`Selected all ${customerIds.length} regulars`)
  }

  const handleToggleCustomer = (customerId: string) => {
    const newSelected = new Set(localSelectedIds)
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId)
    } else {
      newSelected.add(customerId)
    }
    setLocalSelectedIds(newSelected)
    onSelectCustomers(Array.from(newSelected))
  }

  if (!categoryId || !canViewSuggestions) {
    return null
  }

  const selectedCategory = categories.find(c => c.id === categoryId)
  if (!selectedCategory) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-900 flex items-center">
          <UserGroupIcon className="h-5 w-5 mr-2 text-indigo-600" />
          Customer Suggestions for {selectedCategory.name}
        </h3>
        {regulars.length > 0 && (
          <button
            onClick={handleSelectAll}
            className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            Select All Regulars ({regulars.length})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setSelectedTab('regulars')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              selectedTab === 'regulars'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Regulars ({regulars.length})
          </button>
          <button
            onClick={() => setSelectedTab('cross')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
              selectedTab === 'cross'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <SparklesIcon className="h-4 w-4 mr-1" />
            Might Enjoy ({crossSuggestions.length})
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto">
        {selectedTab === 'regulars' ? (
          <div>
            {isLoadingRegulars ? (
              <div className="text-center py-4 text-gray-500">Loading regulars...</div>
            ) : regulars.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No customers have attended {selectedCategory.name} in the last 90 days
              </div>
            ) : (
              <div className="space-y-2">
                {regulars.map((regular) => (
                  <label
                    key={regular.customer_id}
                    className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={localSelectedIds.has(regular.customer_id)}
                        onChange={() => handleToggleCustomer(regular.customer_id)}
                        className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">
                          {regular.first_name} {regular.last_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {regular.mobile_number}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        {regular.times_attended}x
                      </p>
                      <p className="text-xs text-gray-500">
                        {regular.days_since_last_visit}d ago
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {isLoadingCross ? (
              <div className="text-center py-4 text-gray-500">Finding suggestions...</div>
            ) : crossSuggestions.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No cross-category suggestions available
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 mb-2">
                  Customers who enjoy similar events but haven&apos;t tried {selectedCategory.name} recently
                </p>
                {crossSuggestions.map((suggestion) => {
                  return (
                    <label
                      key={suggestion.customer_id}
                      className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={localSelectedIds.has(suggestion.customer_id)}
                          onChange={() => handleToggleCustomer(suggestion.customer_id)}
                          className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">
                            {suggestion.first_name} {suggestion.last_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {suggestion.mobile_number}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {suggestion.already_attended_target && (
                          <CheckIcon className="h-4 w-4 text-green-500 inline" />
                        )}
                        <p className="text-xs text-gray-500">
                          Regular at other events
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {localSelectedIds.size > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            {localSelectedIds.size} customer{localSelectedIds.size !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  )
}