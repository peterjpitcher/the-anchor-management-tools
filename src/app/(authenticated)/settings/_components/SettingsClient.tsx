'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SiteSettings } from '@/app/actions/site-settings'
import { updateSiteSettings, updateSiteToggle } from '@/app/actions/site-settings'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormFooter,
  Input,
  PageLayout,
  Section,
  Switch,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import type { SettingsTileGroup } from '../_shared/tiles'

interface SettingsClientProps {
  /** The settings pages this user can open, already filtered on the server. */
  tileGroups: SettingsTileGroup[]
  canManageSettings: boolean
  siteSettings: SiteSettings | null
}

/* ------------------------------------------------------------------ */
/*  General settings                                                   */
/* ------------------------------------------------------------------ */

function GeneralSettings({
  settings,
  canEdit,
}: {
  settings: SiteSettings | null
  canEdit: boolean
}) {
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
    return (
      <Alert tone="danger" title="Settings unavailable">
        Could not load site settings.
      </Alert>
    )
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
    <>
      {/* Business Profile */}
      <form onSubmit={handleSave}>
        <Card>
          <CardHeader title="Business Profile" subtitle="Your venue details" />
          <CardBody className="space-y-4">
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
              <FormFooter>
                <Button type="submit" variant="primary" loading={saving}>
                  Save Changes
                </Button>
              </FormFooter>
            )}
          </CardBody>
        </Card>
      </form>

      {/* Quick Toggles */}
      <Card>
        <CardHeader title="Quick Toggles" subtitle="Enable or disable key features" />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-ui font-medium text-text-strong">Online Bookings</p>
              <p className="text-xs text-text-muted">Accept table bookings from the website</p>
            </div>
            <Switch
              aria-label="Online Bookings"
              checked={toggles.online_bookings_enabled}
              onChange={() => handleToggle('online_bookings_enabled')}
              disabled={disabled || toggleSaving === 'online_bookings_enabled'}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-ui font-medium text-text-strong">SMS Notifications</p>
              <p className="text-xs text-text-muted">Send automatic SMS confirmations</p>
            </div>
            <Switch
              aria-label="SMS Notifications"
              checked={toggles.sms_notifications_enabled}
              onChange={() => handleToggle('sms_notifications_enabled')}
              disabled={disabled || toggleSaving === 'sms_notifications_enabled'}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-ui font-medium text-text-strong">Auto-Confirm Bookings</p>
              <p className="text-xs text-text-muted">Automatically confirm new bookings</p>
            </div>
            <Switch
              aria-label="Auto-Confirm Bookings"
              checked={toggles.auto_confirm_bookings}
              onChange={() => handleToggle('auto_confirm_bookings')}
              disabled={disabled || toggleSaving === 'auto_confirm_bookings'}
            />
          </div>
        </CardBody>
      </Card>

      {/* Settings groups in a 3-column grid, saved together */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardHeader title="Booking Settings" />
            <CardBody className="space-y-4">
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment Settings" />
            <CardBody className="space-y-4">
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notification Settings" />
            <CardBody className="space-y-4">
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
            </CardBody>
          </Card>
        </div>

        {canEdit && (
          <FormFooter>
            <Button type="submit" variant="primary" loading={saving}>
              Save All Settings
            </Button>
          </FormFooter>
        )}
      </form>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Settings pages: one tile per page this user can open               */
/* ------------------------------------------------------------------ */

function SettingsTiles({ groups }: { groups: SettingsTileGroup[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} />
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.tiles.map((tile) => (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="flex items-start gap-3 rounded-default border border-border p-3 transition-colors hover:bg-surface-hover focus-visible:outline-hidden focus-visible:shadow-ring"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-default bg-primary-soft text-primary">
                    <Icon name={tile.icon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui font-semibold text-text-strong">{tile.title}</span>
                    <span className="block text-xs leading-5 text-text-muted">{tile.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SettingsClient                                                     */
/* ------------------------------------------------------------------ */

export function SettingsClient({
  tileGroups,
  canManageSettings,
  siteSettings,
}: SettingsClientProps) {
  return (
    <PageLayout title="Settings" subtitle="Manage application settings and configurations">
      <Section title="Settings Pages" description="Specialised configuration areas">
        <SettingsTiles groups={tileGroups} />
      </Section>

      <Section title="General" description="Venue details, booking defaults and feature switches">
        <div className="space-y-6">
          <GeneralSettings settings={siteSettings} canEdit={canManageSettings} />
        </div>
      </Section>
    </PageLayout>
  )
}
