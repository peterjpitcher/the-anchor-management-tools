'use client'

import { useState } from 'react'
import type { Role, UserSummaryWithRoles } from '@/types/rbac'
import type { SiteSettings } from '@/app/actions/site-settings'
import { updateSiteSettings, updateSiteToggle } from '@/app/actions/site-settings'

import {
  PageHeader,
  SectionNav,
  Card,
  CardHeader,
  CardBody,
  Empty,
  toast,
} from '@/ds'
import {
  Button,
  Field,
  Input,
  Switch,
} from '@/ds'
import { Icon } from '@/ds/icons'
import Link from 'next/link'

import { UsersContent } from '@/app/(authenticated)/users/_components/UsersContent'
import { RolesContent } from '@/app/(authenticated)/users/_components/RolesContent'
import { ProfileClient } from '@/app/(authenticated)/profile/_components/ProfileClient'

type ActiveSection = 'general' | 'users' | 'roles' | 'profile'

interface SettingsClientProps {
  users: UserSummaryWithRoles[]
  roles: Role[]
  canManageRoles: boolean
  canManageSettings: boolean
  siteSettings: SiteSettings | null
}

const SECTION_ITEMS = [
  { id: 'general', label: 'General' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'profile', label: 'Profile' },
]

const SETTINGS_LINKS = [
  { href: '/settings/business-hours', title: 'Business Hours', description: 'Opening hours and special days', icon: 'calendar' },
  { href: '/settings/table-bookings', title: 'Table Bookings', description: 'Tables, areas, groups, and pacing', icon: 'table' },
  { href: '/settings/customer-labels', title: 'Customer Labels', description: 'Customer tags and automation rules', icon: 'users' },
  { href: '/settings/event-categories', title: 'Event Categories', description: 'Defaults and marketing metadata', icon: 'calendar' },
  { href: '/settings/api-keys', title: 'API Keys', description: 'External API access and revocation', icon: 'link' },
  { href: '/settings/sms-failures', title: 'SMS Failures', description: 'Retry or dismiss failed messages', icon: 'message' },
  { href: '/settings/pay-bands', title: 'Pay Bands', description: 'Age bands, rates, and overrides', icon: 'pound' },
  { href: '/settings/gdpr', title: 'GDPR', description: 'Data export and deletion tools', icon: 'eyeOff' },
] as const

/* ------------------------------------------------------------------ */
/*  General Section                                                    */
/* ------------------------------------------------------------------ */

function GeneralSection({ settings, canEdit }: { settings: SiteSettings | null; canEdit: boolean }) {
  const [saving, setSaving] = useState(false)
  const [toggleSaving, setToggleSaving] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: settings?.name ?? '',
    phone: settings?.phone ?? '',
    email: settings?.email ?? '',
    website: settings?.website ?? '',
    address: settings?.address ?? '',
    default_party_size: String(settings?.default_party_size ?? 2),
    booking_duration_mins: String(settings?.booking_duration_mins ?? 90),
    advance_booking_days: String(settings?.advance_booking_days ?? 30),
    deposit_amount: String(settings?.deposit_amount ?? 10),
    min_group_size_deposit: String(settings?.min_group_size_deposit ?? 7),
    currency: settings?.currency ?? 'GBP',
    reminder_hours_before: String(settings?.reminder_hours_before ?? 24),
    admin_email: settings?.admin_email ?? '',
    cc_email: settings?.cc_email ?? '',
  })

  const [toggles, setToggles] = useState({
    online_bookings_enabled: settings?.online_bookings_enabled ?? true,
    sms_notifications_enabled: settings?.sms_notifications_enabled ?? true,
    auto_confirm_bookings: settings?.auto_confirm_bookings ?? false,
  })

  if (!settings) {
    return <Empty title="Settings unavailable" description="Could not load site settings." />
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('id', settings!.id)
      Object.entries(form).forEach(([key, value]) => fd.append(key, value))
      const res = await updateSiteSettings(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(field: keyof typeof toggles): Promise<void> {
    const newValue = !toggles[field]
    setToggles((prev) => ({ ...prev, [field]: newValue }))
    setToggleSaving(field)
    try {
      const res = await updateSiteToggle(settings!.id, field, newValue)
      if (res.error) {
        setToggles((prev) => ({ ...prev, [field]: !newValue }))
        toast.error(res.error)
      } else {
        toast.success('Setting updated')
      }
    } catch {
      setToggles((prev) => ({ ...prev, [field]: !newValue }))
      toast.error('Failed to update setting')
    } finally {
      setToggleSaving(null)
    }
  }

  const disabled = !canEdit

  return (
    <div className="space-y-6">
      {/* Business Profile */}
      <form onSubmit={handleSave}>
        <Card>
          <CardHeader title="Business Profile" subtitle="Your venue details" />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Business Name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={disabled}
                />
              </Field>
              <Field label="Website">
                <Input
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  disabled={disabled}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
              </div>
            </div>
            {canEdit && (
              <div className="flex justify-end mt-4">
                <Button type="submit" variant="primary" size="sm" loading={saving}>
                  Save Changes
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </form>

      {/* Quick Toggles */}
      <Card>
        <CardHeader title="Quick Toggles" subtitle="Enable or disable key features" />
        <CardBody>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-strong">Online Bookings</p>
                <p className="text-xs text-text-muted">Accept table bookings from the website</p>
              </div>
              <Switch
                checked={toggles.online_bookings_enabled}
                onChange={() => handleToggle('online_bookings_enabled')}
                disabled={disabled || toggleSaving === 'online_bookings_enabled'}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-strong">SMS Notifications</p>
                <p className="text-xs text-text-muted">Send automatic SMS confirmations</p>
              </div>
              <Switch
                checked={toggles.sms_notifications_enabled}
                onChange={() => handleToggle('sms_notifications_enabled')}
                disabled={disabled || toggleSaving === 'sms_notifications_enabled'}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-strong">Auto-Confirm Bookings</p>
                <p className="text-xs text-text-muted">Automatically confirm new bookings</p>
              </div>
              <Switch
                checked={toggles.auto_confirm_bookings}
                onChange={() => handleToggle('auto_confirm_bookings')}
                disabled={disabled || toggleSaving === 'auto_confirm_bookings'}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Settings groups in 3-col grid */}
      <form onSubmit={handleSave}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardHeader title="Booking Settings" />
            <CardBody>
              <div className="space-y-3">
                <Field label="Default Party Size">
                  <Input
                    type="number"
                    value={form.default_party_size}
                    onChange={(e) => setForm({ ...form, default_party_size: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Booking Duration (mins)">
                  <Input
                    type="number"
                    value={form.booking_duration_mins}
                    onChange={(e) => setForm({ ...form, booking_duration_mins: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Advance Booking (days)">
                  <Input
                    type="number"
                    value={form.advance_booking_days}
                    onChange={(e) => setForm({ ...form, advance_booking_days: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment Settings" />
            <CardBody>
              <div className="space-y-3">
                <Field label="Deposit Amount">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.deposit_amount}
                    onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Min Group Size for Deposit">
                  <Input
                    type="number"
                    value={form.min_group_size_deposit}
                    onChange={(e) => setForm({ ...form, min_group_size_deposit: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Currency">
                  <Input value={form.currency} disabled />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notification Settings" />
            <CardBody>
              <div className="space-y-3">
                <Field label="Reminder (hours before)">
                  <Input
                    type="number"
                    value={form.reminder_hours_before}
                    onChange={(e) => setForm({ ...form, reminder_hours_before: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Admin Email">
                  <Input
                    type="email"
                    value={form.admin_email}
                    onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="CC Email">
                  <Input
                    type="email"
                    value={form.cc_email}
                    onChange={(e) => setForm({ ...form, cc_email: e.target.value })}
                    placeholder="Optional"
                    disabled={disabled}
                  />
                </Field>
              </div>
            </CardBody>
          </Card>
        </div>

        {canEdit && (
          <div className="flex justify-end mt-4">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Save All Settings
            </Button>
          </div>
        )}
      </form>

      <Card>
        <CardHeader title="Settings Pages" subtitle="Specialised configuration areas" />
        <CardBody>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SETTINGS_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 rounded-default border border-border p-3 hover:bg-surface-hover"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-default bg-primary-soft text-primary">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-text-strong">{item.title}</span>
                  <span className="block text-xs leading-5 text-text-muted">{item.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Developer Tools */}
      <Card>
        <CardHeader title="Developer Tools" subtitle="Internal tools and references" />
        <CardBody>
          <Link
            href="/settings/design-system"
            className="flex items-center gap-3 p-3 -m-1 rounded-default hover:bg-surface-hover transition-colors group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-soft">
              <Icon name="palette" size={20} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-text-strong group-hover:text-primary transition-colors">
                Design System
              </p>
              <p className="text-xs text-text-muted">
                Component library, colours, typography, and spacing reference
              </p>
            </div>
            <Icon name="chevronRight" size={16} className="text-text-subtle" />
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SettingsClient                                                     */
/* ------------------------------------------------------------------ */

export function SettingsClient({
  users,
  roles,
  canManageRoles,
  canManageSettings,
  siteSettings,
}: SettingsClientProps) {
  const [activeSection, setActiveSection] = useState<ActiveSection>('general')

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }]}
        title="Settings"
        subtitle="Manage application settings and configurations"
      />

      <SectionNav
        items={SECTION_ITEMS}
        activeId={activeSection}
        onSelect={(id) => setActiveSection(id as ActiveSection)}
        className="mb-6"
      />

      {activeSection === 'general' && <GeneralSection settings={siteSettings} canEdit={canManageSettings} />}
      {activeSection === 'users' && (
        <UsersContent users={users} roles={roles} canManageRoles={canManageRoles} />
      )}
      {activeSection === 'roles' && <RolesContent />}
      {activeSection === 'profile' && <ProfileClient />}
    </div>
  )
}
