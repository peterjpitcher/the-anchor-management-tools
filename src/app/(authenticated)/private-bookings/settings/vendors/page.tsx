import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { 
  PlusIcon, 
  UserGroupIcon,
  PhoneIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  CheckIcon,
  StarIcon
} from '@heroicons/react/24/outline'
import { createVendor, updateVendor, deleteVendor } from '@/app/actions/privateBookingActions'
import { VendorDeleteButton } from '@/components/VendorDeleteButton'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'

async function handleCreateVendor(formData: FormData) {
  'use server'
  
  const result = await createVendor({
    name: formData.get('name') as string,
    vendor_type: formData.get('service_type') as string,
    contact_name: formData.get('contact_name') as string || null,
    phone: formData.get('contact_phone') as string || null,
    email: formData.get('contact_email') as string || null,
    website: formData.get('website') as string || null,
    typical_rate: formData.get('typical_rate') ? parseFloat(formData.get('typical_rate') as string) : null,
    notes: formData.get('notes') as string || null,
    is_preferred: formData.get('preferred') === 'true',
    is_active: formData.get('active') === 'true'
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
    vendor_type: formData.get('service_type') as string,
    contact_name: formData.get('contact_name') as string || null,
    phone: formData.get('contact_phone') as string || null,
    email: formData.get('contact_email') as string || null,
    website: formData.get('website') as string || null,
    typical_rate: formData.get('typical_rate') ? parseFloat(formData.get('typical_rate') as string) : null,
    notes: formData.get('notes') as string || null,
    is_preferred: formData.get('preferred') === 'true',
    is_active: formData.get('active') === 'true'
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

  const vendorTypeOptions = [
    { value: '', label: 'Select type...' },
    { value: 'dj', label: 'DJ' },
    { value: 'band', label: 'Band' },
    { value: 'photographer', label: 'Photographer' },
    { value: 'florist', label: 'Florist' },
    { value: 'decorator', label: 'Decorator' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'transport', label: 'Transport' },
    { value: 'equipment', label: 'Equipment Rental' },
    { value: 'other', label: 'Other' }
  ]

  const preferredOptions = [
    { value: 'false', label: 'Regular Vendor' },
    { value: 'true', label: 'Preferred Vendor' }
  ]

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' }
  ]

  return (
    <Page
      title="Vendor Database"
      description="Manage preferred vendors and service providers"
      actions={
        <LinkButton href="/private-bookings" variant="secondary">Back</LinkButton>
      }
    >

      {/* Add New Vendor Form */}
      <Card>
        <Section 
          title="Add New Vendor"
          icon={<PlusIcon className="h-5 w-5 text-blue-600" />}
        >
          <form action={handleCreateVendor} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormGroup label="Vendor Name" required>
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="e.g., DJ Mike's Entertainment"
                />
              </FormGroup>
              <FormGroup label="Type" required>
                <Select
                  id="service_type"
                  name="service_type"
                  required
                  options={vendorTypeOptions}
                />
              </FormGroup>
              <FormGroup label="Contact Name">
                <Input
                  type="text"
                  id="contact_name"
                  name="contact_name"
                  placeholder="Mike Johnson"
                />
              </FormGroup>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormGroup label="Phone">
                <Input
                  type="tel"
                  id="contact_phone"
                  name="contact_phone"
                  placeholder="07700 900000"
                />
              </FormGroup>
              <FormGroup label="Email">
                <Input
                  type="email"
                  id="contact_email"
                  name="contact_email"
                  placeholder="mike@djmike.com"
                />
              </FormGroup>
              <FormGroup label="Website">
                <Input
                  type="url"
                  id="website"
                  name="website"
                  placeholder="https://www.djmike.com"
                />
              </FormGroup>
              <FormGroup label="Typical Rate (£)">
                <Input
                  type="number"
                  id="typical_rate"
                  name="typical_rate"
                  min="0"
                  step="0.01"
                  placeholder="250.00"
                />
              </FormGroup>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup label="Preferred Status">
                <Select
                  id="preferred"
                  name="preferred"
                  options={preferredOptions}
                />
              </FormGroup>
              <FormGroup label="Status">
                <Select
                  id="active"
                  name="active"
                  options={statusOptions}
                />
              </FormGroup>
            </div>
            
            <FormGroup label="Notes">
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Additional notes about this vendor..."
              />
            </FormGroup>
            
            <Button type="submit">
              Add Vendor
            </Button>
          </form>
        </Section>
      </Card>

      {/* Existing Vendors */}
      {Object.keys(vendorsByType || {}).length === 0 ? (
        <Card>
          <EmptyState icon={<UserGroupIcon className="h-12 w-12" />}
            title="No vendors configured yet"
            description="Add your first vendor using the form above."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {vendorTypes.filter(type => vendorsByType[type]).map((type) => (
            <Card key={type}>
              <Section 
                title={type === 'dj' ? 'DJs' : type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
              >
                
                <div className="divide-y divide-gray-200">
                  {vendorsByType[type]?.map((vendor: any) => (
                    <div key={vendor.id} className="py-6 first:pt-0 last:pb-0">
                      <form action={handleUpdateVendor} className="space-y-4">
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        
                        <div className="flex items-center gap-3 mb-4">
                          <h4 className="text-lg font-medium text-gray-900">{vendor.name}</h4>
                          {vendor.preferred && (
                            <Badge variant="warning">
                              <StarIcon className="h-3 w-3 mr-1" />
                              Preferred
                            </Badge>
                          )}
                          <Badge variant={vendor.active ? 'success' : 'secondary'}>
                            {vendor.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <FormGroup label="Vendor Name">
                            <Input
                              type="text"
                              name="name"
                              defaultValue={vendor.name}
                              required
                            />
                          </FormGroup>
                          <FormGroup label="Type">
                            <Select
                              name="service_type"
                              defaultValue={vendor.service_type}
                              required
                              options={vendorTypeOptions.filter(opt => opt.value !== '')}
                            />
                          </FormGroup>
                          <FormGroup label="Contact Name">
                            <Input
                              type="text"
                              name="contact_name"
                              defaultValue={vendor.contact_name || ''}
                            />
                          </FormGroup>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          <FormGroup 
                            label="Phone"
                          >
                            <Input
                              type="tel"
                              name="contact_phone"
                              defaultValue={vendor.contact_phone || ''}
                            />
                          </FormGroup>
                          <FormGroup 
                            label="Email"
                          >
                            <Input
                              type="email"
                              name="contact_email"
                              defaultValue={vendor.contact_email || ''}
                            />
                          </FormGroup>
                          <FormGroup 
                            label="Website"
                          >
                            <Input
                              type="url"
                              name="website"
                              defaultValue={vendor.website || ''}
                            />
                          </FormGroup>
                          <FormGroup label="Typical Rate (£)">
                            <Input
                              type="number"
                              name="typical_rate"
                              defaultValue={vendor.typical_rate || ''}
                              min="0"
                              step="0.01"
                            />
                          </FormGroup>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormGroup label="Preferred Status">
                            <Select
                              name="preferred"
                              defaultValue={vendor.preferred ? 'true' : 'false'}
                              options={preferredOptions}
                            />
                          </FormGroup>
                          <FormGroup label="Status">
                            <Select
                              name="active"
                              defaultValue={vendor.active ? 'true' : 'false'}
                              options={statusOptions}
                            />
                          </FormGroup>
                        </div>
                        
                        <FormGroup label="Notes">
                          <Textarea
                            name="notes"
                            defaultValue={vendor.notes || ''}
                            rows={2}
                          />
                        </FormGroup>
                        
                        <Button type="submit"
                          variant="primary"
                          size="sm"
                          leftIcon={<CheckIcon className="h-4 w-4" />}
                        >
                          Update Vendor
                        </Button>
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
              </Section>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}