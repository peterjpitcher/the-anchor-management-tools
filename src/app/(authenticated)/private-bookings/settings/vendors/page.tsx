import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { 
  PlusIcon, 
  TrashIcon,
  ArrowLeftIcon,
  UserGroupIcon,
  PhoneIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  CheckIcon,
  StarIcon
} from '@heroicons/react/24/outline'
import { createVendor, updateVendor, deleteVendor } from '@/app/actions/privateBookingActions'
import { VendorDeleteButton } from '@/components/VendorDeleteButton'

async function handleCreateVendor(formData: FormData) {
  'use server'
  
  const result = await createVendor({
    name: formData.get('name') as string,
    vendor_type: formData.get('vendor_type') as string,
    contact_name: formData.get('contact_name') as string || null,
    phone: formData.get('phone') as string || null,
    email: formData.get('email') as string || null,
    website: formData.get('website') as string || null,
    typical_rate: formData.get('typical_rate') ? parseFloat(formData.get('typical_rate') as string) : null,
    notes: formData.get('notes') as string || null,
    is_preferred: formData.get('is_preferred') === 'true',
    is_active: formData.get('is_active') === 'true'
  })
  
  if (result.error) {
    console.error('Error creating vendor:', result.error)
  }
}

async function handleUpdateVendor(formData: FormData) {
  'use server'
  
  const vendorId = formData.get('vendorId') as string
  const result = await updateVendor(vendorId, {
    name: formData.get('name') as string,
    vendor_type: formData.get('vendor_type') as string,
    contact_name: formData.get('contact_name') as string || null,
    phone: formData.get('phone') as string || null,
    email: formData.get('email') as string || null,
    website: formData.get('website') as string || null,
    typical_rate: formData.get('typical_rate') ? parseFloat(formData.get('typical_rate') as string) : null,
    notes: formData.get('notes') as string || null,
    is_preferred: formData.get('is_preferred') === 'true',
    is_active: formData.get('is_active') === 'true'
  })
  
  if (result.error) {
    console.error('Error updating vendor:', result.error)
  }
}

async function handleDeleteVendor(formData: FormData) {
  'use server'
  
  const vendorId = formData.get('vendorId') as string
  const result = await deleteVendor(vendorId)
  
  if (result.error) {
    console.error('Error deleting vendor:', result.error)
  }
}

export default async function VendorsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'manage_vendors'
  })

  if (!hasPermission) {
    redirect('/unauthorized')
  }

  // Fetch vendors
  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('*')
    .order('service_type', { ascending: true })
    .order('preferred', { ascending: false })
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching vendors:', error)
  }

  // Group vendors by type
  const vendorsByType = vendors?.reduce((acc, vendor) => {
    const type = vendor.service_type
    if (!acc[type]) acc[type] = []
    acc[type].push(vendor)
    return acc
  }, {} as Record<string, typeof vendors>) || {}

  const vendorTypes = [
    'dj',
    'band',
    'photographer',
    'florist',
    'decorator',
    'entertainment',
    'transport',
    'equipment',
    'other'
  ]

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
                <h1 className="text-3xl font-bold text-gray-900">Vendor Database</h1>
                <p className="text-gray-600 mt-1">Manage preferred vendors and service providers</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Add New Vendor Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <PlusIcon className="h-5 w-5 text-blue-600" />
            Add New Vendor
          </h2>
          <form action={handleCreateVendor} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., DJ Mike's Entertainment"
                />
              </div>
              <div>
                <label htmlFor="vendor_type" className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  id="vendor_type"
                  name="vendor_type"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select type...</option>
                  <option value="dj">DJ</option>
                  <option value="band">Band</option>
                  <option value="photographer">Photographer</option>
                  <option value="florist">Florist</option>
                  <option value="decorator">Decorator</option>
                  <option value="entertainment">Entertainment</option>
                  <option value="transport">Transport</option>
                  <option value="equipment">Equipment Rental</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="contact_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Name
                </label>
                <input
                  type="text"
                  id="contact_name"
                  name="contact_name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Mike Johnson"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="07700 900000"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="mike@djmike.com"
                />
              </div>
              <div>
                <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
                  Website
                </label>
                <input
                  type="url"
                  id="website"
                  name="website"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="https://www.djmike.com"
                />
              </div>
              <div>
                <label htmlFor="typical_rate" className="block text-sm font-medium text-gray-700 mb-1">
                  Typical Rate (£)
                </label>
                <input
                  type="number"
                  id="typical_rate"
                  name="typical_rate"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="250.00"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="is_preferred" className="block text-sm font-medium text-gray-700 mb-1">
                  Preferred Status
                </label>
                <select
                  id="is_preferred"
                  name="is_preferred"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="false">Regular Vendor</option>
                  <option value="true">Preferred Vendor</option>
                </select>
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
            </div>
            
            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Additional notes about this vendor..."
              />
            </div>
            
            <button
              type="submit"
              className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Vendor
            </button>
          </form>
        </div>

        {/* Existing Vendors */}
        {Object.keys(vendorsByType || {}).length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-500">No vendors configured yet.</p>
            <p className="text-sm text-gray-400 mt-1">Add your first vendor using the form above.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {vendorTypes.filter(type => vendorsByType[type]).map((type) => (
              <div key={type} className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50">
                  <h3 className="text-lg font-semibold text-gray-900 capitalize">
                    {type === 'dj' ? 'DJs' : type.replace('_', ' ')}
                  </h3>
                </div>
                
                <div className="divide-y divide-gray-200">
                  {vendorsByType[type]?.map((vendor: any) => (
                    <div key={vendor.id} className="p-6">
                      <form action={handleUpdateVendor} className="space-y-4">
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        
                        <div className="flex items-center gap-3 mb-4">
                          <h4 className="text-lg font-medium text-gray-900">{vendor.name}</h4>
                          {vendor.preferred && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <StarIcon className="h-3 w-3 mr-1" />
                              Preferred
                            </span>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            vendor.active 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {vendor.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Vendor Name
                            </label>
                            <input
                              type="text"
                              name="name"
                              defaultValue={vendor.name}
                              required
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Type
                            </label>
                            <select
                              name="vendor_type"
                              defaultValue={vendor.service_type}
                              required
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="dj">DJ</option>
                              <option value="band">Band</option>
                              <option value="photographer">Photographer</option>
                              <option value="florist">Florist</option>
                              <option value="decorator">Decorator</option>
                              <option value="entertainment">Entertainment</option>
                              <option value="transport">Transport</option>
                              <option value="equipment">Equipment Rental</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Contact Name
                            </label>
                            <input
                              type="text"
                              name="contact_name"
                              defaultValue={vendor.contact_name || ''}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <PhoneIcon className="h-4 w-4 inline mr-1" />
                              Phone
                            </label>
                            <input
                              type="tel"
                              name="phone"
                              defaultValue={vendor.contact_phone || ''}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <EnvelopeIcon className="h-4 w-4 inline mr-1" />
                              Email
                            </label>
                            <input
                              type="email"
                              name="email"
                              defaultValue={vendor.email || ''}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              <GlobeAltIcon className="h-4 w-4 inline mr-1" />
                              Website
                            </label>
                            <input
                              type="url"
                              name="website"
                              defaultValue={vendor.website || ''}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Typical Rate (£)
                            </label>
                            <input
                              type="number"
                              name="typical_rate"
                              defaultValue={vendor.typical_rate || ''}
                              min="0"
                              step="0.01"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Preferred Status
                            </label>
                            <select
                              name="is_preferred"
                              defaultValue={vendor.preferred ? 'true' : 'false'}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="false">Regular Vendor</option>
                              <option value="true">Preferred Vendor</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Status
                            </label>
                            <select
                              name="is_active"
                              defaultValue={vendor.active ? 'true' : 'false'}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="true">Active</option>
                              <option value="false">Inactive</option>
                            </select>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Notes
                          </label>
                          <textarea
                            name="notes"
                            defaultValue={vendor.notes || ''}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        
                        <button
                          type="submit"
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1"
                        >
                          <CheckIcon className="h-4 w-4" />
                          Update Vendor
                        </button>
                      </form>
                      
                      <div className="mt-4 flex justify-end">
                        <VendorDeleteButton 
                          vendorName={vendor.name}
                          vendorId={vendor.id}
                          deleteAction={handleDeleteVendor}
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