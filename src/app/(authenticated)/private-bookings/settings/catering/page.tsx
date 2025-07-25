import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { CateringPackage } from '@/types/private-bookings'
import { 
  PlusIcon, 
  SparklesIcon,
  CurrencyPoundIcon,
  CheckIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'
import { createCateringPackage, updateCateringPackage, deleteCateringPackage } from '@/app/actions/privateBookingActions'
import { CateringPackageDeleteButton } from '@/components/CateringPackageDeleteButton'
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

async function handleCreatePackage(formData: FormData) {
  'use server'
  
  const result = await createCateringPackage({
    name: formData.get('name') as string,
    package_type: formData.get('package_type') as string,
    per_head_cost: parseFloat(formData.get('cost_per_head') as string),
    pricing_model: formData.get('pricing_model') as 'per_head' | 'total_value',
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
    pricing_model: formData.get('pricing_model') as 'per_head' | 'total_value',
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

  const packageTypeOptions = [
    { value: 'buffet', label: 'Buffet' },
    { value: 'sit-down', label: 'Sit Down Meal' },
    { value: 'canapes', label: 'Canapés' },
    { value: 'drinks', label: 'Drinks Package' },
    { value: 'pizza', label: 'Pizza' },
    { value: 'other', label: 'Other' }
  ]

  const pricingModelOptions = [
    { value: 'per_head', label: 'Per Person' },
    { value: 'total_value', label: 'Total Value' }
  ]

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' }
  ]

  return (
    <Page
      title="Catering Packages"
      description="Manage food and drink options for private events"
      actions={
        <div className="flex items-center space-x-3">
          <LinkButton href="/private-bookings/settings" variant="secondary">Back to Settings</LinkButton>
          <LinkButton href="/private-bookings" variant="secondary">Back</LinkButton>
        </div>
      }
    >
      {/* Add New Package Form */}
      <Card>
        <Section 
          title="Add New Package"
          icon={<PlusIcon className="h-5 w-5 text-blue-600" />}
        >
          <form action={handleCreatePackage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormGroup label="Package Name" required className="lg:col-span-2">
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="e.g., Classic Buffet"
                />
              </FormGroup>
              <FormGroup label="Type" required>
                <Select
                  id="package_type"
                  name="package_type"
                  required
                  options={packageTypeOptions}
                />
              </FormGroup>
              <FormGroup label="Price (£)" required>
                <Input
                  type="number"
                  id="cost_per_head"
                  name="cost_per_head"
                  required
                  min="0"
                  step="0.01"
                  placeholder="25.00"
                />
              </FormGroup>
              <FormGroup label="Pricing Model" required>
                <Select
                  id="pricing_model"
                  name="pricing_model"
                  required
                  options={pricingModelOptions}
                />
              </FormGroup>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormGroup label="Minimum Guests">
                <Input
                  type="number"
                  id="minimum_guests"
                  name="minimum_guests"
                  min="0"
                  placeholder="20"
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
            
            <FormGroup label="Description">
              <Textarea
                id="description"
                name="description"
                rows={2}
                placeholder="Brief description of the package..."
              />
            </FormGroup>
            
            <FormGroup label="Dietary Information & Notes">
              <Textarea
                id="dietary_notes"
                name="dietary_notes"
                rows={4}
                placeholder="Vegetarian options available&#10;Can accommodate gluten-free&#10;Contains nuts&#10;Halal options on request"
              />
            </FormGroup>
            
            <Button type="submit">
              Add Package
            </Button>
          </form>
        </Section>
      </Card>

      {/* Existing Packages */}
      {Object.keys(packagesByType || {}).length === 0 ? (
        <Card>
          <EmptyState icon={<SparklesIcon className="h-12 w-12" />}
            title="No catering packages configured yet"
            description="Add your first package using the form above."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {(Object.entries(packagesByType || {}) as [string, any[]][]).map(([type, typePackages]) => (
            <Card key={type}>
              <Section 
                title={`${type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')} Packages`}
              >
                <div className="divide-y divide-gray-200">
                  {typePackages?.map((pkg) => (
                    <div key={pkg.id} className="py-6 first:pt-0 last:pb-0">
                      <form action={handleUpdatePackage} className="space-y-4">
                        <input type="hidden" name="packageId" value={pkg.id} />
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                          <FormGroup label="Package Name" className="lg:col-span-2">
                            <Input
                              type="text"
                              name="name"
                              defaultValue={pkg.name}
                              required
                            />
                          </FormGroup>
                          <FormGroup label="Type">
                            <Select
                              name="package_type"
                              defaultValue={pkg.package_type}
                              required
                              options={packageTypeOptions}
                            />
                          </FormGroup>
                          <FormGroup 
                            label={pkg.pricing_model === 'total_value' ? 'Total Price' : 'Per Head'}
                          >
                            <Input
                              type="number"
                              name="cost_per_head"
                              defaultValue={pkg.cost_per_head}
                              required
                              min="0"
                              step="0.01"
                            />
                          </FormGroup>
                          <FormGroup 
                            label="Min Order"
                          >
                            <Input
                              type="number"
                              name="minimum_guests"
                              defaultValue={pkg.minimum_guests || ''}
                              min="0"
                            />
                          </FormGroup>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormGroup label="Pricing Model">
                            <Select
                              name="pricing_model"
                              defaultValue={pkg.pricing_model || 'per_head'}
                              required
                              options={pricingModelOptions}
                            />
                          </FormGroup>
                          <FormGroup label="Status">
                            <Select
                              name="active"
                              defaultValue={pkg.active ? 'true' : 'false'}
                              options={statusOptions}
                            />
                          </FormGroup>
                        </div>
                        
                        <FormGroup label="Description">
                          <Textarea
                            name="description"
                            defaultValue={pkg.description || ''}
                            rows={2}
                          />
                        </FormGroup>
                        
                        <FormGroup label="Dietary Information & Notes">
                          <Textarea
                            name="dietary_notes"
                            defaultValue={pkg.dietary_notes || ''}
                            rows={4}
                          />
                        </FormGroup>
                        
                        <div className="flex items-center gap-2">
                          <Button type="submit"
                            variant="primary"
                            size="sm"
                            leftIcon={<CheckIcon className="h-4 w-4" />}
                          >
                            Update
                          </Button>
                          <Badge
                            variant={pkg.active ? 'success' : 'secondary'}
                          >
                            {pkg.active ? 'Active' : 'Inactive'}
                          </Badge>
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
              </Section>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}