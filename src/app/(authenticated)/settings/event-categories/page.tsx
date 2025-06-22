'use client'

import { useEffect, useState } from 'react'
import { 
  getEventCategories, 
  deleteEventCategory,
  categorizeHistoricalEvents,
  rebuildCustomerCategoryStats 
} from '@/app/actions/event-categories'
import { EventCategory } from '@/types/event-categories'
import { PlusIcon, PencilIcon, TrashIcon, SparklesIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { EventCategoryForm } from '@/components/EventCategoryForm'

export default function EventCategoriesPage() {
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<EventCategory | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    try {
      setIsLoading(true)
      const result = await getEventCategories()
      
      if (result.error) {
        toast.error(result.error)
      } else if (result.data) {
        setCategories(result.data)
      }
    } catch (error) {
      console.error('Error loading categories:', error)
      toast.error('Failed to load event categories')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleDelete(category: EventCategory) {
    if (!confirm(`Are you sure you want to delete "${category.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      const result = await deleteEventCategory(category.id)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Category deleted successfully')
        await loadCategories()
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    }
  }

  async function handleAnalyzeHistory() {
    if (!confirm('This will analyze all historical events and categorize them based on their names. Continue?')) {
      return
    }

    setIsAnalyzing(true)
    try {
      // First categorize events
      const categorizeResult = await categorizeHistoricalEvents()
      
      if ('error' in categorizeResult && categorizeResult.error) {
        toast.error(categorizeResult.error)
        return
      }

      // Check if success and count exists
      if ('success' in categorizeResult && categorizeResult.success && 'count' in categorizeResult) {
        toast.success(`Categorized ${categorizeResult.count} historical events`)
      } else {
        console.error('Unexpected categorizeResult format:', categorizeResult)
        toast.error('Failed to categorize events - unexpected response format')
        return
      }

      // Then rebuild customer stats
      const statsResult = await rebuildCustomerCategoryStats()
      
      if ('error' in statsResult && statsResult.error) {
        toast.error(statsResult.error)
      } else if ('success' in statsResult && statsResult.success && 'count' in statsResult) {
        toast.success(`Built customer preferences for ${statsResult.count} category-customer combinations`)
      } else {
        console.error('Unexpected statsResult format:', statsResult)
        toast.error('Failed to rebuild stats - unexpected response format')
      }
    } catch (error) {
      console.error('Error analyzing history:', error)
      toast.error('Failed to analyze historical data')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleOpenForm = (category?: EventCategory) => {
    setEditingCategory(category || null)
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setEditingCategory(null)
    setShowForm(false)
    loadCategories()
  }

  // Function to render the icon dynamically
  const renderIcon = (iconName: string, color: string) => {
    const iconStyle = { color }
    
    // Map icon names to actual icon components
    switch (iconName) {
      case 'AcademicCapIcon':
        return <span style={iconStyle}>🎓</span>
      case 'BeakerIcon':
        return <span style={iconStyle}>🧪</span>
      case 'SquaresPlusIcon':
        return <span style={iconStyle}>🎯</span>
      case 'SparklesIcon':
        return <span style={iconStyle}>✨</span>
      case 'MusicalNoteIcon':
        return <span style={iconStyle}>🎵</span>
      case 'CakeIcon':
        return <span style={iconStyle}>🎂</span>
      case 'GlobeAltIcon':
        return <span style={iconStyle}>🌍</span>
      case 'HeartIcon':
        return <span style={iconStyle}>❤️</span>
      case 'StarIcon':
        return <span style={iconStyle}>⭐</span>
      case 'TrophyIcon':
        return <span style={iconStyle}>🏆</span>
      case 'FilmIcon':
        return <span style={iconStyle}>🎬</span>
      case 'MicrophoneIcon':
        return <span style={iconStyle}>🎤</span>
      default:
        return <span style={iconStyle}>📅</span>
    }
  }

  if (showForm) {
    return (
      <div className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-xl font-semibold mb-4">
              {editingCategory ? 'Edit Event Category' : 'Create Event Category'}
            </h2>
            <EventCategoryForm
              category={editingCategory}
              onSuccess={handleCloseForm}
              onCancel={handleCloseForm}
            />
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading categories...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Event Categories</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage event categories to organize your events and track customer preferences
              </p>
            </div>
            <div className="flex space-x-3">
              <Button
                onClick={handleAnalyzeHistory}
                disabled={isAnalyzing}
                variant="secondary"
              >
                <SparklesIcon className="-ml-1 mr-2 h-5 w-5" />
                {isAnalyzing ? 'Analyzing...' : 'Analyze History'}
              </Button>
              <Button onClick={() => handleOpenForm()}>
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                Add Category
              </Button>
            </div>
          </div>

          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Description
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Defaults
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Status
                  </th>
                  <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
                      <div className="flex items-center">
                        <div 
                          className="h-10 w-10 flex-shrink-0 rounded-full flex items-center justify-center text-xl"
                          style={{ backgroundColor: category.color + '20' }}
                        >
                          {renderIcon(category.icon, category.color)}
                        </div>
                        <div className="ml-4">
                          <div className="font-medium text-gray-900">{category.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <div className="max-w-xs truncate">
                        {category.description || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <div className="space-y-1">
                        {category.default_start_time && (
                          <div className="text-xs">
                            Start: {category.default_start_time}
                          </div>
                        )}
                        {category.default_capacity && (
                          <div className="text-xs">
                            Capacity: {category.default_capacity}
                          </div>
                        )}
                        <div className="text-xs">
                          Reminder: {category.default_reminder_hours}h before
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                        category.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {category.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                      <button
                        onClick={() => handleOpenForm(category)}
                        className="text-indigo-600 hover:text-indigo-900 mr-4"
                      >
                        <PencilIcon className="h-5 w-5" />
                        <span className="sr-only">Edit</span>
                      </button>
                      <button
                        onClick={() => handleDelete(category)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <TrashIcon className="h-5 w-5" />
                        <span className="sr-only">Delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {categories.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-500">
                  No categories found. Click &quot;Add Category&quot; to create your first one.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-900">About Historical Analysis</h3>
            <p className="mt-1 text-sm text-blue-700">
              The &quot;Analyze History&quot; button will scan all your past events and automatically categorize them based on their names. 
              It will also build customer preference profiles showing who regularly attends each type of event. 
              This is a one-time process that helps populate your initial data.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}