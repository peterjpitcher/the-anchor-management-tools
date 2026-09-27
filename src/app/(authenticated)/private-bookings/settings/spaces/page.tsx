import { redirect } from 'next/navigation'
import type { VenueSpace } from '@/types/private-bookings'

import { createVenueSpace, updateVenueSpace, deleteVenueSpace, getVenueSpacesForManagement } from '@/app/actions/privateBookingActions'
import { VenueSpaceDeleteButton } from '@/components/features/private-bookings/VenueSpaceDeleteButton'
import { formatDateFull } from '@/lib/dateUtils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  PageLayout,
  Select,
  SubHeading,
  Textarea,
} from '@/ds'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { PB_BACK_TO_LIST, PB_SETTINGS_TITLE, privateBookingSettingsNav } from '../../_shared/nav'
import { settingsActiveLabel, settingsActiveTone } from '../../_shared/status-ui'

const WHOLE_VENUE_HINT =
  'Tick for Entire Pub / exclusive hire: booking this space blocks every other space for the event.'

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

  const layoutProps = {
    title: PB_SETTINGS_TITLE,
    subtitle: 'Spaces: venue spaces available for private hire',
    backButton: PB_BACK_TO_LIST,
    navItems: privateBookingSettingsNav(actions),
  }

  const spacesResult = await getVenueSpacesForManagement()

  if ('error' in spacesResult) {
    return <PageLayout {...layoutProps} error={spacesResult.error} />
  }

  const spaces = (spacesResult.data ?? []) as VenueSpace[]

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' }
  ]

  return (
    <PageLayout {...layoutProps}>
      {errorMessage && (
        <Alert tone="danger" title="Error">{errorMessage}</Alert>
      )}

      {/* New space form */}
      <Card>
        <CardHeader title="New Space" />
        <CardBody>
          <form action={handleCreateSpace} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <Field label="Space Name" required className="lg:col-span-2">
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="e.g., Main Dining Room"
                />
              </Field>
              <Field label="Seated Capacity" required>
                <Input
                  type="number"
                  id="capacity_seated"
                  name="capacity_seated"
                  required
                  min="1"
                  placeholder="50"
                />
              </Field>
              <Field label="Standing Capacity" required>
                <Input
                  type="number"
                  id="capacity_standing"
                  name="capacity_standing"
                  required
                  min="1"
                  placeholder="80"
                />
              </Field>
              <Field label="Hourly Rate (£)" required>
                <Input
                  type="number"
                  id="rate_per_hour"
                  name="rate_per_hour"
                  required
                  min="0"
                  step="0.01"
                  placeholder="50.00"
                />
              </Field>
              <Field label="Status">
                <Select
                  id="active"
                  name="active"
                  options={statusOptions}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="VAT Rate (%)" hint="Stored rates are net; VAT is applied on top">
                <Input
                  type="number"
                  id="vat_rate"
                  name="vat_rate"
                  min="0"
                  step="0.01"
                  defaultValue={20}
                  placeholder="20"
                />
              </Field>
              <Field label="Minimum Hours">
                <Input
                  type="number"
                  id="minimum_hours"
                  name="minimum_hours"
                  min="0"
                  step="0.5"
                  defaultValue={1}
                  placeholder="1"
                />
              </Field>
              <Field label="Setup Fee (£)">
                <Input
                  type="number"
                  id="setup_fee"
                  name="setup_fee"
                  min="0"
                  step="0.01"
                  defaultValue={0}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Display Order">
                <Input
                  type="number"
                  id="display_order"
                  name="display_order"
                  min="0"
                  defaultValue={0}
                  placeholder="0"
                />
              </Field>
            </div>
            <Checkbox
              name="blocks_all_spaces"
              label="Whole-venue space (blocks all other spaces)"
              description={WHOLE_VENUE_HINT}
            />
            <Field label="Description (Optional)">
              <Textarea
                id="description"
                name="description"
                rows={2}
                placeholder="Additional details about this space..."
              />
            </Field>
            <FormFooter>
              <Button type="submit" variant="primary">
                Create Space
              </Button>
            </FormFooter>
          </form>
        </CardBody>
      </Card>

      {/* Existing Spaces */}
      <Card>
        <CardHeader
          title="Existing Spaces"
          subtitle={`${spaces?.length || 0} space${spaces?.length !== 1 ? 's' : ''}`}
        />
        {spaces?.length === 0 ? (
          <Empty
            size="sm"
            icon={<Icon name="mapPin" size={48} />}
            title="No spaces yet"
            description="Create your first space with the form above."
          />
        ) : (
          <div className="divide-y divide-border">
            {spaces?.map((space) => {
              const formId = `space-form-${space.id}`
              return (
                <div key={space.id} className="space-y-4 p-pad-card">
                  {/* Phone-only summary so each space reads as a distinct block */}
                  <div className="md:hidden flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <SubHeading className="truncate">{space.name}</SubHeading>
                      <p className="mt-0.5 text-xs text-text-muted">
                        Seated {space.capacity_seated} · Standing {space.capacity_standing ?? space.capacity_seated} · £{space.rate_per_hour}/hr
                      </p>
                    </div>
                    <Badge tone={settingsActiveTone(space.active)}>
                      {settingsActiveLabel(space.active)}
                    </Badge>
                  </div>
                  <form id={formId} action={handleUpdateSpace} className="space-y-4">
                    <input type="hidden" name="spaceId" value={space.id} />

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                      <Field label="Space Name" className="lg:col-span-2">
                        <Input
                          type="text"
                          name="name"
                          defaultValue={space.name}
                          required
                        />
                      </Field>
                      <Field label="Seated Capacity">
                        <Input
                          type="number"
                          name="capacity_seated"
                          defaultValue={space.capacity_seated}
                          required
                          min="1"
                        />
                      </Field>
                      <Field label="Standing Capacity">
                        <Input
                          type="number"
                          name="capacity_standing"
                          defaultValue={space.capacity_standing ?? space.capacity_seated ?? ''}
                          required
                          min="1"
                        />
                      </Field>
                      <Field label="Hourly Rate">
                        <Input
                          type="number"
                          name="rate_per_hour"
                          defaultValue={space.rate_per_hour}
                          required
                          min="0"
                          step="0.01"
                        />
                      </Field>
                      <Field label="Status">
                        <Select
                          name="active"
                          defaultValue={space.active ? 'true' : 'false'}
                          options={statusOptions}
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <Field label="VAT Rate (%)" hint="Stored rates are net; VAT is applied on top">
                        <Input
                          type="number"
                          name="vat_rate"
                          defaultValue={space.vat_rate ?? 20}
                          min="0"
                          step="0.01"
                        />
                      </Field>
                      <Field label="Minimum Hours">
                        <Input
                          type="number"
                          name="minimum_hours"
                          defaultValue={space.minimum_hours ?? 1}
                          min="0"
                          step="0.5"
                        />
                      </Field>
                      <Field label="Setup Fee (£)">
                        <Input
                          type="number"
                          name="setup_fee"
                          defaultValue={space.setup_fee ?? 0}
                          min="0"
                          step="0.01"
                        />
                      </Field>
                      <Field label="Display Order">
                        <Input
                          type="number"
                          name="display_order"
                          defaultValue={space.display_order ?? 0}
                          min="0"
                        />
                      </Field>
                    </div>

                    <Checkbox
                      name="blocks_all_spaces"
                      label="Whole-venue space (blocks all other spaces)"
                      description={WHOLE_VENUE_HINT}
                      defaultChecked={space.blocks_all_spaces ?? false}
                    />

                    <Field label="Description">
                      <Textarea
                        name="description"
                        defaultValue={space.description || ''}
                        rows={2}
                      />
                    </Field>
                  </form>

                  {/* The delete button submits its own form, so this footer sits outside the edit
                      form and Save Changes reaches that form through the form attribute. */}
                  <FormFooter
                    start={
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={settingsActiveTone(space.active)}
                          icon={<Icon name={space.active ? 'check' : 'x'} size={12} />}
                        >
                          {settingsActiveLabel(space.active)}
                        </Badge>
                        <span>Created {formatDateFull(space.created_at)}</span>
                      </span>
                    }
                  >
                    <VenueSpaceDeleteButton
                      spaceName={space.name}
                      spaceId={space.id}
                      deleteAction={handleDeleteSpace}
                    />
                    <Button
                      type="submit"
                      form={formId}
                      variant="primary"
                      icon={<Icon name="check" size={16} />}
                    >
                      Save Changes
                    </Button>
                  </FormFooter>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </PageLayout>
  )
}
