import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { 
  PlusIcon, 
  MapPinIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { createVenueSpace, updateVenueSpace, deleteVenueSpace } from '@/app/actions/privateBookingActions'
import { VenueSpaceDeleteButton } from '@/components/VenueSpaceDeleteButton'
import { formatDateFull } from '@/lib/dateUtils'
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

async function handleCreateSpace(formData: FormData) {
  'use server'
  
  const result = await createVenueSpace({
    name: formData.get('name') as string,
    capacity: parseInt(formData.get('capacity_seated') as string),
    hire_cost: parseFloat(formData.get('rate_per_hour') as string),
    description: formData.get('description') as string || null,
    is_active: formData.get('active') === 'true'
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
    capacity: parseInt(formData.get('capacity_seated') as string),
    hire_cost: parseFloat(formData.get('rate_per_hour') as string),
    description: formData.get('description') as string || null,
    is_active: formData.get('active') === 'true'
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
    p_action: 'manage_spaces'
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

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' }
  ]

  return (
    <Page
      title="Venue Spaces"
      description="Manage available spaces for private hire"
      actions={
        <div className="flex items-center space-x-3">
          <LinkButton href="/private-bookings/settings" variant="secondary">Back to Settings</LinkButton>
          <LinkButton href="/private-bookings" variant="secondary">Back</LinkButton>
        </div>
      }
    >
      {/* Add New Space Form */}
      <Card>
        <Section 
          title="Add New Space"
          icon={<PlusIcon className="h-5 w-5 text-blue-600" />}
        >
          <form action={handleCreateSpace} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <FormGroup label="Space Name" required className="lg:col-span-2">
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="e.g., Main Dining Room"
                />
              </FormGroup>
              <FormGroup label="Seated Capacity" required>
                <Input
                  type="number"
                  id="capacity_seated"
                  name="capacity_seated"
                  required
                  min="1"
                  placeholder="50"
                />
              </FormGroup>
              <FormGroup label="Hourly Rate (£)" required>
                <Input
                  type="number"
                  id="rate_per_hour"
                  name="rate_per_hour"
                  required
                  min="0"
                  step="0.01"
                  placeholder="50.00"
                />
              </FormGroup>
              <FormGroup label="Status">
                <Select
                  id="active"
                  name="active"
                  options={statusOptions}
                />
              </FormGroup>
              <div className="flex items-end">
                <Button type="submit" className="w-full">
                  Add Space
                </Button>
              </div>
            </div>
            <FormGroup label="Description (Optional)">
              <Textarea
                id="description"
                name="description"
                rows={2}
                placeholder="Additional details about this space..."
              />
            </FormGroup>
          </form>
        </Section>
      </Card>

      {/* Existing Spaces */}
      <Card>
        <Section 
          title="Existing Spaces"
          icon={<MapPinIcon className="h-5 w-5 text-gray-600" />}
          description={`${spaces?.length || 0} space${spaces?.length !== 1 ? 's' : ''}`}
        >
          {spaces?.length === 0 ? (
            <EmptyState icon={<MapPinIcon className="h-12 w-12" />}
              title="No venue spaces configured yet"
              description="Add your first space using the form above."
            />
          ) : (
            <div className="divide-y divide-gray-200">
              {spaces?.map((space) => (
                <div key={space.id} className="py-6 first:pt-0 last:pb-0">
                  <form action={handleUpdateSpace} className="space-y-4">
                    <input type="hidden" name="spaceId" value={space.id} />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                      <FormGroup label="Space Name" className="lg:col-span-2">
                        <Input
                          type="text"
                          name="name"
                          defaultValue={space.name}
                          required
                        />
                      </FormGroup>
                      <FormGroup 
                        label="Seated Capacity"
                      >
                        <Input
                          type="number"
                          name="capacity_seated"
                          defaultValue={space.capacity_seated}
                          required
                          min="1"
                        />
                      </FormGroup>
                      <FormGroup 
                        label="Hourly Rate"
                      >
                        <Input
                          type="number"
                          name="rate_per_hour"
                          defaultValue={space.rate_per_hour}
                          required
                          min="0"
                          step="0.01"
                        />
                      </FormGroup>
                      <FormGroup label="Status">
                        <Select
                          name="active"
                          defaultValue={space.active ? 'true' : 'false'}
                          options={statusOptions}
                        />
                      </FormGroup>
                      <div className="flex items-end">
                        <Button type="submit"
                          variant="primary"
                          size="sm"
                          leftIcon={<CheckIcon className="h-4 w-4" />}
                          className="w-full"
                        >
                          Update
                        </Button>
                      </div>
                    </div>
                    
                    <FormGroup label="Description">
                      <Textarea
                        name="description"
                        defaultValue={space.description || ''}
                        rows={2}
                      />
                    </FormGroup>
                  </form>
                  
                  <div className="mt-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={space.active ? 'success' : 'secondary'}
                      >
                        {space.active ? (
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
                      </Badge>
                      <span className="text-sm text-gray-500">
                        Created {formatDateFull(space.created_at)}
                      </span>
                    </div>
                    
                    <VenueSpaceDeleteButton 
                      spaceName={space.name}
                      spaceId={space.id}
                      deleteAction={handleDeleteSpace}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </Card>
    </Page>
  )
}
