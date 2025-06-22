import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { 
  PlusIcon, 
  TrashIcon,
  ArrowLeftIcon,
  MapPinIcon,
  UserGroupIcon,
  CurrencyPoundIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { createVenueSpace, updateVenueSpace, deleteVenueSpace } from '@/app/actions/privateBookingActions'

async function handleCreateSpace(formData: FormData) {
  'use server'
  
  const result = await createVenueSpace({
    name: formData.get('name') as string,
    capacity: parseInt(formData.get('capacity') as string),
    hire_cost: parseFloat(formData.get('hire_cost') as string),
    description: formData.get('description') as string || null,
    is_active: formData.get('is_active') === 'true'
  })
  
  if (result.error) {
    console.error('Error creating space:', result.error)
  }
}

async function handleUpdateSpace(formData: FormData) {
  'use server'
  
  const spaceId = formData.get('spaceId') as string
  const result = await updateVenueSpace(spaceId, {
    name: formData.get('name') as string,
    capacity: parseInt(formData.get('capacity') as string),
    hire_cost: parseFloat(formData.get('hire_cost') as string),
    description: formData.get('description') as string || null,
    is_active: formData.get('is_active') === 'true'
  })
  
  if (result.error) {
    console.error('Error updating space:', result.error)
  }
}

async function handleDeleteSpace(formData: FormData) {
  'use server'
  
  const spaceId = formData.get('spaceId') as string
  const result = await deleteVenueSpace(spaceId)
  
  if (result.error) {
    console.error('Error deleting space:', result.error)
  }
}

export default async function VenueSpacesPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'manage'
  })

  if (!hasPermission) {
    redirect('/unauthorized')
  }

  // Fetch venue spaces
  const { data: spaces, error } = await supabase
    .from('venue_spaces')
    .select('*')
    .order('name')

  if (error) {
    console.error('Error fetching venue spaces:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/private-bookings"
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Venue Spaces</h1>
                <p className="text-gray-600 mt-1">Manage available spaces for private hire</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Add New Space Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <PlusIcon className="h-5 w-5 text-blue-600" />
            Add New Space
          </h2>
          <form action={handleCreateSpace} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Space Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Main Dining Room"
              />
            </div>
            <div>
              <label htmlFor="capacity" className="block text-sm font-medium text-gray-700 mb-1">
                Capacity
              </label>
              <input
                type="number"
                id="capacity"
                name="capacity"
                required
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="50"
              />
            </div>
            <div>
              <label htmlFor="hire_cost" className="block text-sm font-medium text-gray-700 mb-1">
                Hire Cost (£)
              </label>
              <input
                type="number"
                id="hire_cost"
                name="hire_cost"
                required
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="250.00"
              />
            </div>
            <div>
              <label htmlFor="is_active" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                id="is_active"
                name="is_active"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add Space
              </button>
            </div>
            <div className="lg:col-span-6">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description (Optional)
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Additional details about this space..."
              />
            </div>
          </form>
        </div>

        {/* Existing Spaces */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <MapPinIcon className="h-5 w-5 text-gray-600" />
              Existing Spaces ({spaces?.length || 0})
            </h2>
          </div>
          
          {spaces?.length === 0 ? (
            <div className="p-12 text-center">
              <MapPinIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-500">No venue spaces configured yet.</p>
              <p className="text-sm text-gray-400 mt-1">Add your first space using the form above.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {spaces?.map((space) => (
                <div key={space.id} className="p-6">
                  <form action={handleUpdateSpace} className="space-y-4">
                    <input type="hidden" name="spaceId" value={space.id} />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Space Name
                        </label>
                        <input
                          type="text"
                          name="name"
                          defaultValue={space.name}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <UserGroupIcon className="h-4 w-4 inline mr-1" />
                          Capacity
                        </label>
                        <input
                          type="number"
                          name="capacity"
                          defaultValue={space.capacity}
                          required
                          min="1"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <CurrencyPoundIcon className="h-4 w-4 inline mr-1" />
                          Hire Cost
                        </label>
                        <input
                          type="number"
                          name="hire_cost"
                          defaultValue={space.hire_cost}
                          required
                          min="0"
                          step="0.01"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Status
                        </label>
                        <select
                          name="is_active"
                          defaultValue={space.is_active ? 'true' : 'false'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          type="submit"
                          className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1"
                        >
                          <CheckIcon className="h-4 w-4" />
                          Update
                        </button>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        name="description"
                        defaultValue={space.description || ''}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </form>
                  
                  <div className="mt-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        space.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {space.is_active ? (
                          <>
                            <CheckIcon className="h-3 w-3 mr-1" />
                            Active
                          </>
                        ) : (
                          <>
                            <XMarkIcon className="h-3 w-3 mr-1" />
                            Inactive
                          </>
                        )}
                      </span>
                      <span className="text-sm text-gray-500">
                        Created {new Date(space.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <form action={handleDeleteSpace} className="inline">
                      <input type="hidden" name="spaceId" value={space.id} />
                      <button
                        type="submit"
                        className="text-red-600 hover:text-red-700 transition-colors"
                        onClick={(e) => {
                          if (!confirm(`Are you sure you want to delete "${space.name}"? This action cannot be undone.`)) {
                            e.preventDefault()
                          }
                        }}
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}