'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  getCategoryRegulars,
  getCrossCategorySuggestions,
  getCategoryRecentCheckIns,
} from '@/app/actions/event-categories'
import {
  CategoryRegular,
  CrossCategorySuggestion,
  CategoryRecentCheckIn,
  EventCategory,
} from '@/types/event-categories'
import {
  UserGroupIcon,
  SparklesIcon,
  CheckIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'
import toast from 'react-hot-toast'

interface CategoryCustomerSuggestionsProps {
  categoryId: string | null
  categories: EventCategory[]
  onSelectCustomers: (selectedCustomerIds: string[], candidateCustomerIds: string[]) => void
  selectedCustomerIds?: string[]
  excludedCustomerIds?: string[]
}

type TabKey = 'recent' | 'regulars' | 'cross'

type TabMeta = {
  key: TabKey
  label: string
  icon?: JSX.Element
  count: number
}

export function CategoryCustomerSuggestions({
  categoryId,
  categories,
  onSelectCustomers,
  selectedCustomerIds = [],
  excludedCustomerIds = [],
}: CategoryCustomerSuggestionsProps) {
  const { hasPermission } = usePermissions()
  const [recentCheckIns, setRecentCheckIns] = useState<CategoryRecentCheckIn[]>([])
  const [regulars, setRegulars] = useState<CategoryRegular[]>([])
  const [crossSuggestions, setCrossSuggestions] = useState<CrossCategorySuggestion[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [isLoadingRegulars, setIsLoadingRegulars] = useState(false)
  const [isLoadingCross, setIsLoadingCross] = useState(false)
  const [selectedTab, setSelectedTab] = useState<TabKey>('recent')
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set(selectedCustomerIds))

  const canViewSuggestions = hasPermission('customers', 'manage') || hasPermission('customers', 'view')

  useEffect(() => {
    const excludedSet = new Set(excludedCustomerIds)
    const normalizedSelected = selectedCustomerIds.filter((id) => !excludedSet.has(id))
    setLocalSelectedIds(new Set(normalizedSelected))
  }, [selectedCustomerIds, excludedCustomerIds])

  useEffect(() => {
    const excludedSet = new Set(excludedCustomerIds)
    if (excludedSet.size === 0) {
      return
    }

    setRecentCheckIns((prev) => prev.filter((entry) => !excludedSet.has(entry.customer_id)))
    setRegulars((prev) => prev.filter((entry) => !excludedSet.has(entry.customer_id)))
    setCrossSuggestions((prev) => prev.filter((entry) => !excludedSet.has(entry.customer_id)))
  }, [excludedCustomerIds])

  const loadRecentCheckIns = useCallback(async () => {
    if (!categoryId) return

    setIsLoadingRecent(true)
    try {
      const result = await getCategoryRecentCheckIns(categoryId, 90)
      if (result.data) {
        const excludedSet = new Set(excludedCustomerIds)
        setRecentCheckIns(result.data.filter((entry) => !excludedSet.has(entry.customer_id)))
      }
    } catch (error) {
      console.error('Error loading recent check-ins:', error)
    } finally {
      setIsLoadingRecent(false)
    }
  }, [categoryId, excludedCustomerIds])

  const loadRegulars = useCallback(async () => {
    if (!categoryId) return

    setIsLoadingRegulars(true)
    try {
      const result = await getCategoryRegulars(categoryId, 90)
      if (result.data) {
        const excludedSet = new Set(excludedCustomerIds)
        setRegulars(result.data.filter((entry) => !excludedSet.has(entry.customer_id)))
      }
    } catch (error) {
      console.error('Error loading regulars:', error)
    } finally {
      setIsLoadingRegulars(false)
    }
  }, [categoryId, excludedCustomerIds])

  const loadCrossSuggestions = useCallback(async () => {
    if (!categoryId) return

    setIsLoadingCross(true)
    try {
      const otherCategories = categories.filter((c) => c.id !== categoryId)
      const aggregated: CrossCategorySuggestion[] = []

      for (const otherCategory of otherCategories.slice(0, 3)) {
        const result = await getCrossCategorySuggestions(categoryId, otherCategory.id, 10)
        if (result.data) {
          aggregated.push(...result.data)
        }
      }

      const excludedSet = new Set(excludedCustomerIds)
      const uniqueSuggestions = Array.from(new Map(aggregated.map((s) => [s.customer_id, s])).values())
        .filter((s) => !excludedSet.has(s.customer_id))
        .sort((a, b) => b.source_times_attended - a.source_times_attended)

      setCrossSuggestions(uniqueSuggestions.slice(0, 20))
    } catch (error) {
      console.error('Error loading cross-category suggestions:', error)
    } finally {
      setIsLoadingCross(false)
    }
  }, [categoryId, categories, excludedCustomerIds])

  useEffect(() => {
    if (categoryId && canViewSuggestions) {
      loadRecentCheckIns()
      loadRegulars()
      loadCrossSuggestions()
    } else {
      setRecentCheckIns([])
      setRegulars([])
      setCrossSuggestions([])
    }
  }, [categoryId, canViewSuggestions, loadRecentCheckIns, loadRegulars, loadCrossSuggestions])

  const getCandidatesForTab = useCallback(
    (tab: TabKey) => {
      switch (tab) {
        case 'recent':
          return recentCheckIns.map((entry) => entry.customer_id)
        case 'regulars':
          return regulars.map((entry) => entry.customer_id)
        case 'cross':
          return crossSuggestions.map((entry) => entry.customer_id)
        default:
          return []
      }
    },
    [recentCheckIns, regulars, crossSuggestions],
  )

  const candidatesForActiveTab = useMemo(() => getCandidatesForTab(selectedTab), [getCandidatesForTab, selectedTab])

  const handleSelectAll = () => {
    const candidates = candidatesForActiveTab
    if (candidates.length === 0) return

    const excludedSet = new Set(excludedCustomerIds)
    const allowedCandidates = candidates.filter((id) => !excludedSet.has(id))
    const newSelection = new Set(localSelectedIds)
    const allSelected = allowedCandidates.every((id) => newSelection.has(id))

    if (allSelected) {
      allowedCandidates.forEach((id) => newSelection.delete(id))
      toast.success('Cleared selection for this list')
    } else {
      allowedCandidates.forEach((id) => newSelection.add(id))
      const label =
        selectedTab === 'recent'
          ? 'recent check-ins'
          : selectedTab === 'regulars'
            ? 'regulars'
            : 'suggestions'
      toast.success(`Selected all ${allowedCandidates.length} ${label}`)
    }

    setLocalSelectedIds(newSelection)
    onSelectCustomers(Array.from(newSelection), candidates)
  }

  const handleToggleCustomer = (customerId: string) => {
    const newSelection = new Set(localSelectedIds)
    if (newSelection.has(customerId)) {
      newSelection.delete(customerId)
    } else {
      newSelection.add(customerId)
    }
    setLocalSelectedIds(newSelection)
    onSelectCustomers(Array.from(newSelection), getCandidatesForTab(selectedTab))
  }

  if (!categoryId || !canViewSuggestions) {
    return null
  }

  const selectedCategory = categories.find((c) => c.id === categoryId)
  if (!selectedCategory) return null

  const tabs: TabMeta[] = [
    {
      key: 'recent',
      label: 'Recent Check-ins',
      icon: <ClockIcon className="h-4 w-4 mr-1" />,
      count: recentCheckIns.length,
    },
    {
      key: 'regulars',
      label: 'Regulars',
      count: regulars.length,
    },
    {
      key: 'cross',
      label: 'Might Enjoy',
      icon: <SparklesIcon className="h-4 w-4 mr-1" />,
      count: crossSuggestions.length,
    },
  ]

  const renderRecentTab = () => {
    if (isLoadingRecent) {
      return <div className="text-center py-4 text-gray-500">Loading recent check-ins...</div>
    }

    if (recentCheckIns.length === 0) {
      return (
        <div className="text-center py-4 text-gray-500">
          No customers have checked in for {selectedCategory.name} in the last 90 days.
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {recentCheckIns.map((entry) => (
          <label
            key={entry.customer_id}
            className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer"
          >
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-indigo-600 shadow-sm focus:ring-indigo-500"
                checked={localSelectedIds.has(entry.customer_id)}
                onChange={() => handleToggleCustomer(entry.customer_id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Select ${entry.first_name} ${entry.last_name || ''}`}
              />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {entry.first_name} {entry.last_name || ''}
                </p>
                {entry.mobile_number && (
                  <p className="text-xs text-gray-500">{entry.mobile_number}</p>
                )}
                <p className="text-xs text-gray-400">
                  Checked in {formatDistanceToNow(new Date(entry.last_check_in_time), { addSuffix: true })}
                  {entry.check_in_count > 1 && ` • ${entry.check_in_count} times`}
                </p>
              </div>
            </div>
            <CheckIcon className="h-4 w-4 text-indigo-500" aria-hidden="true" />
          </label>
        ))}
      </div>
    )
  }

  const renderRegularsTab = () => {
    if (isLoadingRegulars) {
      return <div className="text-center py-4 text-gray-500">Loading regulars...</div>
    }

    if (regulars.length === 0) {
      return (
        <div className="text-center py-4 text-gray-500">
          No customers have attended {selectedCategory.name} in the last 90 days.
        </div>
      )
    }

    return (
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
                onClick={(event) => event.stopPropagation()}
                aria-label={`Select ${regular.first_name} ${regular.last_name}`}
              />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900">
                  {regular.first_name} {regular.last_name}
                </p>
                <p className="text-xs text-gray-500">{regular.mobile_number}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{regular.times_attended}x</p>
              <p className="text-xs text-gray-500">{regular.days_since_last_visit}d ago</p>
            </div>
          </label>
        ))}
      </div>
    )
  }

  const renderCrossTab = () => {
    if (isLoadingCross) {
      return <div className="text-center py-4 text-gray-500">Finding suggestions...</div>
    }

    if (crossSuggestions.length === 0) {
      return <div className="text-center py-4 text-gray-500">No cross-category suggestions available.</div>
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500 mb-2">
          Customers who enjoy similar events but haven&apos;t tried {selectedCategory.name} recently.
        </p>
        {crossSuggestions.map((suggestion) => (
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
                onClick={(event) => event.stopPropagation()}
                aria-label={`Select ${suggestion.first_name} ${suggestion.last_name}`}
              />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900">
                  {suggestion.first_name} {suggestion.last_name}
                </p>
                <p className="text-xs text-gray-500">{suggestion.mobile_number}</p>
              </div>
            </div>
            <div className="text-right">
              {suggestion.already_attended_target && (
                <CheckIcon className="h-4 w-4 text-green-500 inline" />
              )}
              <p className="text-xs text-gray-500">Regular at other events</p>
            </div>
          </label>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-900 flex items-center">
          <UserGroupIcon className="h-5 w-5 mr-2 text-indigo-600" />
          Customer Suggestions for {selectedCategory.name}
        </h3>
        {candidatesForActiveTab.length > 0 && (
          <button
            onClick={handleSelectAll}
            className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            {selectedTab === 'recent'
              ? `Toggle Recent (${recentCheckIns.length})`
              : selectedTab === 'regulars'
                ? `Toggle Regulars (${regulars.length})`
                : `Toggle Suggestions (${crossSuggestions.length})`}
          </button>
        )}
      </div>

      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedTab(tab.key)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label} ({tab.count})
            </button>
          ))}
        </nav>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {selectedTab === 'recent' && renderRecentTab()}
        {selectedTab === 'regulars' && renderRegularsTab()}
        {selectedTab === 'cross' && renderCrossTab()}
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
