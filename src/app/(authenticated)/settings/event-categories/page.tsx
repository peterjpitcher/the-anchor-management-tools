'use client'

import { useEffect, useState } from 'react'
import { 
  getEventCategories, 
  createEventCategoryFromFormData,
  updateEventCategoryFromFormData,
  deleteEventCategory,
  categorizeHistoricalEvents,
  rebuildCustomerCategoryStats 
} from '@/app/actions/event-categories'
import { EventCategory } from '@/types/event-categories'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { EventCategoryFormGrouped } from '@/components/EventCategoryFormGrouped'
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
// import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { DataTable } from '@/components/ui-v2/display/DataTable'
// import { useRouter } from 'next/navigation';
export default function EventCategoriesPage() {
const [categories, setCategories] = useState<EventCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<EventCategory | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<EventCategory | null>(null)
  const [analyzeConfirm, setAnalyzeConfirm] = useState(false)

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    try {
      setIsLoading(true)
      const result = await getEventCategories().catch(error => {
        console.error('getEventCategories failed:', error)
        return undefined
      })
      
      if (!result) {
        toast.error('Failed to load event categories')
        return
      }

      if ('error' in result && result.error) {
        toast.error(result.error)
      } else if ('data' in result && result.data) {
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
    try {
      const result = await deleteEventCategory(category.id)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Category deleted successfully')
        await loadCategories()
      }
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    }
  }

  async function handleAnalyzeHistory() {
    setAnalyzeConfirm(false)

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

  const layoutProps = {
    title: 'Event Categories',
    subtitle: 'Manage event categories to organize your events and track customer preferences',
    backButton: { label: 'Back to Settings', href: '/settings' },
  }

  if (showForm) {
    const formTitle = editingCategory ? 'Edit Event Category' : 'Create Event Category'

    return (
      <PageLayout
        title={formTitle}
        backButton={{ label: 'Back to Categories', onBack: handleCloseForm }}
      >
        <Card>
          <EventCategoryFormGrouped
            category={editingCategory}
            onSubmit={async (data) => {
              try {
                const formData = new FormData()
                Object.entries(data).forEach(([key, value]) => {
                  if (value !== null && value !== undefined) {
                    if (typeof value === 'object') {
                      formData.append(key, JSON.stringify(value))
                    } else {
                      formData.append(key, value.toString())
                    }
                  }
                })
                
                if (editingCategory) {
                  const result = await updateEventCategoryFromFormData(editingCategory.id, formData)
                  if (result?.error) {
                    toast.error(result.error)
                    return
                  }
                  toast.success('Category updated successfully')
                } else {
                  const result = await createEventCategoryFromFormData(formData)
                  if (result?.error) {
                    toast.error(result.error)
                    return
                  }
                  toast.success('Category created successfully')
                }
                handleCloseForm()
              } catch (error) {
                toast.error('Failed to save category')
              }
            }}
            onCancel={handleCloseForm}
          />
        </Card>
      </PageLayout>
    )
  }

  if (isLoading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Loading categories...">
        {null}
      </PageLayout>
    )
  }

  // Define columns for DataTable
  const columns = [
    {
      key: 'name',
      header: 'Category',
      sortable: true,
      cell: (category: EventCategory) => (
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
      ),
    },
    {
      key: 'description',
      header: 'Description',
      cell: (category: EventCategory) => (
        <div className="max-w-xs truncate">
          {category.description || '-'}
        </div>
      ),
    },
    {
      key: 'defaults',
      header: 'Defaults',
      cell: (category: EventCategory) => (
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
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      cell: (category: EventCategory) => (
        <Badge variant={category.is_active ? 'success' : 'default'}>
          {category.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (category: EventCategory) => (
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleOpenForm(category)}
            className="text-blue-600 hover:text-blue-900"
          >
            <PencilIcon className="h-5 w-5" />
            <span className="sr-only">Edit</span>
          </button>
          <button
            onClick={() => setDeleteConfirm(category)}
            className="text-red-600 hover:text-red-900"
          >
            <TrashIcon className="h-5 w-5" />
            <span className="sr-only">Delete</span>
          </button>
        </div>
      ),
    },
  ]

  const headerActions = (
    <NavGroup>
      <NavLink
        onClick={() => setAnalyzeConfirm(true)}
        className={isAnalyzing ? 'cursor-not-allowed opacity-50' : ''}
      >
        {isAnalyzing ? 'Analyzing...' : 'Analyze History'}
      </NavLink>
      <NavLink onClick={() => handleOpenForm()}>
        Add Category
      </NavLink>
    </NavGroup>
  )

  return (
    <PageLayout
      {...layoutProps}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        <ConfirmDialog
          open={!!deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
          title="Delete Category"
          message={`Are you sure you want to delete "${deleteConfirm?.name}"? This action cannot be undone.`}
          confirmText="Delete"
          type="danger"
        />

        <ConfirmDialog
          open={analyzeConfirm}
          onClose={() => setAnalyzeConfirm(false)}
          onConfirm={handleAnalyzeHistory}
          title="Analyze Historical Data"
          message="This will analyze all historical events and categorize them based on their names. Continue?"
          confirmText="Analyze"
          type="info"
        />

        <Card>
          {categories.length === 0 ? (
            <EmptyState
              title="No categories found"
              description="Click 'Add Category' to create your first one."
              action={
                <Button onClick={() => handleOpenForm()}>
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                  Add Category
                </Button>
              }
            />
          ) : (
            <DataTable
              data={categories}
              getRowKey={(category) => category.id}
              columns={columns}
            />
          )}
        </Card>

        <Alert
          variant="info"
          title="About Historical Analysis"
          description="The 'Analyze History' button will scan all your past events and automatically categorize them based on their names. It will also build customer preference profiles showing who regularly attends each type of event. This is a one-time process that helps populate your initial data."
        />
      </div>
    </PageLayout>
  )
}
