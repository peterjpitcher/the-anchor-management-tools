'use client'

import { useEffect, useState } from 'react'
import { getSpecialHours, createSpecialHours, updateSpecialHours, deleteSpecialHours } from '@/app/actions/business-hours'
import { SpecialHours } from '@/types/business-hours'
import { Button } from '@/components/ui/Button'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

export function SpecialHoursManager() {
  const [specialHours, setSpecialHours] = useState<SpecialHours[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    date: '',
    opens: '',
    closes: '',
    kitchen_opens: '',
    kitchen_closes: '',
    is_closed: false,
    note: ''
  })

  useEffect(() => {
    loadSpecialHours()
  }, [])

  const loadSpecialHours = async () => {
    const result = await getSpecialHours()
    if (result.data) {
      setSpecialHours(result.data)
    } else if (result.error) {
      toast.error(result.error)
    }
    setIsLoading(false)
  }

  const resetForm = () => {
    setFormData({
      date: '',
      opens: '',
      closes: '',
      kitchen_opens: '',
      kitchen_closes: '',
      is_closed: false,
      note: ''
    })
    setEditingId(null)
    setShowForm(false)
  }

  const handleEdit = (hours: SpecialHours) => {
    setFormData({
      date: hours.date,
      opens: hours.opens || '',
      closes: hours.closes || '',
      kitchen_opens: hours.kitchen_opens || '',
      kitchen_closes: hours.kitchen_closes || '',
      is_closed: hours.is_closed,
      note: hours.note || ''
    })
    setEditingId(hours.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete these special hours?')) {
      return
    }

    const result = await deleteSpecialHours(id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Special hours deleted successfully')
      loadSpecialHours()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const formDataToSend = new FormData()
    Object.entries(formData).forEach(([key, value]) => {
      formDataToSend.append(key, value.toString())
    })

    const result = editingId
      ? await updateSpecialHours(editingId, formDataToSend)
      : await createSpecialHours(formDataToSend)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(editingId ? 'Special hours updated successfully' : 'Special hours created successfully')
      resetForm()
      loadSpecialHours()
    }
  }

  if (isLoading) {
    return <div className="text-center py-4">Loading special hours...</div>
  }

  return (
    <div className="space-y-4">
      {!showForm && (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm(true)}>
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Special Hours
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50 p-4 rounded-lg space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Date
              </label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
            
            <div className="flex items-end">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_closed}
                  onChange={(e) => setFormData({ ...formData, is_closed: e.target.checked })}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">Closed all day</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Opens
              </label>
              <input
                type="time"
                value={formData.opens}
                onChange={(e) => setFormData({ ...formData, opens: e.target.value })}
                disabled={formData.is_closed}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Closes
              </label>
              <input
                type="time"
                value={formData.closes}
                onChange={(e) => setFormData({ ...formData, closes: e.target.value })}
                disabled={formData.is_closed}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Kitchen Opens
              </label>
              <input
                type="time"
                value={formData.kitchen_opens}
                onChange={(e) => setFormData({ ...formData, kitchen_opens: e.target.value })}
                disabled={formData.is_closed}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Kitchen Closes
              </label>
              <input
                type="time"
                value={formData.kitchen_closes}
                onChange={(e) => setFormData({ ...formData, kitchen_closes: e.target.value })}
                disabled={formData.is_closed}
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Note (Optional)
              </label>
              <input
                type="text"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                placeholder="e.g., Christmas Day, Bank Holiday"
                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
            <Button type="submit">
              {editingId ? 'Update' : 'Add'} Special Hours
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {specialHours.length === 0 ? (
          <p className="text-center py-8 text-gray-500">
            No special hours configured
          </p>
        ) : (
          specialHours.map((hours) => (
            <div
              key={hours.id}
              className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center space-x-4">
                  <p className="font-medium text-gray-900">
                    {new Date(hours.date + 'T00:00:00').toLocaleDateString('en-GB', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                  {hours.note && (
                    <span className="text-sm text-gray-500">({hours.note})</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {hours.is_closed ? (
                    <span className="text-red-600">Closed all day</span>
                  ) : (
                    <>
                      <span>Open: {hours.opens || 'Not set'} - {hours.closes || 'Not set'}</span>
                      {hours.kitchen_opens && hours.kitchen_closes && (
                        <span className="ml-4">
                          Kitchen: {hours.kitchen_opens} - {hours.kitchen_closes}
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleEdit(hours)}
                  className="p-2 text-gray-600 hover:text-gray-900"
                  title="Edit"
                >
                  <PencilIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleDelete(hours.id)}
                  className="p-2 text-red-600 hover:text-red-900"
                  title="Delete"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}