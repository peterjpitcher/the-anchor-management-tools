import { redirect } from 'next/navigation'
import { createVendor, updateVendor, deleteVendor, getVendorsForManagement } from '@/app/actions/privateBookingActions'
import { VendorDeleteButton } from '@/components/features/invoices/VendorDeleteButton'
import type { Vendor, VendorServiceType } from '@/types/private-bookings'
import { VENDOR_SERVICE_TYPE_LABELS } from '@/lib/private-bookings/item-labels'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { PREFERRED_VENDOR_TONE, settingsActiveLabel, settingsActiveTone } from '../../_shared/status-ui'

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
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/vendors?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/vendors')
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
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/vendors?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/vendors')
}

async function handleDeleteVendor(formData: FormData) {
  'use server'
  
  const vendorId = formData.get('vendorId') as string
  const result = await deleteVendor(vendorId)
  
  if (result.error) {
    if (result.error === 'Insufficient permissions' || result.error === 'Not authenticated') {
      redirect('/unauthorized')
    }
    redirect(`/private-bookings/settings/vendors?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/private-bookings/settings/vendors')
}

export default async function VendorsPage({
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
  const canManageVendors = actions.has('manage_vendors') || actions.has('manage')

  if (!canManageVendors) {
    redirect('/unauthorized')
  }

  const layoutProps = {
    title: PB_SETTINGS_TITLE,
    subtitle: 'Preferred vendors and service providers',
    backButton: PB_BACK_TO_LIST,
    navItems: privateBookingSettingsNav(actions),
  }

  const vendorsResult = await getVendorsForManagement()
  if ('error' in vendorsResult) {
    return <PageLayout {...layoutProps} error={vendorsResult.error} />
  }

  const vendors = vendorsResult.data ?? []

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  const vendorsByType = vendors.reduce((acc: Record<string, Vendor[]>, vendor: Vendor) => {
    const type = vendor.service_type
    if (!acc[type]) acc[type] = []
    acc[type].push(vendor)
    return acc
  }, {} as Record<string, Vendor[]>)

  const vendorTypes = [
    'dj',
    'band',
    'photographer',
    'florist',
    'decorator',
    'cake',
    'entertainment',
    'transport',
    'equipment',
    'other'
  ]

  // Built from the shared map so the contract and this screen never name the
  // same supplier type differently.
  const vendorTypeOptions = [
    { value: '', label: 'Select type...' },
    ...(Object.entries(VENDOR_SERVICE_TYPE_LABELS) as [VendorServiceType, string][]).map(
      ([value, label]) => ({ value, label })
    )
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
    <PageLayout {...layoutProps}>
      {errorMessage && (
        <Alert tone="danger" title="Error">{errorMessage}</Alert>
      )}

      {/* Add New Vendor Form */}
      <Card>
        <CardHeader title="Add New Vendor" />
        <CardBody>
          <form action={handleCreateVendor} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Vendor Name" required>
                <Input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="e.g., DJ Mike's Entertainment"
                />
              </Field>
              <Field label="Type" required>
                <Select
                  id="service_type"
                  name="service_type"
                  required
                  options={vendorTypeOptions}
                />
              </Field>
              <Field label="Contact Name">
                <Input
                  type="text"
                  id="contact_name"
                  name="contact_name"
                  placeholder="Mike Johnson"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Phone">
                <Input
                  type="tel"
                  id="contact_phone"
                  name="contact_phone"
                  placeholder="07700 900000"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  id="contact_email"
                  name="contact_email"
                  placeholder="mike@djmike.com"
                />
              </Field>
              <Field label="Website">
                <Input
                  type="url"
                  id="website"
                  name="website"
                  placeholder="https://www.djmike.com"
                />
              </Field>
              <Field label="Typical Rate (£)">
                <Input
                  type="number"
                  id="typical_rate"
                  name="typical_rate"
                  min="0"
                  step="0.01"
                  placeholder="250.00"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Preferred Status">
                <Select
                  id="preferred"
                  name="preferred"
                  options={preferredOptions}
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

            <Field label="Notes">
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Additional notes about this vendor..."
              />
            </Field>

            <FormFooter>
              <Button type="submit" variant="primary">
                Add Vendor
              </Button>
            </FormFooter>
          </form>
        </CardBody>
      </Card>

      {/* Existing Vendors */}
      {Object.keys(vendorsByType || {}).length === 0 ? (
        <Card>
          <Empty
            size="sm"
            icon={<Icon name="users" size={48} />}
            title="No vendors configured yet"
            description="Add your first vendor using the form above."
          />
        </Card>
      ) : (
        vendorTypes.filter(type => vendorsByType[type]).map((type) => (
          <Card key={type}>
            <CardHeader
              title={type === 'dj' ? 'DJs' : type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
            />
            <div className="divide-y divide-border">
              {vendorsByType[type]?.map((vendor: any) => {
                const formId = `vendor-form-${vendor.id}`
                return (
                  <div key={vendor.id} className="space-y-4 p-pad-card">
                    <div className="flex flex-wrap items-center gap-2">
                      <SubHeading>{vendor.name}</SubHeading>
                      {vendor.preferred && (
                        <Badge tone={PREFERRED_VENDOR_TONE} icon={<Icon name="star" size={12} />}>
                          Preferred
                        </Badge>
                      )}
                      <Badge tone={settingsActiveTone(vendor.active)}>
                        {settingsActiveLabel(vendor.active)}
                      </Badge>
                    </div>

                    <form id={formId} action={handleUpdateVendor} className="space-y-4">
                      <input type="hidden" name="vendorId" value={vendor.id} />

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Field label="Vendor Name">
                          <Input
                            type="text"
                            name="name"
                            defaultValue={vendor.name}
                            required
                          />
                        </Field>
                        <Field label="Type">
                          <Select
                            name="service_type"
                            defaultValue={vendor.service_type}
                            required
                            options={vendorTypeOptions.filter(opt => opt.value !== '')}
                          />
                        </Field>
                        <Field label="Contact Name">
                          <Input
                            type="text"
                            name="contact_name"
                            defaultValue={vendor.contact_name || ''}
                          />
                        </Field>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Field label="Phone">
                          <Input
                            type="tel"
                            name="contact_phone"
                            defaultValue={vendor.contact_phone || ''}
                          />
                        </Field>
                        <Field label="Email">
                          <Input
                            type="email"
                            name="contact_email"
                            defaultValue={vendor.contact_email || ''}
                          />
                        </Field>
                        <Field label="Website">
                          <Input
                            type="url"
                            name="website"
                            defaultValue={vendor.website || ''}
                          />
                        </Field>
                        <Field label="Typical Rate (£)">
                          <Input
                            type="number"
                            name="typical_rate"
                            defaultValue={vendor.typical_rate || ''}
                            min="0"
                            step="0.01"
                          />
                        </Field>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Preferred Status">
                          <Select
                            name="preferred"
                            defaultValue={vendor.preferred ? 'true' : 'false'}
                            options={preferredOptions}
                          />
                        </Field>
                        <Field label="Status">
                          <Select
                            name="active"
                            defaultValue={vendor.active ? 'true' : 'false'}
                            options={statusOptions}
                          />
                        </Field>
                      </div>

                      <Field label="Notes">
                        <Textarea
                          name="notes"
                          defaultValue={vendor.notes || ''}
                          rows={2}
                        />
                      </Field>
                    </form>

                    {/* The delete button submits its own form, so this footer sits outside the edit
                        form and Update reaches that form through the form attribute. */}
                    <FormFooter>
                      <VendorDeleteButton
                        vendorName={vendor.name}
                        vendorId={vendor.id}
                        deleteAction={handleDeleteVendor}
                      />
                      <Button
                        type="submit"
                        form={formId}
                        variant="primary"
                        icon={<Icon name="check" size={16} />}
                      >
                        Update Vendor
                      </Button>
                    </FormFooter>
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}
    </PageLayout>
  )
}
