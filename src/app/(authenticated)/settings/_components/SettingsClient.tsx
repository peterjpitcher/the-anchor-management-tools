'use client'

import { useState } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { Role } from '@/types/rbac'

import {
  PageHeader,
  SectionNav,
  Card,
  CardHeader,
  CardBody,
} from '@/ds'
import {
  Button,
  Field,
  Input,
  Switch,
  Badge,
} from '@/ds'
import { Icon } from '@/ds/icons'
import Link from 'next/link'

import { UsersContent } from '@/app/(authenticated)/users/_components/UsersContent'
import { RolesContent } from '@/app/(authenticated)/users/_components/RolesContent'
import { ProfileClient } from '@/app/(authenticated)/profile/_components/ProfileClient'

type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>

type ActiveSection = 'general' | 'users' | 'roles' | 'profile'

interface SettingsClientProps {
  users: UserSummary[]
  roles: Role[]
  canManageRoles: boolean
  canManageSettings: boolean
}

/* ------------------------------------------------------------------ */
/*  Section items for SectionNav                                       */
/* ------------------------------------------------------------------ */

const SECTION_ITEMS = [
  { id: 'general', label: 'General' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'profile', label: 'Profile' },
]

/* ------------------------------------------------------------------ */
/*  General Section                                                    */
/* ------------------------------------------------------------------ */

function GeneralSection() {
  const [onlineBookings, setOnlineBookings] = useState(true)
  const [smsNotifications, setSmsNotifications] = useState(true)
  const [autoConfirm, setAutoConfirm] = useState(false)
  const [fohMode, setFohMode] = useState(false)
  const [kioskMode, setKioskMode] = useState(false)

  return (
    <div className="space-y-6">
      {/* Business Profile */}
      <Card>
        <CardHeader title="Business Profile" subtitle="Your venue details" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Business Name">
              <Input defaultValue="The Anchor" />
            </Field>
            <Field label="Phone">
              <Input defaultValue="+44 1234 567890" />
            </Field>
            <Field label="Email">
              <Input defaultValue="info@the-anchor.pub" />
            </Field>
            <Field label="Website">
              <Input defaultValue="https://the-anchor.pub" />
            </Field>
            <div className="col-span-2">
              <Field label="Address">
                <Input defaultValue="123 High Street, London" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button variant="primary" size="sm">Save Changes</Button>
          </div>
        </CardBody>
      </Card>

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
              <Switch checked={onlineBookings} onChange={setOnlineBookings} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-strong">SMS Notifications</p>
                <p className="text-xs text-text-muted">Send automatic SMS confirmations</p>
              </div>
              <Switch checked={smsNotifications} onChange={setSmsNotifications} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-text-strong">Auto-Confirm Bookings</p>
                <p className="text-xs text-text-muted">Automatically confirm new bookings</p>
              </div>
              <Switch checked={autoConfirm} onChange={setAutoConfirm} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Other Modes */}
      <Card>
        <CardHeader title="Other Modes" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 border border-border rounded-default">
              <div>
                <p className="text-[13px] font-medium text-text-strong">FOH Mode</p>
                <p className="text-xs text-text-muted">Simplified front-of-house view</p>
              </div>
              <Switch checked={fohMode} onChange={setFohMode} />
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded-default">
              <div>
                <p className="text-[13px] font-medium text-text-strong">Kiosk Mode</p>
                <p className="text-xs text-text-muted">Full-screen kiosk display</p>
              </div>
              <Switch checked={kioskMode} onChange={setKioskMode} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Settings groups in 3-col grid */}
      <div className="grid grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Booking Settings" />
          <CardBody>
            <div className="space-y-3">
              <Field label="Default Party Size">
                <Input type="number" defaultValue="2" />
              </Field>
              <Field label="Booking Duration (mins)">
                <Input type="number" defaultValue="90" />
              </Field>
              <Field label="Advance Booking (days)">
                <Input type="number" defaultValue="30" />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment Settings" />
          <CardBody>
            <div className="space-y-3">
              <Field label="Deposit Amount">
                <Input type="text" defaultValue="10.00" />
              </Field>
              <Field label="Min Group Size for Deposit">
                <Input type="number" defaultValue="7" />
              </Field>
              <Field label="Currency">
                <Input defaultValue="GBP" disabled />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notification Settings" />
          <CardBody>
            <div className="space-y-3">
              <Field label="Reminder (hours before)">
                <Input type="number" defaultValue="24" />
              </Field>
              <Field label="Admin Email">
                <Input type="email" defaultValue="admin@the-anchor.pub" />
              </Field>
              <Field label="CC Email">
                <Input type="email" defaultValue="" placeholder="Optional" />
              </Field>
            </div>
          </CardBody>
        </Card>
      </div>

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

      {activeSection === 'general' && <GeneralSection />}
      {activeSection === 'users' && (
        <UsersContent users={users} roles={roles} canManageRoles={canManageRoles} />
      )}
      {activeSection === 'roles' && <RolesContent />}
      {activeSection === 'profile' && <ProfileClient />}
    </div>
  )
}
