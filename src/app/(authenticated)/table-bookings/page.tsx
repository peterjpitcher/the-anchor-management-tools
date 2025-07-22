import { Suspense } from 'react';
import TableBookingsDashboard from './dashboard';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

export default function TableBookingsPage() {
  return (
    <Suspense fallback={
      <Page title="Loading...">
        <div className="flex items-center justify-center h-64">
          <Spinner size="lg" />
        </div>
      </Page>
    }>
      <TableBookingsDashboard />
    </Suspense>
  );
}