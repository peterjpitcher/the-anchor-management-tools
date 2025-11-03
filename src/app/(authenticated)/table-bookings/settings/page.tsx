'use client'

import { useRouter } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  CogIcon, 
  TableCellsIcon, 
  ClockIcon, 
  DocumentTextIcon,
  CalendarDaysIcon 
} from '@heroicons/react/24/outline';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';

export default function TableBookingSettingsPage() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('table_bookings', 'manage');
  const router = useRouter();

  if (!canManage) {
    return (
      <PageLayout
        title="Table Booking Settings"
        subtitle="Configure and manage table booking system settings"
        backButton={{
          label: 'Back to Table Bookings',
          href: '/table-bookings',
        }}
      >
        <Card>
          <Alert variant="error">
            You do not have permission to manage table booking settings.
          </Alert>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Table Booking Settings"
      subtitle="Configure and manage table booking system settings"
      backButton={{
        label: 'Back to Table Bookings',
        href: '/table-bookings',
      }}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Table Configuration */}
        <Link href="/table-bookings/settings/tables">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <TableCellsIcon className="h-6 w-6 text-blue-600" />
              </div>
              <h2 className="text-lg font-semibold">Table Configuration</h2>
            </div>
            <p className="text-gray-600">
              Manage restaurant tables, capacities, and combinations
            </p>
          </Card>
        </Link>

        {/* Booking Policies */}
        <Link href="/table-bookings/settings/policies">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <DocumentTextIcon className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold">Booking Policies</h2>
            </div>
            <p className="text-gray-600">
              Configure booking rules, time slots, and restrictions
            </p>
          </Card>
        </Link>

        {/* Time Slots */}
        <Link href="/table-bookings/settings/time-slots">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-purple-100 rounded-lg">
                <ClockIcon className="h-6 w-6 text-purple-600" />
              </div>
              <h2 className="text-lg font-semibold">Time Slot Management</h2>
            </div>
            <p className="text-gray-600">
              Override default time slots for special dates
            </p>
          </Card>
        </Link>

        {/* SMS Templates */}
        <Link href="/table-bookings/settings/sms-templates">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-orange-100 rounded-lg">
                <CogIcon className="h-6 w-6 text-orange-600" />
              </div>
              <h2 className="text-lg font-semibold">SMS Templates</h2>
            </div>
            <p className="text-gray-600">
              Customize SMS messages for bookings and reminders
            </p>
          </Card>
        </Link>

        {/* Sunday Lunch Menu */}
        <Link href="/menu-management/dishes?menu=sunday_lunch">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <CalendarDaysIcon className="h-6 w-6 text-yellow-600" />
              </div>
              <h2 className="text-lg font-semibold">Sunday Lunch Menu</h2>
            </div>
            <p className="text-gray-600">
              Manage Sunday lunch dishes alongside the main menu builder
            </p>
          </Card>
        </Link>

        {/* Kitchen Hours */}
        <Link href="/settings/business-hours">
          <Card interactive>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <ClockIcon className="h-6 w-6 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold">Kitchen Hours</h2>
            </div>
            <p className="text-gray-600">
              Manage restaurant opening hours and availability
            </p>
          </Card>
        </Link>
      </div>
    </PageLayout>
  );
}
