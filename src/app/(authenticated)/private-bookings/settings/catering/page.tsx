import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { CateringPackage } from '@/types/private-bookings'
import { 
  PlusIcon, 
  ArrowLeftIcon,
  SparklesIcon,
  CurrencyPoundIcon,
  CheckIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'
import { createCateringPackage, updateCateringPackage, deleteCateringPackage } from '@/app/actions/privateBookingActions'
import { CateringPackageDeleteButton } from '@/components/CateringPackageDeleteButton'

async function handleCreatePackage(formData: FormData) {
  'use server'
  
  const result = await createCateringPackage({
    name: formData.get('name') as string,
    package_type: formData.get('package_type') as string,
    per_head_cost: parseFloat(formData.get('cost_per_head') as string),
    minimum_order: parseInt(formData.get('minimum_guests') as string) || null,
    description: formData.get('description') as string || null,
    includes: formData.get('dietary_notes') as string || null,
    is_active: formData.get('active') === 'true'
  })
  
  if (result.error) {
    console.error('Error creating package:', result.error)
  }
}

async function handleUpdatePackage(formData: FormData) {
  'use server'
  
  const packageId = formData.get('packageId') as string
  const result = await updateCateringPackage(packageId, {
    name: formData.get('name') as string,
    package_type: formData.get('package_type') as string,
    per_head_cost: parseFloat(formData.get('cost_per_head') as string),
    minimum_order: parseInt(formData.get('minimum_guests') as string) || null,
    description: formData.get('description') as string || null,
    includes: formData.get('dietary_notes') as string || null,
    is_active: formData.get('active') === 'true'
  })
  
  if (result.error) {
    console.error('Error updating package:', result.error)
  }
}

async function handleDeletePackage(formData: FormData) {
  'use server'
  
  const packageId = formData.get('packageId') as string
  const result = await deleteCateringPackage(packageId)
  
  if (result.error) {
    console.error('Error deleting package:', result.error)
  }
}

export default async function CateringPackagesPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'manage_catering'
  })

  if (!hasPermission) {
    redirect('/unauthorized')
  }

  // Fetch catering packages
  const { data: packages, error } = await supabase
    .from('catering_packages')
    .select('*')
    .order('package_type', { ascending: true })
    .order('cost_per_head', { ascending: true })

  if (error) {
    console.error('Error fetching catering packages:', error)
  }

  // Group packages by type
  const packagesByType = packages?.reduce((acc, pkg) => {
    const type = pkg.package_type
    if (!acc[type]) acc[type] = []
    acc[type].push(pkg)
    return acc
  }, {} as Record<string, CateringPackage[]>) || {}

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
                <h1 className="text-3xl font-bold text-gray-900">Catering Packages</h1>
                <p className="text-gray-600 mt-1">Manage food and drink options for private events</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Add New Package Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <PlusIcon className="h-5 w-5 text-blue-600" />
            Add New Package
          </h2>
          <form action={handleCreatePackage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Package Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Classic Buffet"
                />
              </div>
              <div>
                <label htmlFor="package_type" className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  id="package_type"
                  name="package_type"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="buffet">Buffet</option>
                  <option value="sit-down">Sit Down Meal</option>
                  <option value="canapes">Canapés</option>
                  <option value="drinks">Drinks Package</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="cost_per_head" className="block text-sm font-medium text-gray-700 mb-1">
                  Per Head Cost (£)
                </label>
                <input
                  type="number"
                  id="cost_per_head"
                  name="cost_per_head"
                  required
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="25.00"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="minimum_guests" className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Guests
                </label>
                <input
                  type="number"
                  id="minimum_guests"
                  name="minimum_guests"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="20"
                />
              </div>
              <div>
                <label htmlFor="active" className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  id="active"
                  name="active"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Brief description of the package..."
              />
            </div>
            
            <div>
              <label htmlFor="dietary_notes" className="block text-sm font-medium text-gray-700 mb-1">
                Dietary Information &amp; Notes
              </label>
              <textarea
                id="dietary_notes"
                name="dietary_notes"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Vegetarian options available&#10;Can accommodate gluten-free&#10;Contains nuts&#10;Halal options on request"
              />
            </div>
            
            <button
              type="submit"
              className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Package
            </button>
          </form>
        </div>

        {/* Existing Packages */}
        {Object.keys(packagesByType || {}).length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <SparklesIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-500">No catering packages configured yet.</p>
            <p className="text-sm text-gray-400 mt-1">Add your first package using the form above.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {(Object.entries(packagesByType || {}) as [string, any[]][]).map(([type, typePackages]) => (
              <div key={type} className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
                  <h3 className="text-lg font-semibold text-gray-900 capitalize">
                    {type.replace('_', ' ')} Packages
                  </h3>
                </div>
                
                <div className="divide-y divide-gray-200">
                  {typePackages?.map((pkg) => (
                    <div key={pkg.id} className="p-6">
                      <form action={handleUpdatePackage} className="space-y-4">
                        <input type="hidden" name="packageId" value={pkg.id} />
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                          <div className="lg:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Package Name
                            </label>
                            <input
                              type="text"
                              name="name"
                              defaultValue={pkg.name}
                              required
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Type
                            </label>
                            <select
                              name="package_type"
                              defaultValue={pkg.package_type}
                              required
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="buffet">Buffet</option>
                              <option value="sit-down">Sit Down Meal</option>
                              <option value="canapes">Canapés</option>
                              <option value="drinks">Drinks Package</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <CurrencyPoundIcon className="h-4 w-4 inline mr-1" />
                              Per Head
                            </label>
                            <input
                              type="number"
                              name="cost_per_head"
                              defaultValue={pkg.cost_per_head}
                              required
                              min="0"
                              step="0.01"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <UserGroupIcon className="h-4 w-4 inline mr-1" />
                              Min Order
                            </label>
                            <input
                              type="number"
                              name="minimum_guests"
                              defaultValue={pkg.minimum_guests || ''}
                              min="0"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Status
                            </label>
                            <select
                              name="active"
                              defaultValue={pkg.active ? 'true' : 'false'}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="true">Active</option>
                              <option value="false">Inactive</option>
                            </select>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description
                          </label>
                          <textarea
                            name="description"
                            defaultValue={pkg.description || ''}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Dietary Information &amp; Notes
                          </label>
                          <textarea
                            name="dietary_notes"
                            defaultValue={pkg.dietary_notes || ''}
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1"
                          >
                            <CheckIcon className="h-4 w-4" />
                            Update
                          </button>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            pkg.active 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {pkg.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </form>
                      
                      <div className="mt-4 flex justify-end">
                        <CateringPackageDeleteButton 
                          packageName={pkg.name}
                          packageId={pkg.id}
                          deleteAction={handleDeletePackage}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}