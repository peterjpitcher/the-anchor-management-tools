import { Suspense } from 'react';
import TableBookingsDashboard from './dashboard';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';

export default function TableBookingsPage() {
  return (
    <Suspense
      fallback={
        <PageLayout
          title="Table Bookings"
          subtitle="Manage restaurant table reservations"
          loading
          loadingLabel="Loading table bookings..."
        />
      }
    >
      <TableBookingsDashboard />
    </Suspense>
  );
}
