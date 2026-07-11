import { redirect } from 'next/navigation'
import type { VenueSpace } from '@/types/private-bookings'

import { 
  PlusIcon, 
  MapPinIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { createVenueSpace, updateVenueSpace, deleteVenueSpace, getVenueSpacesForManagement } from '@/app/actions/privateBookingActions'
import { VenueSpaceDeleteButton } from '@/components/features/private-bookings/VenueSpaceDeleteButton'
import { formatDateFull } from '@/lib/dateUtils'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { Button } from '@/ds'
import { Input } from '@/ds'
import { Select } from '@/ds'
import { Textarea } from '@/ds'
import { FormGroup } from '@/ds'
import { Checkbox } from '@/ds'
import { Badge } from '@/ds'
import { EmptyState } from '@/ds'
import { Alert } from '@/ds'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'

// Stored hire rates are net; vat_rate is applied on top at display/invoicing time.
function parseVatRate(value: FormDataEntryValue | null): number {
  const parsed = parseFloat(value as string)
  return Number.isNaN(parsed) ? 20 : parsed
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null || (value as string).trim() === '') return undefined
  const parsed = parseFloat(value as string)
  return Number.isNaN(parsed) ? undefined : parsed
}

async function handleCreateSpace(formData: FormData) {
  'use server'

  const result = await createVenueSpace({
    name: formData.get('name') as string,
    capacity: parseInt(formData.get('capacity_seated') as string, 10),
    capacity_standing: parseInt(formData.get('capacity_standing') as string, 10),
    hire_cost: parseFloat(formData.get('rate_per_hour') as string),
    description: formData.get('description') as string || null,
    vat_rate: parseVatRate(formData.get('vat_rate')),
    blocks_all_spaces: formData.get('blocks_all_spaces') === 'on',
    minimum_hours: parseOptionalNumber(formData.get('minimum_hours')),
    setup_fee: parseOptionalNumber(formData.get('setup_fee')),
    display_order: parseOptionalNumber(formData.get('display_order')),
    is_active: formData.get('active') === 'true'
  })

  if (result.error) {
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/spaces?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/spaces')
}

async function handleUpdateSpace(formData: FormData) {
  'use server'

  const spaceId = formData.get('spaceId') as string
  const result = await updateVenueSpace(spaceId, {
    name: formData.get('name') as string,
    capacity: parseInt(formData.get('capacity_seated') as string, 10),
    capacity_standing: parseInt(formData.get('capacity_standing') as string, 10),
    hire_cost: parseFloat(formData.get('rate_per_hour') as string),
    description: formData.get('description') as string || null,
    vat_rate: parseVatRate(formData.get('vat_rate')),
    blocks_all_spaces: formData.get('blocks_all_spaces') === 'on',
    minimum_hours: parseOptionalNumber(formData.get('minimum_hours')),
    setup_fee: parseOptionalNumber(formData.get('setup_fee')),
    display_order: parseOptionalNumber(formData.get('display_order')),
    is_active: formData.get('active') === 'true'
  })

  if (result.error) {
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/spaces?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/spaces')
}

async function handleDeleteSpace(formData: FormData) {
  'use server'
  
  const spaceId = formData.get('spaceId') as string
  const result = await deleteVenueSpace(spaceId)
  
  if (result.error) {
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/spaces?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/spaces')
}

export default async function VenueSpacesPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canManageSpaces = actions.has('manage_spaces') || actions.has('manage')

  if (!canManageSpaces) {
    redirect('/unauthorized')
  }

  const spacesResult = await getVenueSpacesForManagement()

  if ('error' in spacesResult) {
    const navItems = [
      { label: 'General', href: '/private-bookings/settings' },
      { label: 'Catering', href: '/private-bookings/settings/catering' },
      { label: 'Vendors', href: '/private-bookings/settings/vendors' },
      { label: 'Spaces', href: '/private-bookings/settings/spaces' },
    ];

    return (
      <PageLayout
        title="Venue Spaces"
        subtitle="Manage available spaces for private hire"
        backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
        navItems={navItems}
        error={spacesResult.error}
      />
    )
  }

  const spaces = (spacesResult.data ?? []) as VenueSpace[]

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' }
  ]

  const navItems = [
    { label: 'General', href: '/private-bookings/settings' },
    { label: 'Catering', href: '/private-bookings/settings/catering' },
    { label: 'Vendors', href: '/private-bookings/settings/vendors' },
    { label: 'Spaces', href: '/private-bookings/settings/spaces' },
  ];

  return (
    <PageLayout
      title="Venue Spaces"
      subtitle="Manage available spaces for private hire"
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
      navItems={navItems}
    >
      <div className="space-y-6">
        {errorMessage && (
          <Alert variant="error" title="Error" description={errorMessage} />
        )}
        {/* Add New Space Form */}
        <Card>
        <Section 
          title="Add New Space"
          icon={<PlusIcon className="h-5 w-5 text-blue-600" />}
        >
          <form action={handleCreateSpace} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
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
              <FormGroup label="Standing Capacity" required>
                <Input
                  type="number"
                  id="capacity_standing"
                  name="capacity_standing"
                  required
                  min="1"
                  placeholder="80"
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormGroup label="VAT Rate (%)" help="Stored rates are net; VAT is applied on top">
                <Input
                  type="number"
                  id="vat_rate"
                  name="vat_rate"
                  min="0"
                  step="0.01"
                  defaultValue={20}
                  placeholder="20"
                />
              </FormGroup>
              <FormGroup label="Minimum Hours">
                <Input
                  type="number"
                  id="minimum_hours"
                  name="minimum_hours"
                  min="0"
                  step="0.5"
                  defaultValue={1}
                  placeholder="1"
                />
              </FormGroup>
              <FormGroup label="Setup Fee (£)">
                <Input
                  type="number"
                  id="setup_fee"
                  name="setup_fee"
                  min="0"
                  step="0.01"
                  defaultValue={0}
                  placeholder="0.00"
                />
              </FormGroup>
              <FormGroup label="Display Order">
                <Input
                  type="number"
                  id="display_order"
                  name="display_order"
                  min="0"
                  defaultValue={0}
                  placeholder="0"
                />
              </FormGroup>
            </div>
            <Checkbox
              name="blocks_all_spaces"
              label="Whole-venue space (blocks all other spaces)"
              description="Tick for Entire Pub / exclusive hire — booking this space blocks every other space for the event."
            />
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
            <div className="space-y-4 md:space-y-0 md:divide-y md:divide-gray-200">
              {spaces?.map((space) => (
                <div
                  key={space.id}
                  className="rounded-xl border border-gray-200 p-4 md:rounded-none md:border-0 md:p-0 md:py-6 md:first:pt-0 md:last:pb-0"
                >
                  {/* Mobile-only summary header so each space reads as a distinct card */}
                  <div className="md:hidden mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-medium text-gray-900">{space.name}</h4>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Seated {space.capacity_seated} · Standing {space.capacity_standing ?? space.capacity_seated} · £{space.rate_per_hour}/hr
                      </p>
                    </div>
                    <Badge variant={space.active ? 'success' : 'secondary'}>
                      {space.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <form action={handleUpdateSpace} className="space-y-4">
                    <input type="hidden" name="spaceId" value={space.id} />
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
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
                      <FormGroup label="Standing Capacity">
                        <Input
                          type="number"
                          name="capacity_standing"
                          defaultValue={space.capacity_standing ?? space.capacity_seated ?? ''}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <FormGroup label="VAT Rate (%)" help="Stored rates are net; VAT is applied on top">
                        <Input
                          type="number"
                          name="vat_rate"
                          defaultValue={space.vat_rate ?? 20}
                          min="0"
                          step="0.01"
                        />
                      </FormGroup>
                      <FormGroup label="Minimum Hours">
                        <Input
                          type="number"
                          name="minimum_hours"
                          defaultValue={space.minimum_hours ?? 1}
                          min="0"
                          step="0.5"
                        />
                      </FormGroup>
                      <FormGroup label="Setup Fee (£)">
                        <Input
                          type="number"
                          name="setup_fee"
                          defaultValue={space.setup_fee ?? 0}
                          min="0"
                          step="0.01"
                        />
                      </FormGroup>
                      <FormGroup label="Display Order">
                        <Input
                          type="number"
                          name="display_order"
                          defaultValue={space.display_order ?? 0}
                          min="0"
                        />
                      </FormGroup>
                    </div>

                    <Checkbox
                      name="blocks_all_spaces"
                      label="Whole-venue space (blocks all other spaces)"
                      description="Tick for Entire Pub / exclusive hire — booking this space blocks every other space for the event."
                      defaultChecked={space.blocks_all_spaces ?? false}
                    />

                    <FormGroup label="Description">
                      <Textarea
                        name="description"
                        defaultValue={space.description || ''}
                        rows={2}
                      />
                    </FormGroup>
                  </form>
                  
                  <div className="mt-4 flex flex-wrap justify-between items-center gap-2">
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
      </div>
    </PageLayout>
  )
}
